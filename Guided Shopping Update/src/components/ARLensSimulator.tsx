import { useState, useRef } from 'react';
import { Smartphone, Move, ZoomIn, RotateCw, Sun, Droplets, Sparkles } from 'lucide-react';

interface LensFilter {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  filter: string;
}

export function ARLensSimulator() {
  const [selectedFilter, setSelectedFilter] = useState<string>('none');
  const [isSimulating, setIsSimulating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const filters: LensFilter[] = [
    {
      id: 'none',
      name: 'No Filter',
      description: 'Standard vision without enhancement',
      icon: <Sun className="w-5 h-5" />,
      filter: ''
    },
    {
      id: 'polarized',
      name: 'Polarized',
      description: 'Reduces glare from reflective surfaces',
      icon: <Droplets className="w-5 h-5" />,
      filter: 'brightness(0.95) contrast(1.15) saturate(1.2)'
    },
    {
      id: 'blue-light',
      name: 'Blue Light Filter',
      description: 'Blocks harmful blue light',
      icon: <Sparkles className="w-5 h-5" />,
      filter: 'sepia(0.15) brightness(0.95) contrast(1.05)'
    },
    {
      id: 'ar-coating',
      name: 'Anti-Reflective',
      description: 'Reduces reflections and glare',
      icon: <Sun className="w-5 h-5" />,
      filter: 'brightness(1.05) contrast(1.1)'
    },
    {
      id: 'transitions',
      name: 'Photochromic',
      description: 'Auto-darkening in sunlight',
      icon: <Sun className="w-5 h-5" />,
      filter: 'brightness(0.7) contrast(1.2) sepia(0.1)'
    }
  ];

  const startAR = async () => {
    setIsLoading(true);
    try {
      console.log('AR: Requesting camera access...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: 1280, height: 720 } 
      });
      console.log('AR: Camera stream obtained:', stream);
      console.log('AR: Video ref exists:', !!videoRef.current);
      
      if (!videoRef.current) {
        console.error('AR: Video element not found!');
        throw new Error('Video element not available');
      }
      
      console.log('AR: Setting video source...');
      videoRef.current.srcObject = stream;
      console.log('AR: Video srcObject set, waiting for metadata...');
      
      // Wait for metadata to load with timeout
      await Promise.race([
        new Promise((resolve, reject) => {
          if (videoRef.current) {
            videoRef.current.onloadedmetadata = () => {
              console.log('AR: Video metadata loaded');
              console.log('AR: Video dimensions:', videoRef.current?.videoWidth, 'x', videoRef.current?.videoHeight);
              resolve(true);
            };
            videoRef.current.onerror = (e) => {
              console.error('AR: Video error:', e);
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
      console.log('AR: About to play video...');
      if (videoRef.current) {
        try {
          await videoRef.current.play();
          console.log('AR: Video playing successfully');
          setIsSimulating(true);
        } catch (playErr) {
          console.error('AR: Play error:', playErr);
          throw playErr;
        }
      }
    } catch (err) {
      console.error('AR: Error in startAR:', err);
      alert(`Unable to start AR camera: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const stopAR = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setIsSimulating(false);
    }
  };

  const currentFilter = filters.find(f => f.id === selectedFilter);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">AR Lens Simulator</h1>
          <p className="text-gray-600">Experience how different lens treatments affect your real-world view</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* AR View */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
              <div className="aspect-[16/9] bg-gray-900 relative">
                {/* Video element - always in DOM */}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${!isSimulating ? 'hidden' : ''}`}
                  style={{ filter: currentFilter?.filter }}
                />

                {!isSimulating && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-blue-900 to-blue-700">
                    <div className="text-center">
                      {isLoading ? (
                        <>
                          <div className="w-20 h-20 mx-auto mb-4 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
                          <h3 className="text-white text-2xl font-semibold mb-2">
                            Starting AR Camera...
                          </h3>
                          <p className="text-blue-200 mb-2">
                            Accessing your camera
                          </p>
                          <p className="text-blue-300 text-sm">
                            Check browser console (F12) if this takes too long
                          </p>
                        </>
                      ) : (
                        <>
                          <Smartphone className="w-20 h-20 text-white mx-auto mb-4" />
                          <h3 className="text-white text-2xl font-semibold mb-2">
                            Augmented Reality Lens Simulator
                          </h3>
                          <p className="text-blue-200 mb-6">
                            Point your camera at your surroundings to see lens effects in real-time
                          </p>
                          <button
                            onClick={startAR}
                            className="px-8 py-4 bg-white text-blue-700 rounded-lg hover:bg-blue-50 transition-colors font-semibold text-lg"
                          >
                            Start AR Experience
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {isSimulating && (
                  <>
                    {/* AR Overlay */}
                    <div className="absolute inset-0 pointer-events-none">
                      {/* Corner Markers */}
                      <div className="absolute top-4 left-4 w-12 h-12 border-l-4 border-t-4 border-white opacity-50"></div>
                      <div className="absolute top-4 right-4 w-12 h-12 border-r-4 border-t-4 border-white opacity-50"></div>
                      <div className="absolute bottom-4 left-4 w-12 h-12 border-l-4 border-b-4 border-white opacity-50"></div>
                      <div className="absolute bottom-4 right-4 w-12 h-12 border-r-4 border-b-4 border-white opacity-50"></div>
                      
                      {/* Current Filter Badge */}
                      <div className="absolute top-6 left-1/2 -translate-x-1/2">
                        <div className="bg-black bg-opacity-70 text-white px-4 py-2 rounded-full text-sm font-medium">
                          {currentFilter?.name}
                        </div>
                      </div>

                      {/* Instructions */}
                      <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
                        <div className="flex items-center gap-4 bg-black bg-opacity-70 text-white px-4 py-2 rounded-full text-sm">
                          <Move className="w-4 h-4" />
                          <span>Move camera around</span>
                          <ZoomIn className="w-4 h-4" />
                          <span>Focus on objects</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {isSimulating && (
                <div className="p-4 bg-gray-50 border-t flex justify-center">
                  <button
                    onClick={stopAR}
                    className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    Stop AR Experience
                  </button>
                </div>
              )}
            </div>

            {/* AR Features */}
            <div className="mt-6 grid grid-cols-3 gap-4">
              <div className="bg-white rounded-lg p-4 text-center shadow">
                <RotateCw className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                <h4 className="font-semibold text-sm">Real-Time</h4>
                <p className="text-xs text-gray-600">Instant filter application</p>
              </div>
              <div className="bg-white rounded-lg p-4 text-center shadow">
                <ZoomIn className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                <h4 className="font-semibold text-sm">Interactive</h4>
                <p className="text-xs text-gray-600">Move and explore</p>
              </div>
              <div className="bg-white rounded-lg p-4 text-center shadow">
                <Smartphone className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                <h4 className="font-semibold text-sm">Mobile Ready</h4>
                <p className="text-xs text-gray-600">Works on phones</p>
              </div>
            </div>
          </div>

          {/* Filter Selection */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-lg p-6 sticky top-4">
              <h2 className="text-xl font-semibold mb-4">Lens Treatments</h2>
              <div className="space-y-3">
                {filters.map((filter) => (
                  <button
                    key={filter.id}
                    onClick={() => setSelectedFilter(filter.id)}
                    disabled={!isSimulating}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                      selectedFilter === filter.id
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-200 hover:border-blue-300'
                    } ${!isSimulating ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${
                        selectedFilter === filter.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {filter.icon}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">{filter.name}</h3>
                        <p className="text-sm text-gray-600 mt-1">{filter.description}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-6 pt-6 border-t">
                <h3 className="font-semibold mb-3 text-gray-900">Experience Benefits:</h3>
                <ul className="text-sm text-gray-600 space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 mt-0.5">✓</span>
                    <span>See effects on your actual environment</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 mt-0.5">✓</span>
                    <span>Compare multiple treatments instantly</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 mt-0.5">✓</span>
                    <span>Make informed decisions</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 mt-0.5">✓</span>
                    <span>Try before you buy</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
