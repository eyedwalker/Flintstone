import { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, Check, CreditCard, Loader, RotateCcw, CheckCircle } from 'lucide-react';
import { MeasurementService, PDMeasurement, SegHeightMeasurement, CalibrationData } from '../lib/services/measurement-service';

interface FacialMeasurementProps {
  onMeasurementComplete: (measurements: {
    pd: PDMeasurement;
    segHeight?: SegHeightMeasurement;
    calibration: CalibrationData;
  }) => void;
  onSkip?: () => void;
}

type Step = 'instructions' | 'calibrate' | 'measure' | 'frame_on' | 'results';

interface HeadAlignment {
  isAligned: boolean;
  yaw: number;
  pitch: number;
  roll: number;
  message: string;
}

export default function FacialMeasurement({ onMeasurementComplete, onSkip }: FacialMeasurementProps) {
  const [step, setStep] = useState<Step>('instructions');
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [faceMeshLoaded, setFaceMeshLoaded] = useState(false);
  const [landmarks, setLandmarks] = useState<any>(null);

  const [calibration, setCalibration] = useState<CalibrationData | null>(null);
  const [cardMarkers, setCardMarkers] = useState<{ left: number | null; right: number | null }>({ left: null, right: null });
  const [dragging, setDragging] = useState<'left' | 'right' | 'frameBottom' | null>(null);

  const [pdResult, setPdResult] = useState<PDMeasurement | null>(null);
  const [segResult, setSegResult] = useState<SegHeightMeasurement | null>(null);
  const [frameBottom, setFrameBottom] = useState<number | null>(null);
  const frameBottomRef = useRef<number | null>(null);
  const [isMeasuring, setIsMeasuring] = useState(false);

  useEffect(() => { frameBottomRef.current = frameBottom; }, [frameBottom]);

  const [headAlignment, setHeadAlignment] = useState<HeadAlignment>({
    isAligned: false,
    yaw: 0,
    pitch: 0,
    roll: 0,
    message: 'Align your face to the camera',
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceMeshRef = useRef<any>(null);
  const animationRef = useRef<number | null>(null);
  const calibrationContainerRef = useRef<HTMLDivElement | null>(null);

  const isCameraStep = step === 'calibrate' || step === 'measure' || step === 'frame_on';

  useEffect(() => {
    return () => {
      stopCamera();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  const initFaceMesh = useCallback(async () => {
    if (faceMeshRef.current) return;
    try {
      setLoading(true);

      // Wait for CDN-loaded FaceMesh to be available on window (loaded via <script> in index.html)
      let tries = 0;
      while (!(window as any).FaceMesh && tries < 50) {
        await new Promise(r => setTimeout(r, 100));
        tries++;
      }
      const FaceMesh = (window as any).FaceMesh;
      if (!FaceMesh) throw new Error('FaceMesh script did not load from CDN');

      const faceMesh = new FaceMesh({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`,
      });

      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      faceMesh.onResults((results: any) => {
        const multi = results.multiFaceLandmarks;
        if (multi && multi.length > 0) {
          const lm = multi[0];
          drawLandmarks(lm);
          setLandmarks(lm);
        } else {
          setHeadAlignment(prev => ({ ...prev, isAligned: false, message: 'Face not detected' }));
        }
      });

      faceMeshRef.current = faceMesh;
      setFaceMeshLoaded(true);
      setLoading(false);
      console.log('[FacialMeasurement] MediaPipe Face Mesh loaded');
    } catch (err) {
      console.error('[FacialMeasurement] Failed to load MediaPipe:', err);
      setError('Failed to load face detection. Please refresh and try again.');
      setLoading(false);
    }
  }, []);

  const startCamera = async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try { await videoRef.current.play(); } catch {}
        setCameraReady(true);
      }
    } catch (err: any) {
      console.error('[FacialMeasurement] Camera error:', err);
      if (err.name === 'NotAllowedError') setError('Camera access denied. Please allow camera access and reload.');
      else if (err.name === 'NotFoundError') setError('No camera found on this device.');
      else if (err.name === 'NotReadableError') setError('Camera is in use by another app.');
      else setError(`Camera error: ${err.message}. Make sure you're using HTTPS.`);
    }
  };

  const stopCamera = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  };

  useEffect(() => {
    if (isCameraStep) {
      const alive = streamRef.current && streamRef.current.getVideoTracks().some(t => t.readyState === 'live');
      if (!alive) {
        const timer = setTimeout(() => startCamera(), 150);
        return () => clearTimeout(timer);
      }
    } else if (streamRef.current) {
      stopCamera();
    }
  }, [step, isCameraStep]);

  useEffect(() => {
    if (step === 'calibrate' && !faceMeshLoaded) initFaceMesh();
  }, [step, faceMeshLoaded, initFaceMesh]);

  const handleVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current) {
      const alive = streamRef.current.getVideoTracks().some(t => t.readyState === 'live');
      if (alive) {
        el.srcObject = streamRef.current;
        el.play().then(() => setCameraReady(true)).catch(() => {});
      } else {
        streamRef.current = null;
      }
    }
  }, []);

  const startFaceDetection = async () => {
    if (!faceMeshRef.current || !videoRef.current) return;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);

    const detect = async () => {
      if (videoRef.current && videoRef.current.readyState >= 2 && faceMeshRef.current) {
        try { await faceMeshRef.current.send({ image: videoRef.current }); } catch {}
      }
      animationRef.current = requestAnimationFrame(detect);
    };
    detect();
  };

  const analyzeHeadAlignment = (lm: any) => {
    if (!lm || lm.length < 468) return;
    const nose = lm[1];
    const leftEye = lm[33];
    const rightEye = lm[263];
    const topHead = lm[10];
    const chin = lm[152];

    const leftDist = leftEye.x - nose.x;
    const rightDist = nose.x - rightEye.x;
    const yawRaw = (leftDist - rightDist) / (leftEye.x - rightEye.x);
    const yaw = Math.max(-1, Math.min(1, yawRaw * 2));

    const eyesY = (leftEye.y + rightEye.y) / 2;
    const eyeNoseRatio = (nose.y - eyesY) / (chin.y - topHead.y);
    const pitch = Math.max(-1, Math.min(1, (eyeNoseRatio - 0.28) * 5));

    const rollRaw = (leftEye.y - rightEye.y) / (leftEye.x - rightEye.x);
    const roll = Math.max(-1, Math.min(1, rollRaw * 2));

    const yawRollThreshold = 0.25;
    const pitchThreshold = 0.45;
    const isAligned =
      Math.abs(yaw) < yawRollThreshold &&
      Math.abs(pitch) < pitchThreshold &&
      Math.abs(roll) < yawRollThreshold;

    let message = 'Perfect! Hold still';
    if (!isAligned) {
      if (Math.abs(yaw) >= yawRollThreshold) message = yaw < 0 ? 'Turn slightly right' : 'Turn slightly left';
      else if (Math.abs(pitch) >= pitchThreshold) message = pitch > 0 ? 'Tilt your head down' : 'Tilt your head up';
      else if (Math.abs(roll) >= yawRollThreshold) message = roll > 0 ? 'Level your head (tilt right)' : 'Level your head (tilt left)';
    }

    setHeadAlignment({ isAligned, yaw, pitch, roll, message });
  };

  const drawLandmarks = (lm: any) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    analyzeHeadAlignment(lm);

    ctx.strokeStyle = 'rgba(74, 144, 217, 0.6)';
    ctx.lineWidth = 2;
    const faceOval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
    ctx.beginPath();
    faceOval.forEach((idx, i) => {
      const x = lm[idx].x * canvas.width;
      const y = lm[idx].y * canvas.height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();

    if (lm.length > 468) {
      const leftIris = lm[468];
      ctx.beginPath();
      ctx.arc(leftIris.x * canvas.width, leftIris.y * canvas.height, 8, 0, 2 * Math.PI);
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(leftIris.x * canvas.width, leftIris.y * canvas.height, 2, 0, 2 * Math.PI);
      ctx.fillStyle = '#e74c3c';
      ctx.fill();

      const rightIris = lm[473];
      ctx.beginPath();
      ctx.arc(rightIris.x * canvas.width, rightIris.y * canvas.height, 8, 0, 2 * Math.PI);
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rightIris.x * canvas.width, rightIris.y * canvas.height, 2, 0, 2 * Math.PI);
      ctx.fillStyle = '#e74c3c';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(leftIris.x * canvas.width, leftIris.y * canvas.height);
      ctx.lineTo(rightIris.x * canvas.width, rightIris.y * canvas.height);
      ctx.strokeStyle = 'rgba(231, 76, 60, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (frameBottomRef.current != null) {
      const y = frameBottomRef.current * canvas.height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.strokeStyle = '#f39c12';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  };

  const recalibrate = (markers: { left: number | null; right: number | null }) => {
    if (markers.left == null || markers.right == null) return;
    const video = videoRef.current;
    if (!video) return;
    const cal = MeasurementService.calibrateWithCreditCard(
      (1 - markers.left) * video.videoWidth,
      (1 - markers.right) * video.videoWidth,
      video.videoWidth
    );
    setCalibration(cal);
  };

  const handleCalibrationClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (step !== 'calibrate') return;
    if (dragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;

    if (cardMarkers.left == null) {
      setCardMarkers({ left: x, right: null });
    } else if (cardMarkers.right == null) {
      const next = { ...cardMarkers, right: x };
      setCardMarkers(next);
      recalibrate(next);
    }
  };

  const handleFrameBottomClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (step !== 'frame_on') return;
    if (dragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    setFrameBottom(y);
  };

  const getClientPos = (e: MouseEvent | TouchEvent) => {
    if ('touches' in e && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    const me = e as MouseEvent;
    return { x: me.clientX, y: me.clientY };
  };

  const handleMarkerDragStart = (markerType: 'left' | 'right' | 'frameBottom') => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(markerType);

    const onMove = (moveEvt: MouseEvent | TouchEvent) => {
      moveEvt.preventDefault();
      const pos = getClientPos(moveEvt);
      const container = calibrationContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (markerType === 'frameBottom') {
        const y = Math.max(0, Math.min(1, (pos.y - rect.top) / rect.height));
        setFrameBottom(y);
      } else {
        const x = Math.max(0, Math.min(1, (pos.x - rect.left) / rect.width));
        setCardMarkers(prev => ({ ...prev, [markerType]: x }));
      }
    };

    const onEnd = () => {
      setDragging(null);
      if (markerType === 'left' || markerType === 'right') {
        setTimeout(() => {
          setCardMarkers(current => {
            if (current.left != null && current.right != null) recalibrate(current);
            return current;
          });
        }, 50);
      }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  };

  const autoCalibrate = () => {
    if (!landmarks) return;
    const video = videoRef.current;
    if (!video) return;
    const cal = MeasurementService.calibrateWithIris(landmarks, video.videoWidth);
    setCalibration(cal);
  };

  const resetMarkers = () => {
    setCardMarkers({ left: null, right: null });
    setCalibration(null);
  };

  const handleProceedToMeasure = () => {
    if (!calibration) return;
    setStep('measure');
  };

  const handleMeasure = () => {
    if (!landmarks || !calibration) {
      setError('Face not detected or not calibrated. Please go back and recalibrate.');
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    setIsMeasuring(true);
    setTimeout(() => {
      const pd = MeasurementService.calculatePD(landmarks, calibration, video.videoWidth, video.videoHeight);
      setPdResult(pd);
      setIsMeasuring(false);
      setStep('frame_on');
    }, 500);
  };

  const handleCaptureSegHeight = () => {
    if (!landmarks || !calibration || frameBottom == null) {
      setError('Put on your frame and tap the bottom edge of the lens.');
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    const seg = MeasurementService.calculateSegHeight(
      landmarks,
      frameBottom,
      calibration,
      video.videoWidth,
      video.videoHeight
    );
    setSegResult(seg);
    setStep('results');
  };

  const handleSkipSegHeight = () => {
    setSegResult(null);
    setStep('results');
  };

  const handleComplete = () => {
    if (calibration && pdResult) {
      onMeasurementComplete({
        pd: pdResult,
        segHeight: segResult || undefined,
        calibration,
      });
    }
  };

  const handleRecalibrate = () => {
    setCardMarkers({ left: null, right: null });
    setCalibration(null);
    setFrameBottom(null);
    setSegResult(null);
    setStep('calibrate');
  };

  if (step === 'instructions') {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <h2 className="text-2xl font-bold mb-4">Facial Measurements</h2>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-blue-900 mb-2">What We'll Measure:</h3>
          <ul className="space-y-2 text-blue-800">
            <li className="flex items-start gap-2">
              <Check className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <span><strong>PD (Pupillary Distance):</strong> Distance between pupils for lens centering</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <span><strong>Seg Height:</strong> Height measurement for bifocal/progressive lenses</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <span><strong>OC Height:</strong> Optical center positioning</span>
            </li>
          </ul>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-gray-900 mb-2">Instructions:</h3>
          <ol className="list-decimal list-inside space-y-2 text-gray-700">
            <li>Position yourself 12-18 inches from the camera</li>
            <li>Ensure good lighting on your face</li>
            <li>Hold a credit card next to your face, or use auto-calibrate</li>
            <li>Look directly at the camera</li>
            <li>Keep your head level and still</li>
          </ol>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setStep('calibrate')}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Camera className="w-5 h-5" />
            Start Measurement
          </button>
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Skip for Now
            </button>
          )}
        </div>
      </div>
    );
  }

  if (step === 'calibrate') {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <CreditCard size={24} />
          Calibration
        </h2>

        <div className="relative mb-4" ref={calibrationContainerRef}>
          <video
            ref={handleVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full rounded-lg bg-black min-h-[240px] mirror-video"
            onLoadedData={() => startFaceDetection()}
            onPlay={() => setCameraReady(true)}
          />
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 w-full h-full mirror-video"
            onClick={handleCalibrationClick}
          />

          {landmarks && (
            <div className="absolute top-4 right-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-black/70">
              <div className={`w-3 h-3 rounded-full flex-shrink-0 ${headAlignment.isAligned ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-white text-sm">{headAlignment.message}</span>
            </div>
          )}

          {!cameraReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900 rounded-lg">
              <div className="text-center text-white">
                <Loader className="animate-spin mx-auto mb-2" size={32} />
                <p className="text-sm">Starting camera...</p>
                <p className="text-xs text-gray-400 mt-1">Allow camera access if prompted</p>
              </div>
            </div>
          )}

          {loading && !faceMeshLoaded && (
            <div className="absolute bottom-4 left-4 px-3 py-2 rounded bg-black/70 text-white text-xs flex items-center gap-2">
              <Loader className="animate-spin" size={14} />
              Loading face detection...
            </div>
          )}

          {cardMarkers.left != null && (
            <div
              className="absolute top-0 bottom-0 card-marker-line"
              data-pos={`${cardMarkers.left * 100}%`}
              style={{ left: `${cardMarkers.left * 100}%`, width: '2px' }}
            >
              <div className="absolute inset-0 bg-green-500" />
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 bg-green-500/80 rounded-full border-2 border-white shadow-lg cursor-grab active:cursor-grabbing flex items-center justify-center touch-none"
                onMouseDown={handleMarkerDragStart('left')}
                onTouchStart={handleMarkerDragStart('left')}
              >
                <span className="text-white text-xs font-bold">L</span>
              </div>
            </div>
          )}
          {cardMarkers.right != null && (
            <div
              className="absolute top-0 bottom-0 card-marker-line"
              style={{ left: `${cardMarkers.right * 100}%`, width: '2px' }}
            >
              <div className="absolute inset-0 bg-green-500" />
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 bg-green-500/80 rounded-full border-2 border-white shadow-lg cursor-grab active:cursor-grabbing flex items-center justify-center touch-none"
                onMouseDown={handleMarkerDragStart('right')}
                onTouchStart={handleMarkerDragStart('right')}
              >
                <span className="text-white text-xs font-bold">R</span>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 mb-2">Option A: Credit Card Calibration</h3>
            <p className="text-blue-800 text-sm mb-2">
              Hold a credit card next to your face at eye level. Tap the left edge, then the right edge of the card. Drag the L/R lines to fine-tune.
            </p>
            {cardMarkers.left != null && cardMarkers.right == null && (
              <p className="text-blue-600 text-sm font-semibold">Left edge marked. Now tap the right edge.</p>
            )}
            {calibration && (
              <p className="text-green-600 text-sm font-semibold flex items-center gap-1">
                <CheckCircle size={16} /> Calibrated: {calibration.pixelsPerMm.toFixed(1)} px/mm
              </p>
            )}
            {(cardMarkers.left != null || cardMarkers.right != null) && (
              <button
                type="button"
                onClick={resetMarkers}
                className="mt-2 text-sm text-blue-600 hover:underline flex items-center gap-1"
              >
                <RotateCcw size={14} /> Reset markers
              </button>
            )}
          </div>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <h3 className="font-semibold text-purple-900 mb-2">Option B: Auto-Calibrate</h3>
            <p className="text-purple-800 text-sm mb-2">
              Uses your iris diameter (~11.7mm) for calibration. Less accurate but no card needed.
            </p>
            <button
              type="button"
              onClick={autoCalibrate}
              disabled={!landmarks}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {landmarks ? 'Auto-Calibrate with Iris' : 'Waiting for face detection...'}
            </button>
          </div>

          {calibration && (
            <button
              type="button"
              onClick={handleProceedToMeasure}
              className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 flex items-center justify-center gap-2"
            >
              Next: Capture Measurements <Camera size={20} />
            </button>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 mt-4">
            {error}
          </div>
        )}

        <style>{`.mirror-video { transform: scaleX(-1); }`}</style>
      </div>
    );
  }

  if (step === 'measure') {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h2 className="text-2xl font-bold mb-4">Taking Measurements</h2>

        <div className="relative bg-black rounded-lg overflow-hidden mb-4">
          <video
            ref={handleVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-auto mirror-video"
            onLoadedData={() => startFaceDetection()}
          />
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 w-full h-full mirror-video pointer-events-none"
          />

          <div className="absolute top-4 left-4 bg-green-500 text-white px-3 py-1 rounded-full text-sm">
            ✓ Calibrated
          </div>

          {landmarks && (
            <div className="absolute top-4 right-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-black/70">
              <div className={`w-3 h-3 rounded-full flex-shrink-0 ${headAlignment.isAligned ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-white text-sm">{headAlignment.message}</span>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleMeasure}
            disabled={isMeasuring || !landmarks}
            className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {isMeasuring ? 'Measuring...' : landmarks ? 'Capture Measurements' : 'Waiting for face...'}
          </button>
          <button
            type="button"
            onClick={handleRecalibrate}
            className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            Re-calibrate
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 mt-4">
            {error}
          </div>
        )}

        <style>{`.mirror-video { transform: scaleX(-1); }`}</style>
      </div>
    );
  }

  if (step === 'frame_on') {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h2 className="text-2xl font-bold mb-4">Seg Height — Put On Your Frame</h2>

        <div className="relative mb-4" ref={calibrationContainerRef}>
          <video
            ref={handleVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full rounded-lg bg-black min-h-[240px] mirror-video"
            onLoadedData={() => startFaceDetection()}
          />
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 w-full h-full mirror-video"
            onClick={handleFrameBottomClick}
          />

          <div className="absolute top-4 left-4 bg-green-500 text-white px-3 py-1 rounded-full text-sm">
            ✓ Calibrated
          </div>

          {landmarks && (
            <div className="absolute top-4 right-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-black/70">
              <div className={`w-3 h-3 rounded-full flex-shrink-0 ${headAlignment.isAligned ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-white text-sm">{headAlignment.message}</span>
            </div>
          )}

          {frameBottom != null && (
            <div
              className="absolute left-0 right-0"
              style={{ top: `${frameBottom * 100}%`, height: '2px' }}
            >
              <div
                className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-orange-500/80 rounded-full border-2 border-white shadow-lg cursor-grab active:cursor-grabbing flex items-center justify-center touch-none"
                onMouseDown={handleMarkerDragStart('frameBottom')}
                onTouchStart={handleMarkerDragStart('frameBottom')}
              >
                <span className="text-white text-xs font-bold">B</span>
              </div>
            </div>
          )}
        </div>

        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
          <h3 className="font-semibold text-orange-900 mb-2">Instructions</h3>
          <p className="text-orange-800 text-sm mb-2">
            Put on the frame you want measured, then tap the <strong>bottom inner edge of the lens</strong> on the video. Drag the orange line up or down to fine-tune the position.
          </p>
          {frameBottom == null && (
            <p className="text-orange-600 text-sm font-semibold">Waiting for you to tap the frame bottom...</p>
          )}
          {frameBottom != null && (
            <p className="text-green-600 text-sm font-semibold flex items-center gap-1">
              <CheckCircle size={16} /> Frame bottom marked at {(frameBottom * 100).toFixed(1)}%
            </p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleCaptureSegHeight}
            disabled={frameBottom == null || !landmarks}
            className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            Capture Seg Height
          </button>
          <button
            type="button"
            onClick={handleSkipSegHeight}
            className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            Skip Seg Height
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 mt-4">
            {error}
          </div>
        )}

        <style>{`.mirror-video { transform: scaleX(-1); }`}</style>
      </div>
    );
  }

  if (step === 'results' && pdResult) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <h2 className="text-2xl font-bold mb-4">Measurement Results</h2>

        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Check className="w-5 h-5 text-green-600" />
            <span className="font-semibold text-green-900">Measurements Complete</span>
          </div>
          <p className="text-sm text-green-800">
            Confidence: {Math.round(pdResult.confidence * 100)}%
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-600 mb-1">Total PD</div>
            <div className="text-3xl font-bold text-gray-900">{pdResult.pdTotal}</div>
            <div className="text-sm text-gray-500">mm</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-600 mb-1">Right PD</div>
            <div className="text-3xl font-bold text-gray-900">{pdResult.pdRight}</div>
            <div className="text-sm text-gray-500">mm</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-600 mb-1">Left PD</div>
            <div className="text-3xl font-bold text-gray-900">{pdResult.pdLeft}</div>
            <div className="text-sm text-gray-500">mm</div>
          </div>
        </div>

        {segResult && (
          <div className="bg-white border-2 border-orange-200 rounded-lg p-4 mb-6">
            <h3 className="font-semibold text-gray-900 mb-3">Seg & OC Heights</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Seg Right:</span>
                <span className="font-bold">{segResult.segHeightRight} mm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Seg Left:</span>
                <span className="font-bold">{segResult.segHeightLeft} mm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">OC Right:</span>
                <span className="font-bold">{segResult.ocHeightRight} mm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">OC Left:</span>
                <span className="font-bold">{segResult.ocHeightLeft} mm</span>
              </div>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Seg height confidence: {Math.round(segResult.confidence * 100)}%
            </div>
          </div>
        )}

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-gray-900 mb-2">Measurement Details</h3>
          <div className="space-y-1 text-sm text-gray-700">
            <div className="flex justify-between">
              <span>Method:</span>
              <span className="font-medium">{pdResult.method}</span>
            </div>
            <div className="flex justify-between">
              <span>Confidence:</span>
              <span className="font-medium">{Math.round(pdResult.confidence * 100)}%</span>
            </div>
            {calibration && (
              <div className="flex justify-between">
                <span>Calibration:</span>
                <span className="font-medium">{calibration.pixelsPerMm.toFixed(1)} px/mm ({calibration.method})</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleComplete}
            className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            Use These Measurements
          </button>
          <button
            type="button"
            onClick={() => setStep('measure')}
            className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            Re-measure
          </button>
        </div>
      </div>
    );
  }

  return null;
}
