import { useEffect, useMemo, useRef, useState } from 'react';
import { Pose } from '@mediapipe/pose';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks, POSE_CONNECTIONS } from '@mediapipe/drawing_utils';

const PHRASES = [
  'TREMO NA OFICINA',
  'MÃO NA PEÇA',
  'RODA EM MOVIMENTO',
  'EQUIPE EM AÇÃO'
];

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

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState('Aguardando câmera...');
  const [poseLabel, setPoseLabel] = useState('Posição livre');
  const [phrase, setPhrase] = useState('TREMO NA OFICINA');
  const [score, setScore] = useState(0);
  const [ready, setReady] = useState(false);

  const phraseHint = useMemo(() => {
    if (poseLabel === 'BRAÇOS ACIMA') return 'Sugestão: equipe pronta para o inicio.';
    if (poseLabel === 'MÃO JUNTA') return 'Sugestão: peça alinhada e segura.';
    if (poseLabel === 'ABRAÇO DE PEÇA') return 'Sugestão: corpo aberto para a troca.';
    return 'Sugestão: mova os braços para gerar energia.';
  }, [poseLabel]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return undefined;

    const pose = new Pose({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
    });

    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      smoothSegmentation: false,
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

        if (label === 'BRAÇOS ACIMA' || label === 'MÃO JUNTA' || label === 'ABRAÇO DE PEÇA') {
          setScore((prev) => prev + 1);
        }
      }

      setStatus('Câmera ativa e poses em análise');
      setReady(true);
    });

    const camera = new Camera(video, {
      onFrame: async () => {
        await pose.send({ image: video });
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
    };
  }, []);

  const randomPhrase = () => {
    const next = PHRASES[Math.floor(Math.random() * PHRASES.length)];
    setPhrase(next);
  };

  return (
    <main className="app-shell">
      <section className="panel hero">
        <p className="eyebrow">Jogo interativo</p>
        <h1>Tremo na Oficina</h1>
        <p className="lead">Use a webcam para mover o corpo e gerar frases dinâmicas em tempo real com a sua pose.</p>
      </section>

      <section className="panel board">
        <div className="camera-card">
          <video ref={videoRef} className="video" playsInline autoPlay muted />
          <canvas ref={canvasRef} className="canvas-overlay" />
          <div className="badge-row">
            <span className={`chip ${ready ? 'ok' : ''}`}>{ready ? 'Webcam pronta' : 'Aguardando...'}</span>
            <span className="chip">Score: {score}</span>
          </div>
        </div>

        <aside className="info-card">
          <h2>Modo de jogo</h2>
          <p>{status}</p>
          <p><strong>Pose detectada:</strong> {poseLabel}</p>
          <p>{phraseHint}</p>

          <div className="phrase-box">
            <span>Frase sugerida</span>
            <strong>{phrase}</strong>
          </div>

          <button type="button" onClick={randomPhrase}>Gerar frase</button>
          <small>Versão de protótipo com webcam e detecção local do corpo no navegador, pronta para evoluir com mais modos e desafios.</small>
        </aside>
      </section>
    </main>
  );
}
