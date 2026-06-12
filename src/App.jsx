import { useEffect, useMemo, useRef, useState } from 'react';
import { Pose } from '@mediapipe/pose';
import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks, POSE_CONNECTIONS } from '@mediapipe/drawing_utils';

const PHRASES = [
  'TREMO NA OFICINA',
  'MÃO NA PEÇA',
  'RODA EM MOVIMENTO',
  'EQUIPE EM AÇÃO'
];

const POSE_TO_SLOT = {
  'BRAÇOS ACIMA': 0,
  'MÃO JUNTA': 1,
  'ABRAÇO DE PEÇA': 2,
  'LADO DA OFICINA': 3,
  'PUNHO': 0,
  'PONTA': 1,
  'ABERTA': 2,
  'MÃO': 3,
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

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
  const fist = distance(indexTip, thumbTip) < 0.08;

  if (fist) return 'PUNHO';
  if (indexUp && thumbUp) return 'PONTA';
  if (handOpen) return 'ABERTA';
  return 'MÃO';
}

function getLetterTargets(phrase) {
  return phrase.split('').reduce((acc, char, index) => {
    if (char !== ' ') {
      acc.push({ char, index });
    }
    return acc;
  }, []);
}

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState('Aguardando câmera...');
  const [poseLabel, setPoseLabel] = useState('Posição livre');
  const [phrase, setPhrase] = useState(PHRASES[0]);
  const [score, setScore] = useState(0);
  const [ready, setReady] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [feedback, setFeedback] = useState('Use a pose para escolher a letra sugerida.');

  const letterTargets = useMemo(() => getLetterTargets(phrase), [phrase]);
  const activeTarget = letterTargets[currentPosition] || null;
  const completedIndexes = useMemo(
    () => new Set(letterTargets.slice(0, currentPosition).map(({ index }) => index)),
    [letterTargets, currentPosition]
  );
  const completedLetters = useMemo(
    () => letterTargets.slice(0, currentPosition).map(({ char }) => char),
    [letterTargets, currentPosition]
  );

  const suggestions = useMemo(() => {
    if (!activeTarget) return [];
    const targetLetter = normalizeLetter(activeTarget.char);
    return [targetLetter, ...ALPHABET.filter((letter) => letter !== targetLetter).slice(0, 3)];
  }, [activeTarget]);

  const activeTargetRef = useRef(activeTarget);
  const suggestionsRef = useRef(suggestions);
  const lastPoseRef = useRef(null);

  useEffect(() => {
    activeTargetRef.current = activeTarget;
  }, [activeTarget]);

  useEffect(() => {
    suggestionsRef.current = suggestions;
  }, [suggestions]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return undefined;

    const pose = new Pose({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
    });

    const hands = new Hands({
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
      const width = video.videoWidth || 640;
      const height = video.videoHeight || 480;

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const ctx = canvas.getContext('2d');
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

        if (label && label !== lastPoseRef.current) {
          lastPoseRef.current = label;
          const slot = POSE_TO_SLOT[label];
          const selectedLetter = slot !== undefined ? suggestionsRef.current[slot] : undefined;

          const targetLetter = normalizeLetter(activeTargetRef.current?.char);
          const normalizedSelected = normalizeLetter(selectedLetter);

          if (activeTargetRef.current && normalizedSelected === targetLetter) {
            setCurrentPosition((prev) => prev + 1);
            setScore((prev) => prev + 1);
            setFeedback(`Acertou! A letra ${targetLetter} ficou verde.`);
          } else if (activeTargetRef.current && selectedLetter) {
            setFeedback(`Essa não foi a letra certa. Tente a pose da letra ${targetLetter}.`);
          }
        }
      }

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const handLabel = classifyHandGesture(results.multiHandLandmarks[0]);
        if (handLabel) {
          const slot = POSE_TO_SLOT[handLabel];
          const selectedLetter = slot !== undefined ? suggestionsRef.current[slot] : undefined;
          const targetLetter = normalizeLetter(activeTargetRef.current?.char);
          const normalizedSelected = normalizeLetter(selectedLetter);

          if (activeTargetRef.current && normalizedSelected === targetLetter) {
            setCurrentPosition((prev) => prev + 1);
            setScore((prev) => prev + 1);
            setFeedback(`Acertou! A letra ${targetLetter} ficou verde.`);
          } else if (activeTargetRef.current && selectedLetter) {
            setFeedback(`Essa não foi a letra certa. Tente a pose da letra ${targetLetter}.`);
          }
        }
      }

      setStatus('Câmera ativa e poses em análise');
      setReady(true);
    });

    const camera = new Camera(video, {
      onFrame: async () => {
        await pose.send({ image: video });
        await hands.send({ image: video });
      },
      width: 640,
      height: 480,
    });

    camera.start().then(() => {
      setStatus('Câmera iniciada. Posicione o corpo e acompanhe o jogo.');
    }).catch(() => {
      setStatus('Não foi possível abrir a câmera. Permita o acesso e recarregue a página.');
    });

    return () => {
      camera.stop();
      pose.close();
      hands.close();
    };
  }, []);

  useEffect(() => {
    if (!activeTarget) {
      setFeedback('Parabéns! Você completou a frase.');
    }
  }, [activeTarget]);

  const randomPhrase = () => {
    const next = PHRASES[Math.floor(Math.random() * PHRASES.length)];
    setPhrase(next);
    setCurrentPosition(0);
    setFeedback('Nova frase pronta. Use a pose para escolher a letra sugerida.');
    lastPoseRef.current = null;
    setScore(0);
  };

  return (
    <main className="app-shell">
      <section className="panel hero">
        <p className="eyebrow">Jogo interativo</p>
        <h1>Tremo na Oficina</h1>
        <p className="lead">Use a webcam para seguir a sequência de letras da frase e marcar cada acerto com verde.</p>
      </section>

      <section className="panel board">
        <div className="camera-card">
          <video ref={videoRef} className="video" playsInline autoPlay muted />
          <canvas ref={canvasRef} className="canvas-overlay" />
          <div className="badge-row">
            <span className={`chip ${ready ? 'ok' : ''}`}>{ready ? 'Webcam pronta' : 'Aguardando...'}</span>
            <span className="chip">Acertos: {score}</span>
          </div>
        </div>

        <aside className="info-card">
          <h2>Desafio de letras</h2>
          <p>{status}</p>
          <p><strong>Pose detectada:</strong> {poseLabel}</p>
          <p className="status-line">{feedback}</p>

          <div className="phrase-box">
            <span>Frase</span>
            <div className="phrase-display">
              {phrase.split('').map((char, index) => {
                const isSpace = char === ' ';
                return (
                  <span
                    key={`${char}-${index}`}
                    className={`letter-tile ${isSpace ? 'space' : ''} ${completedIndexes.has(index) ? 'correct' : ''}`}
                  >
                    {isSpace ? '\u00A0' : char}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="suggestion-box">
            <span>Letras sugeridas</span>
            <div className="suggestion-row">
              {suggestions.map((letter) => (
                <span
                  key={letter}
                  className={`suggestion-chip ${completedLetters.includes(letter) ? 'correct' : ''} ${letter === activeTarget?.char ? 'active' : ''}`}
                >
                  {letter}
                </span>
              ))}
            </div>
          </div>

          <button type="button" onClick={randomPhrase}>Gerar outra frase</button>
          <small>As poses selecionam as letras sugeridas; quando você acerta, a letra fica verde e a próxima aparece.</small>
        </aside>
      </section>
    </main>
  );
}
