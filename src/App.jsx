import { useEffect, useMemo, useRef, useState } from 'react';
import { Pose } from '@mediapipe/pose';
import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks, POSE_CONNECTIONS } from '@mediapipe/drawing_utils';

const WORD_LENGTH = 5;
const MAX_ATTEMPTS = 6;
const WORD_LIST = ['MOTOR', 'CHAVE', 'PARTE', 'MESA', 'RODA', 'FACA', 'PINO', 'LIXO', 'TUBO', 'MOLA'];
const KEYBOARD_ROWS = [
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
  ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'],
  ['U', 'V', 'W', 'X', 'Y', 'Z'],
];

function normalizeLetter(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function distance(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function classifyPose(landmarks) {
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  const leftWrist = landmarks[15];
  const rightWrist = landmarks[16];
  const leftElbow = landmarks[13];
  const rightElbow = landmarks[14];
  const nose = landmarks[0];

  const handsUp = leftWrist.y < leftShoulder.y && rightWrist.y < rightShoulder.y;
  const handsWide = distance(leftWrist, rightWrist) > 0.35;
  const handsTogether = distance(leftWrist, rightWrist) < 0.12;
  const oneArmUp = (leftWrist.y < leftElbow.y && rightWrist.y > rightShoulder.y) || (rightWrist.y < rightElbow.y && leftWrist.y > leftShoulder.y);

  if (handsTogether) return 'MÃO JUNTA';
  if (handsUp) return 'BRAÇOS ACIMA';
  if (handsWide) return 'ABRAÇO DE PEÇA';
  if (oneArmUp) return 'LADO DA OFICINA';
  if (nose.y < 0.35) return 'POSIÇÃO DE FRENTE';
  return 'POSIÇÃO LIVRE';
}

function classifyHandGesture(handLandmarks) {
  if (!handLandmarks || handLandmarks.length < 21) return null;

  const wrist = handLandmarks[0];
  const indexTip = handLandmarks[8];
  const middleTip = handLandmarks[12];
  const thumbTip = handLandmarks[4];
  const pinkyTip = handLandmarks[20];

  if (!wrist || !indexTip || !middleTip || !thumbTip || !pinkyTip) return null;

  const handOpen = distance(indexTip, middleTip) > 0.06 && distance(indexTip, pinkyTip) > 0.06;
  const indexUp = indexTip.y < wrist.y - 0.03;
  const thumbUp = thumbTip.y < wrist.y - 0.03;
  const fingersClosed = indexTip.y > wrist.y + 0.03 && middleTip.y > wrist.y + 0.03 && pinkyTip.y > wrist.y + 0.03;
  const fist = distance(indexTip, thumbTip) < 0.08;

  if (thumbUp && fingersClosed) return 'FIXE';
  if (fist) return 'PUNHO';
  if (indexUp && thumbUp) return 'PONTA';
  if (handOpen) return 'ABERTA';
  return 'MÃO';
}

function getRandomWord() {
  return WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
}

function getLetterFromPosition(x, y) {
  const row = y < 0.33 ? 0 : y < 0.66 ? 1 : 2;
  const rowLetters = KEYBOARD_ROWS[row] || [];
  const clampedX = Math.max(0, Math.min(1, x));
  const column = Math.min(rowLetters.length - 1, Math.max(0, Math.floor(clampedX * rowLetters.length)));
  return rowLetters[column];
}

function evaluateGuess(guess, secret) {
  const guessLetters = normalizeLetter(guess).split('');
  const secretLetters = normalizeLetter(secret).split('');
  const result = Array(guessLetters.length).fill('absent');
  const remaining = { ...secretLetters.reduce((acc, char) => ({ ...acc, [char]: (acc[char] || 0) + 1 }), {}) };

  guessLetters.forEach((letter, index) => {
    if (letter === secretLetters[index]) {
      result[index] = 'correct';
      remaining[letter] -= 1;
    }
  });

  guessLetters.forEach((letter, index) => {
    if (result[index] === 'correct') return;
    if (remaining[letter] > 0) {
      result[index] = 'present';
      remaining[letter] -= 1;
    }
  });

  return result;
}

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState('A preparar a câmera...');
  const [poseLabel, setPoseLabel] = useState('Posição livre');
  const [cameraError, setCameraError] = useState('');
  const [isCameraAvailable, setIsCameraAvailable] = useState(true);
  const [secretWord, setSecretWord] = useState(getRandomWord());
  const [guessLetters, setGuessLetters] = useState(Array(WORD_LENGTH).fill(''));
  const [guesses, setGuesses] = useState([]);
  const [guessResults, setGuessResults] = useState([]);
  const [attempts, setAttempts] = useState(0);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [selectedLetter, setSelectedLetter] = useState('A');
  const [feedback, setFeedback] = useState('Mova a mão para escolher a letra e faça um polegar para cima com a outra mão para confirmar.');
  const [gameStatus, setGameStatus] = useState('playing');
  const [ready, setReady] = useState(false);

  const selectedLetterRef = useRef(selectedLetter);
  const guessLettersRef = useRef(guessLetters);
  const currentPositionRef = useRef(currentPosition);
  const attemptsRef = useRef(attempts);
  const secretWordRef = useRef(secretWord);
  const gameStatusRef = useRef(gameStatus);
  const confirmRef = useRef(false);
  const lastPoseRef = useRef(null);

  useEffect(() => {
    selectedLetterRef.current = selectedLetter;
  }, [selectedLetter]);

  useEffect(() => {
    guessLettersRef.current = guessLetters;
  }, [guessLetters]);

  useEffect(() => {
    currentPositionRef.current = currentPosition;
  }, [currentPosition]);

  useEffect(() => {
    attemptsRef.current = attempts;
  }, [attempts]);

  useEffect(() => {
    secretWordRef.current = secretWord;
  }, [secretWord]);

  useEffect(() => {
    gameStatusRef.current = gameStatus;
  }, [gameStatus]);

  useEffect(() => {
    let cancelled = false;
    let pose = null;
    let hands = null;
    let camera = null;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return undefined;

    const canUseCamera = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext !== false;
    if (!canUseCamera) {
      setStatus('A câmera não está disponível neste navegador.');
      setCameraError('Use um navegador compatível com webcam, como Chrome ou Edge.');
      setIsCameraAvailable(false);
      setReady(false);
      return undefined;
    }

    const initializeCamera = async () => {
      try {
        pose = new Pose({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
        });

        hands = new Hands({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });

        pose.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          enableSegmentation: false,
          smoothSegmentation: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        pose.onResults((results) => {
          try {
            if (cancelled || !videoRef.current || !canvasRef.current) return;

            const width = video.videoWidth || 640;
            const height = video.videoHeight || 480;

            if (canvas.width !== width || canvas.height !== height) {
              canvas.width = width;
              canvas.height = height;
            }

            const ctx = canvas.getContext('2d');
            if (!ctx || !results.image) return;

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

            if (results.poseLandmarks) {
              drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {
                color: '#74f1ff',
                lineWidth: 3,
              });
              drawLandmarks(ctx, results.poseLandmarks, {
                color: '#ffdf33',
                lineWidth: 2,
              });

              const label = classifyPose(results.poseLandmarks);
              setPoseLabel(label);
              lastPoseRef.current = label;
            }

            if (gameStatusRef.current === 'playing' && results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
              const handEntries = (results.multiHandLandmarks || []).map((landmarks, index) => ({
                landmarks,
                handedness: results.multiHandedness?.[index]?.label || 'Unknown',
              }));

              const selectionHand = handEntries.find((entry) => entry.handedness === 'Right') || handEntries[0];
              if (selectionHand) {
                const indexTip = selectionHand.landmarks[8];
                const nextLetter = getLetterFromPosition(indexTip.x, indexTip.y);
                if (nextLetter !== selectedLetterRef.current) {
                  setSelectedLetter(nextLetter);
                }
              }

              const confirmHand = handEntries.find((entry) => entry.handedness === 'Left') || handEntries.find((entry) => entry.handedness !== (selectionHand?.handedness || 'Unknown'));
              const confirmGesture = confirmHand ? classifyHandGesture(confirmHand.landmarks) : null;
              const isConfirming = confirmGesture === 'FIXE';

              if (isConfirming && !confirmRef.current) {
                confirmRef.current = true;

                const nextGuessLetters = [...guessLettersRef.current];
                nextGuessLetters[currentPositionRef.current] = normalizeLetter(selectedLetterRef.current);
                setGuessLetters(nextGuessLetters);
                guessLettersRef.current = nextGuessLetters;

                const nextPosition = currentPositionRef.current + 1;
                if (nextPosition >= WORD_LENGTH) {
                  const submittedGuess = nextGuessLetters.join('');
                  const result = evaluateGuess(submittedGuess, secretWordRef.current);
                  const nextAttempts = attemptsRef.current + 1;

                  setGuesses((prev) => [...prev, submittedGuess]);
                  setGuessResults((prev) => [...prev, result]);
                  setAttempts(nextAttempts);
                  attemptsRef.current = nextAttempts;

                  if (submittedGuess === secretWordRef.current) {
                    setGameStatus('won');
                    setFeedback(`Parabéns! A palavra ${submittedGuess} estava certa.`);
                  } else if (nextAttempts >= MAX_ATTEMPTS) {
                    setGameStatus('lost');
                    setFeedback(`Não foi desta. A palavra secreta era ${secretWordRef.current}.`);
                  } else {
                    setFeedback('Palavra enviada. Continue a tentar a próxima tentativa.');
                  }

                  setGuessLetters(Array(WORD_LENGTH).fill(''));
                  guessLettersRef.current = Array(WORD_LENGTH).fill('');
                  setCurrentPosition(0);
                  currentPositionRef.current = 0;
                } else {
                  setCurrentPosition(nextPosition);
                  setFeedback(`Letra ${normalizeLetter(selectedLetterRef.current)} registada. Continue.`);
                }
              } else if (!isConfirming) {
                confirmRef.current = false;
              }
            }

            if (!cancelled) {
              setStatus('Câmera ativa e gestos em análise');
              setReady(true);
            }
          } catch (error) {
            if (!cancelled) {
              setStatus('Houve um erro na análise da câmera.');
              setCameraError('Tente recarregar a página ou dar permissão novamente.');
              setReady(false);
            }
          }
        });

        camera = new Camera(video, {
          onFrame: async () => {
            if (cancelled) return;
            await pose.send({ image: video });
            await hands.send({ image: video });
          },
          width: 640,
          height: 480,
        });

        await camera.start();

        if (!cancelled) {
          setStatus('Câmera iniciada. Mova a mão para escolher a letra.');
          setCameraError('');
          setIsCameraAvailable(true);
          setReady(true);
        }
      } catch (error) {
        if (!cancelled) {
          setStatus('Não foi possível abrir a câmera. Permita o acesso e recarregue a página.');
          setCameraError('Verifique as permissões da webcam e tente novamente.');
          setIsCameraAvailable(false);
          setReady(false);
        }
      }
    };

    initializeCamera();

    return () => {
      cancelled = true;
      if (camera) camera.stop();
      if (pose) pose.close();
      if (hands) hands.close();
    };
  }, []);

  const startNewGame = () => {
    const nextWord = getRandomWord();
    setSecretWord(nextWord);
    setGuessLetters(Array(WORD_LENGTH).fill(''));
    setGuesses([]);
    setGuessResults([]);
    setAttempts(0);
    setCurrentPosition(0);
    setGameStatus('playing');
    setSelectedLetter('A');
    setFeedback('Nova palavra. Mova a mão para escolher a letra e faça polegar para cima para confirmar.');
    confirmRef.current = false;
  };

  const currentGuess = guessLetters.join('');
  const rows = Array.from({ length: MAX_ATTEMPTS }, (_, rowIndex) => {
    const isActive = rowIndex === attempts;
    const guess = isActive ? currentGuess : guesses[rowIndex] || '';
    const result = isActive ? [] : guessResults[rowIndex] || [];

    return (
      <div key={`row-${rowIndex}`} className={`guess-row ${isActive ? 'active' : ''}`}>
        {Array.from({ length: WORD_LENGTH }, (_, index) => {
          const letter = guess[index] || '';
          const resultClass = result[index] || '';
          return (
            <span key={`${rowIndex}-${index}`} className={`letter-tile ${resultClass}`}>
              {letter || (isActive ? ' ' : '')}
            </span>
          );
        })}
      </div>
    );
  });

  return (
    <main className="app-shell">
      <section className="panel hero">
        <p className="eyebrow">Jogo interativo</p>
        <h1>Tremo na Oficina</h1>
        <p className="lead">Escolha cada letra com a câmera e confirme com um polegar para cima da outra mão.</p>
      </section>

      <section className="panel board">
        <div className="camera-card">
          <video ref={videoRef} className="video" playsInline autoPlay muted />
          <canvas ref={canvasRef} className="canvas-overlay" />
          <div className="badge-row">
            <span className={`chip ${ready ? 'ok' : ''}`}>{ready ? 'Webcam pronta' : 'Aguardando...'}</span>
            <span className="chip">Tentativas: {attempts}/{MAX_ATTEMPTS}</span>
          </div>
        </div>

        <aside className="info-card">
          <h2>Termo com gestos</h2>
          <p>{status}</p>
          <p><strong>Pose detectada:</strong> {poseLabel}</p>
          <p className="status-line">{feedback}</p>
          {cameraError ? <p className="camera-error">{cameraError}</p> : null}

          <div className="board-box">
            <span>Palavra</span>
            <div className="guess-board">
              {rows}
            </div>
          </div>

          <div className="keyboard-box">
            <span>Letra selecionada</span>
            <div className="selected-letter">{selectedLetter}</div>
            <div className="keyboard-row">
              {KEYBOARD_ROWS[0].map((letter) => (
                <span key={letter} className={`keyboard-key ${letter === selectedLetter ? 'active' : ''}`}>
                  {letter}
                </span>
              ))}
            </div>
            <div className="keyboard-row">
              {KEYBOARD_ROWS[1].map((letter) => (
                <span key={letter} className={`keyboard-key ${letter === selectedLetter ? 'active' : ''}`}>
                  {letter}
                </span>
              ))}
            </div>
            <div className="keyboard-row">
              {KEYBOARD_ROWS[2].map((letter) => (
                <span key={letter} className={`keyboard-key ${letter === selectedLetter ? 'active' : ''}`}>
                  {letter}
                </span>
              ))}
            </div>
          </div>

          <button type="button" onClick={startNewGame}>Nova palavra</button>
          <small>Mova a sua mão para percorrer o teclado e use a outra mão com o gesto de polegar para cima para confirmar a letra.</small>
        </aside>
      </section>
    </main>
  );
}
