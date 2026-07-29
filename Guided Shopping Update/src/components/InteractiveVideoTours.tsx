import { useState, useRef, useEffect } from 'react';
import { Play, Pause, RotateCw, Sun, Droplets, Eye, Maximize2 } from 'lucide-react';

interface VideoScenario {
  id: string;
  name: string;
  description: string;
  videoUrl: string;
  thumbnail: string;
  duration: string;
  treatments: {
    id: string;
    name: string;
    description: string;
    icon: React.ReactNode;
  }[];
}

export function InteractiveVideoTours() {
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTreatment, setActiveTreatment] = useState<string>('none');
  const videoRef = useRef<HTMLVideoElement>(null);

  const scenarios: VideoScenario[] = [
    {
      id: 'driving',
      name: 'Highway Driving',
      description: 'Experience enhanced visibility while driving on sunny highways',
      videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
      thumbnail: 'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=600&h=400&fit=crop',
      duration: '2:30',
      treatments: [
        { id: 'none', name: 'No Treatment', description: 'Standard vision', icon: <Eye className="w-4 h-4" /> },
        { id: 'polarized', name: 'Polarized', description: 'Reduces glare from road and vehicles', icon: <Sun className="w-4 h-4" /> },
        { id: 'photochromic', name: 'Photochromic', description: 'Auto-adjusts to light conditions', icon: <RotateCw className="w-4 h-4" /> }
      ]
    },
    {
      id: 'beach',
      name: 'Beach Day',
      description: 'See how polarization helps at the beach and on water',
      videoUrl: 'https://www.w3schools.com/html/movie.mp4',
      thumbnail: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&h=400&fit=crop',
      duration: '1:45',
      treatments: [
        { id: 'none', name: 'No Treatment', description: 'Standard vision', icon: <Eye className="w-4 h-4" /> },
        { id: 'polarized', name: 'Polarized', description: 'Eliminates water glare', icon: <Droplets className="w-4 h-4" /> },
        { id: 'uv-protection', name: 'UV Protection', description: 'Blocks harmful UV rays', icon: <Sun className="w-4 h-4" /> }
      ]
    },
    {
      id: 'office',
      name: 'Office Work',
      description: 'Reduce eye strain from screens and fluorescent lighting',
      videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
      thumbnail: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&h=400&fit=crop',
      duration: '2:15',
      treatments: [
        { id: 'none', name: 'No Treatment', description: 'Standard vision', icon: <Eye className="w-4 h-4" /> },
        { id: 'blue-light', name: 'Blue Light Filter', description: 'Reduces digital eye strain', icon: <Eye className="w-4 h-4" /> },
        { id: 'anti-reflective', name: 'Anti-Reflective', description: 'Minimizes screen glare', icon: <Sun className="w-4 h-4" /> }
      ]
    }
  ];

  const currentScenario = scenarios.find(s => s.id === selectedScenario);

  const getTreatmentFilter = (treatmentId: string) => {
    switch (treatmentId) {
      case 'polarized':
        return 'saturate(1.2) contrast(1.15) brightness(0.95)';
      case 'photochromic':
        return 'brightness(0.85) contrast(1.1)';
      case 'blue-light':
        return 'sepia(0.15) saturate(0.9) brightness(1.05)';
      case 'anti-reflective':
        return 'contrast(1.1) brightness(1.02)';
      case 'uv-protection':
        return 'contrast(1.08) saturate(1.1)';
      default:
        return '';
    }
  };

  const handlePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  useEffect(() => {
    if (videoRef.current && selectedScenario) {
      videoRef.current.load();
    }
  }, [selectedScenario]);

  if (!selectedScenario) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="container mx-auto px-4">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Interactive Video Tours</h1>
            <p className="text-gray-600">Watch real-world scenarios with different lens treatments</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {scenarios.map((scenario) => (
              <button
                key={scenario.id}
                onClick={() => setSelectedScenario(scenario.id)}
                className="group text-left bg-white rounded-lg shadow-lg overflow-hidden hover:shadow-xl transition-all transform hover:-translate-y-1"
              >
                <div className="relative aspect-video">
                  <img
                    src={scenario.thumbnail}
                    alt={scenario.name}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black bg-opacity-40 flex items-center justify-center group-hover:bg-opacity-30 transition-all">
                    <div className="w-16 h-16 bg-white bg-opacity-90 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Play className="w-8 h-8 text-red-600 ml-1" />
                    </div>
                  </div>
                  <div className="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white px-2 py-1 rounded text-xs font-medium">
                    {scenario.duration}
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="text-lg font-bold text-gray-900 mb-1">{scenario.name}</h3>
                  <p className="text-sm text-gray-600">{scenario.description}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-xs font-medium text-blue-600">
                      {scenario.treatments.length - 1} treatments available
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-12 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl shadow-xl p-8 text-white">
            <div className="max-w-3xl mx-auto text-center">
              <Maximize2 className="w-12 h-12 mx-auto mb-4 opacity-90" />
              <h2 className="text-2xl font-bold mb-3">Immersive Experience</h2>
              <p className="text-blue-100 mb-4">
                Toggle between different lens treatments in real-time to see how they enhance your vision in various scenarios.
                Experience the difference polarization, blue light filters, and other treatments make in everyday situations.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <div className="mb-6">
          <button
            onClick={() => {
              setSelectedScenario(null);
              setIsPlaying(false);
              setActiveTreatment('none');
            }}
            className="text-blue-600 hover:text-blue-700 font-medium flex items-center gap-2"
          >
            ← Back to Scenarios
          </button>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Video Player */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
              <div className="aspect-video bg-black relative">
                <video
                  ref={videoRef}
                  className="w-full h-full"
                  style={{ filter: getTreatmentFilter(activeTreatment) }}
                  loop
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                >
                  <source src={currentScenario?.videoUrl} type="video/mp4" />
                  Your browser does not support the video tag.
                </video>

                {/* Treatment Badge */}
                <div className="absolute top-4 left-4 bg-black bg-opacity-70 text-white px-4 py-2 rounded-full text-sm font-medium">
                  {currentScenario?.treatments.find(t => t.id === activeTreatment)?.name}
                </div>

                {/* Play/Pause Overlay */}
                {!isPlaying && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-40">
                    <button
                      onClick={handlePlayPause}
                      className="w-20 h-20 bg-white bg-opacity-90 rounded-full flex items-center justify-center hover:bg-opacity-100 transition-all"
                    >
                      <Play className="w-10 h-10 text-red-600 ml-2" />
                    </button>
                  </div>
                )}
              </div>

              {/* Video Controls */}
              <div className="p-4 bg-gray-50 border-t">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900">{currentScenario?.name}</h3>
                  <button
                    onClick={handlePlayPause}
                    className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                  </button>
                </div>
                <p className="text-sm text-gray-600">{currentScenario?.description}</p>
              </div>
            </div>
          </div>

          {/* Treatment Selection */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Lens Treatments</h3>
              <p className="text-sm text-gray-600 mb-4">
                Toggle different treatments to see how they enhance your vision in this scenario.
              </p>

              <div className="space-y-2">
                {currentScenario?.treatments.map((treatment) => (
                  <button
                    key={treatment.id}
                    onClick={() => setActiveTreatment(treatment.id)}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                      activeTreatment === treatment.id
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${
                        activeTreatment === treatment.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {treatment.icon}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900 mb-1">{treatment.name}</h4>
                        <p className="text-xs text-gray-600">{treatment.description}</p>
                      </div>
                      {activeTreatment === treatment.id && (
                        <div className="w-2 h-2 bg-blue-600 rounded-full mt-2"></div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-gradient-to-br from-green-600 to-green-700 rounded-lg shadow-lg p-6 text-white">
              <h3 className="text-lg font-bold mb-3">Compare Side-by-Side</h3>
              <p className="text-sm text-green-100 mb-4">
                Click through different treatments while the video plays to see instant comparisons of how each treatment affects your vision.
              </p>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-2 h-2 bg-white rounded-full"></div>
                <span className="text-green-100">Video loops for continuous comparison</span>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-3">About This Scene</h3>
              <p className="text-sm text-gray-600 mb-4">
                This {currentScenario?.name.toLowerCase()} scenario demonstrates how different lens treatments help in real-world conditions.
              </p>
              <button className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
                Learn More About Treatments
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
