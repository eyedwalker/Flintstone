import { useState, useRef, useEffect } from 'react';
import { Camera, RotateCcw, Download } from 'lucide-react';

interface Frame {
  id: string;
  name: string;
  brand: string;
  price: number;
  imageUrl: string;
  style: string;
}

export function VirtualTryOn() {
  const [isWebcamActive, setIsWebcamActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFrame, setSelectedFrame] = useState<Frame | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const frames: Frame[] = [
    {
      id: '1',
      name: 'Classic Aviator',
      brand: 'VSP Collection',
      price: 149,
      imageUrl: 'https://images.unsplash.com/photo-1577803645773-f96470509666?w=400&h=150&fit=crop',
      style: 'Metal'
    },
    {
      id: '2',
      name: 'Modern Wayfarer',
      brand: 'VSP Elite',
      price: 199,
      imageUrl: 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=400&h=150&fit=crop',
      style: 'Acetate'
    },
    {
      id: '3',
      name: 'Professional Round',
      brand: 'VSP Premium',
      price: 179,
      imageUrl: 'https://images.unsplash.com/photo-1574258495973-f010dfbb5371?w=400&h=150&fit=crop',
      style: 'Metal'
    },
    {
      id: '4',
      name: 'Sport Performance',
      brand: 'VSP Active',
      price: 229,
      imageUrl: 'https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=400&h=150&fit=crop',
      style: 'Plastic'
    }
  ];

  const startWebcam = async () => {
    setIsLoading(true);
    try {
      console.log('Requesting camera access...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: 1280, height: 720 } 
      });
      console.log('Camera stream obtained:', stream);
      console.log('Video ref exists:', !!videoRef.current);
      
      if (!videoRef.current) {
        console.error('Video element not found!');
        throw new Error('Video element not available');
      }
      
      console.log('Setting video source...');
      videoRef.current.srcObject = stream;
      console.log('Video srcObject set, waiting for metadata...');
      
      // Wait for metadata to load with timeout
      await Promise.race([
        new Promise((resolve, reject) => {
          if (videoRef.current) {
            videoRef.current.onloadedmetadata = () => {
              console.log('Video metadata loaded');
              console.log('Video dimensions:', videoRef.current?.videoWidth, 'x', videoRef.current?.videoHeight);
              resolve(true);
            };
            videoRef.current.onerror = (e) => {
              console.error('Video error:', e);
              reject(e);
            };
          } else {
            reject(new Error('Video ref lost'));
          }
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Metadata load timeout')), 5000)
        )
      ]);
      
      // Explicitly play the video
      console.log('About to play video...');
      if (videoRef.current) {
        try {
          await videoRef.current.play();
          console.log('Video playing successfully');
          setIsWebcamActive(true);
        } catch (playErr) {
          console.error('Play error:', playErr);
          throw playErr;
        }
      }
    } catch (err) {
      console.error('Error in startWebcam:', err);
      alert(`Unable to start webcam: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const stopWebcam = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setIsWebcamActive(false);
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        const imageData = canvasRef.current.toDataURL('image/png');
        setCapturedImage(imageData);
        stopWebcam();
      }
    }
  };

  const downloadImage = () => {
    if (capturedImage) {
      const link = document.createElement('a');
      link.download = `virtual-tryon-${selectedFrame?.name || 'frame'}.png`;
      link.href = capturedImage;
      link.click();
    }
  };

  const resetCapture = () => {
    setCapturedImage(null);
    startWebcam();
  };

  useEffect(() => {
    return () => {
      stopWebcam();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Virtual Frame Try-On</h1>
          <p className="text-gray-600">See how frames look on you in real-time</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Camera View */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
              <div className="aspect-[4/3] bg-gray-900 relative">
                {/* Video element - always in DOM */}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${!isWebcamActive ? 'hidden' : ''}`}
                />

                {!isWebcamActive && !capturedImage && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      {isLoading ? (
                        <>
                          <div className="w-20 h-20 mx-auto mb-4 border-4 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                          <p className="text-white mb-2">Starting camera...</p>
                          <p className="text-gray-400 text-sm">Check browser console if this takes too long</p>
                        </>
                      ) : (
                        <>
                          <Camera className="w-20 h-20 text-gray-400 mx-auto mb-4" />
                          <p className="text-white mb-4">Ready to try on frames?</p>
                          <button
                            onClick={startWebcam}
                            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                          >
                            Start Camera
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {isWebcamActive && selectedFrame && (
                  <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 opacity-70">
                    <img
                      src={selectedFrame.imageUrl}
                      alt={selectedFrame.name}
                      className="w-full"
                    />
                  </div>
                )}

                {capturedImage && (
                  <img
                    src={capturedImage}
                    alt="Captured"
                    className="w-full h-full object-cover"
                  />
                )}

                <canvas ref={canvasRef} className="hidden" />
              </div>

              {/* Controls */}
              {isWebcamActive && (
                <div className="p-4 bg-gray-50 border-t flex justify-center gap-3">
                  <button
                    onClick={capturePhoto}
                    disabled={!selectedFrame}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <Camera className="w-5 h-5" />
                    Capture Photo
                  </button>
                  <button
                    onClick={stopWebcam}
                    className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                  >
                    Stop Camera
                  </button>
                </div>
              )}

              {capturedImage && (
                <div className="p-4 bg-gray-50 border-t flex justify-center gap-3">
                  <button
                    onClick={downloadImage}
                    className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
                  >
                    <Download className="w-5 h-5" />
                    Download Photo
                  </button>
                  <button
                    onClick={resetCapture}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                  >
                    <RotateCcw className="w-5 h-5" />
                    Try Again
                  </button>
                </div>
              )}

              {!selectedFrame && isWebcamActive && (
                <div className="p-4 bg-yellow-50 border-t border-yellow-200">
                  <p className="text-sm text-yellow-800 text-center">
                    👈 Select a frame from the list to see it on your face
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Frame Selection */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-lg p-6 sticky top-4">
              <h2 className="text-xl font-semibold mb-4">Select Frame</h2>
              <div className="space-y-3">
                {frames.map((frame) => (
                  <button
                    key={frame.id}
                    onClick={() => setSelectedFrame(frame)}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                      selectedFrame?.id === frame.id
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    <div className="flex gap-3">
                      <img
                        src={frame.imageUrl}
                        alt={frame.name}
                        className="w-20 h-12 object-cover rounded"
                      />
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">{frame.name}</h3>
                        <p className="text-sm text-gray-600">{frame.brand}</p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-gray-500">{frame.style}</span>
                          <span className="font-semibold text-blue-700">${frame.price}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-6 pt-6 border-t">
                <h3 className="font-semibold mb-2 text-gray-900">How it works:</h3>
                <ol className="text-sm text-gray-600 space-y-2">
                  <li>1. Click "Start Camera" to activate webcam</li>
                  <li>2. Select a frame from the list</li>
                  <li>3. See the frame overlaid on your face</li>
                  <li>4. Capture and save your favorite looks</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
