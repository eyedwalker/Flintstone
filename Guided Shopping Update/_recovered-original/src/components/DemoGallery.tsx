import { Eye, Smartphone, Glasses, Lightbulb, Video, Image as ImageIcon, ShoppingCart, Ruler, Scan, Layers } from 'lucide-react';

interface DemoOption {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  features: string[];
  path: string;
}

interface DemoGalleryProps {
  onSelectDemo: (demoId: string) => void;
}

export function DemoGallery({ onSelectDemo }: DemoGalleryProps) {
  const demos: DemoOption[] = [
    {
      id: 'lens-comparison',
      name: 'Interactive Lens Comparison',
      description: 'Drag slider to compare different lens treatments side-by-side',
      icon: <Lightbulb className="w-8 h-8" />,
      color: 'from-blue-500 to-blue-700',
      features: [
        'Before/After slider',
        '6 treatment scenarios',
        'Real photo comparisons',
        'Detailed benefits'
      ],
      path: 'lens-demo'
    },
    {
      id: 'ar-simulator',
      name: 'AR Lens Simulator',
      description: 'Experience lens treatments on your real-world view using your camera',
      icon: <Smartphone className="w-8 h-8" />,
      color: 'from-purple-500 to-purple-700',
      features: [
        'Real-time camera feed',
        'Live filter application',
        'Interactive exploration',
        'Mobile compatible'
      ],
      path: 'ar-simulator'
    },
    {
      id: 'virtual-tryon',
      name: 'Virtual Frame Try-On',
      description: 'See how different frames look on your face with live webcam',
      icon: <Glasses className="w-8 h-8" />,
      color: 'from-green-500 to-green-700',
      features: [
        'Live webcam overlay',
        'Multiple frame styles',
        'Capture & save photos',
        'Share with friends'
      ],
      path: 'virtual-tryon'
    },
    {
      id: 'vision-conditions',
      name: 'Vision Condition Simulator',
      description: 'Experience how different eye conditions affect vision',
      icon: <Eye className="w-8 h-8" />,
      color: 'from-orange-500 to-orange-700',
      features: [
        'Myopia simulation',
        'Astigmatism effects',
        'Presbyopia experience',
        'Educational content'
      ],
      path: 'vision-conditions'
    },
    {
      id: 'video-tours',
      name: 'Interactive Video Tours',
      description: 'Watch 360° videos showing real-world scenarios with different lenses',
      icon: <Video className="w-8 h-8" />,
      color: 'from-red-500 to-red-700',
      features: [
        '360° video playback',
        'Multiple scenarios',
        'Toggle treatments',
        'Immersive experience'
      ],
      path: 'video-tours'
    },
    {
      id: 'lifestyle-gallery',
      name: 'Lifestyle Image Gallery',
      description: 'Browse curated photos showing lens benefits in various activities',
      icon: <ImageIcon className="w-8 h-8" />,
      color: 'from-teal-500 to-teal-700',
      features: [
        'Activity-based photos',
        'Professional imagery',
        'Filter comparisons',
        'Download options'
      ],
      path: 'lifestyle-gallery'
    },
    {
      id: 'guided-shopping',
      name: 'Guided Shopping Experience',
      description: 'Step-by-step eyewear selection with real-time pricing and package builder',
      icon: <ShoppingCart className="w-8 h-8" />,
      color: 'from-indigo-500 to-indigo-700',
      features: [
        'Interactive package builder',
        'Real-time price calculation',
        'Frame & lens selection',
        'Quote generation'
      ],
      path: 'guided-shopping'
    },
    {
      id: 'facial-measurements',
      name: 'Facial Measurements',
      description: 'Precision PD, seg height, and OC measurements using camera and AI',
      icon: <Ruler className="w-8 h-8" />,
      color: 'from-emerald-500 to-emerald-700',
      features: [
        'PD measurement',
        'Seg height calculation',
        'OC height detection',
        'Save & export data'
      ],
      path: 'facial-measurements'
    },
    {
      id: 'frame-scanner',
      name: 'Frame Scanner',
      description: 'Scan frame barcodes to save favorites and build your collection',
      icon: <Scan className="w-8 h-8" />,
      color: 'from-amber-500 to-amber-700',
      features: [
        'Barcode scanning',
        'Frame catalog lookup',
        'Favorites management',
        'Manual UPC entry'
      ],
      path: 'frame-scanner'
    },
    {
      id: 'lens-materials',
      name: 'Lens Material Comparison',
      description: "See thickness and weight for every lens material driven by the patient's Rx",
      icon: <Layers className="w-8 h-8" />,
      color: 'from-cyan-500 to-cyan-700',
      features: [
        'Rx-driven thickness calc',
        'Pair weight per material',
        'Cross-section visuals',
        'Auto-recommended index'
      ],
      path: 'lens-materials'
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-3">
            Experience Center
          </h1>
          <p className="text-xl text-gray-600">
            Explore innovative ways to visualize and understand lens treatments
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {demos.map((demo) => (
            <button
              key={demo.id}
              onClick={() => onSelectDemo(demo.id)}
              className="group text-left bg-white rounded-xl shadow-lg hover:shadow-xl transition-all overflow-hidden transform hover:-translate-y-1"
            >
              {/* Header */}
              <div className={`bg-gradient-to-br ${demo.color} p-6 text-white`}>
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 bg-white bg-opacity-20 rounded-lg">
                    {demo.icon}
                  </div>
                  <div className="px-3 py-1 bg-white bg-opacity-20 rounded-full text-xs font-medium">
                    Interactive
                  </div>
                </div>
                <h3 className="text-xl font-bold mb-2">{demo.name}</h3>
                <p className="text-sm opacity-90">{demo.description}</p>
              </div>

              {/* Features */}
              <div className="p-6">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Features:</h4>
                <ul className="space-y-2">
                  {demo.features.map((feature, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-gray-600">
                      <svg className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                      </svg>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-6 pt-4 border-t">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Click to explore</span>
                    <svg className="w-5 h-5 text-blue-600 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Why Experience Matters */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 text-center">
            Why Visualization Matters
          </h2>
          <div className="grid md:grid-cols-3 gap-6 text-center">
            <div>
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Eye className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Better Understanding</h3>
              <p className="text-gray-600 text-sm">
                See exactly how treatments improve your vision in real-world scenarios
              </p>
            </div>
            <div>
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Lightbulb className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Informed Decisions</h3>
              <p className="text-gray-600 text-sm">
                Compare options side-by-side to choose the best solution for your needs
              </p>
            </div>
            <div>
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Smartphone className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Confidence</h3>
              <p className="text-gray-600 text-sm">
                Try before you buy with interactive simulations and virtual try-ons
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
