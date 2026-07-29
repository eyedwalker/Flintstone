import { useState, useEffect } from 'react';
import { BeforeAfterSlider } from './BeforeAfterSlider';
import { Sun, Moon, Droplets, Eye, Glasses, Shield } from 'lucide-react';

interface DemoScenario {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
  beforeImage: string;
  afterImage: string;
  beforeLabel: string;
  afterLabel: string;
  beforeEffect: string;
  afterEffect: string;
  benefits: string[];
}

interface LensDemoProps {
  initialScenario?: string;
}

export function LensDemo({ initialScenario }: LensDemoProps) {
  const scenarios: DemoScenario[] = [
    {
      id: 'polarization',
      name: 'Polarization',
      icon: <Sun className="w-6 h-6" />,
      description: 'Reduces glare from reflective surfaces like water, snow, and roads',
      beforeImage: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&h=600&fit=crop',
      afterImage: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&h=600&fit=crop',
      beforeLabel: 'Without Polarization',
      afterLabel: 'With Polarization',
      beforeEffect: 'brightness-125 contrast-75',
      afterEffect: 'brightness-100 contrast-110 saturate-110',
      benefits: [
        'Eliminates glare from horizontal surfaces',
        'Enhances visual clarity and comfort',
        'Reduces eye strain in bright conditions',
        'Improves contrast and color perception'
      ]
    },
    {
      id: 'blue-light',
      name: 'Blue Light Filter',
      icon: <Eye className="w-6 h-6" />,
      description: 'Filters harmful blue light from digital screens and LED lighting',
      beforeImage: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&h=600&fit=crop',
      afterImage: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&h=600&fit=crop',
      beforeLabel: 'Without Blue Light Filter',
      afterLabel: 'With Blue Light Filter',
      beforeEffect: 'hue-rotate-[200deg] brightness-110',
      afterEffect: 'sepia-[15%] brightness-95 contrast-105',
      benefits: [
        'Reduces digital eye strain',
        'Improves sleep quality',
        'Minimizes exposure to harmful blue light',
        'More comfortable screen time'
      ]
    },
    {
      id: 'anti-reflective',
      name: 'Anti-Reflective Coating',
      icon: <Shield className="w-6 h-6" />,
      description: 'Eliminates reflections and improves light transmission through lenses',
      beforeImage: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=800&h=600&fit=crop',
      afterImage: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=800&h=600&fit=crop',
      beforeLabel: 'Without AR Coating',
      afterLabel: 'With AR Coating',
      beforeEffect: 'brightness-90 opacity-85',
      afterEffect: 'brightness-105 contrast-110',
      benefits: [
        'Reduces reflections and glare',
        'Increases light transmission by 99.5%',
        'Clearer vision in all conditions',
        'Lenses look nearly invisible'
      ]
    },
    {
      id: 'night-driving',
      name: 'Night Driving Enhancement',
      icon: <Moon className="w-6 h-6" />,
      description: 'Reduces halos and glare from headlights for safer night driving',
      beforeImage: 'https://images.unsplash.com/photo-1519003722824-194d4455a60c?w=800&h=600&fit=crop',
      afterImage: 'https://images.unsplash.com/photo-1519003722824-194d4455a60c?w=800&h=600&fit=crop',
      beforeLabel: 'Standard Lenses',
      afterLabel: 'Night Driving Coating',
      beforeEffect: 'brightness-75 blur-[0.5px]',
      afterEffect: 'brightness-95 contrast-115 saturate-105',
      benefits: [
        'Reduces glare from oncoming headlights',
        'Minimizes halos around lights',
        'Improves contrast in low light',
        'Safer and more comfortable night driving'
      ]
    },
    {
      id: 'photochromic',
      name: 'Photochromic (Transitions)',
      icon: <Glasses className="w-6 h-6" />,
      description: 'Automatically adjusts tint based on UV exposure',
      beforeImage: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=600&fit=crop',
      afterImage: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=600&fit=crop',
      beforeLabel: 'Indoors (Clear)',
      afterLabel: 'Outdoors (Dark)',
      beforeEffect: 'brightness-100',
      afterEffect: 'brightness-60 contrast-120 sepia-[10%]',
      benefits: [
        'Adapts to changing light conditions',
        'UV protection indoors and out',
        'No need for separate sunglasses',
        'Comfortable vision in any environment'
      ]
    },
    {
      id: 'water-reflection',
      name: 'Water Polarization',
      icon: <Droplets className="w-6 h-6" />,
      description: 'See through water surface reflections for fishing and water sports',
      beforeImage: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&h=600&fit=crop',
      afterImage: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&h=600&fit=crop',
      beforeLabel: 'Without Polarization',
      afterLabel: 'With Polarization',
      beforeEffect: 'brightness-125 saturate-75 blur-[0.3px]',
      afterEffect: 'brightness-95 saturate-120 contrast-115',
      benefits: [
        'See beneath water surface',
        'Reduces surface glare',
        'Better for fishing and boating',
        'Enhanced color and detail'
      ]
    }
  ];

  const getInitialIndex = () => {
    if (!initialScenario) return 0;
    const index = scenarios.findIndex(s => s.id === initialScenario);
    return index >= 0 ? index : 0;
  };

  const [selectedScenario, setSelectedScenario] = useState(getInitialIndex());

  useEffect(() => {
    if (initialScenario) {
      const index = scenarios.findIndex(s => s.id === initialScenario);
      if (index >= 0) {
        setSelectedScenario(index);
      }
    }
  }, [initialScenario]);

  const currentScenario = scenarios[selectedScenario];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-slate-900 text-white py-8">
        <div className="container mx-auto px-4">
          <h1 className="text-3xl font-bold text-center mb-2">
            Interactive Lens Treatment Demo
          </h1>
          <p className="text-center text-gray-300">
            Slide the divider to see how different lens treatments improve your vision
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Scenario Selection */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm p-6 sticky top-4">
              <h2 className="text-xl font-semibold mb-4">Select Treatment</h2>
              <div className="space-y-2">
                {scenarios.map((scenario, index) => (
                  <button
                    key={scenario.id}
                    onClick={() => setSelectedScenario(index)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all ${
                      selectedScenario === index
                        ? 'bg-blue-700 text-white shadow-md'
                        : 'bg-gray-50 hover:bg-gray-100 text-gray-700'
                    }`}
                  >
                    <div className={selectedScenario === index ? 'text-white' : 'text-blue-700'}>
                      {scenario.icon}
                    </div>
                    <span className="font-medium text-left">{scenario.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Demo Area */}
          <div className="lg:col-span-2 space-y-6">
            {/* Before/After Slider */}
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <div className="aspect-[4/3] relative">
                <BeforeAfterSlider
                  beforeImage={currentScenario.beforeImage}
                  afterImage={currentScenario.afterImage}
                  beforeLabel={currentScenario.beforeLabel}
                  afterLabel={currentScenario.afterLabel}
                  beforeEffect={currentScenario.beforeEffect}
                  afterEffect={currentScenario.afterEffect}
                />
              </div>
              <div className="p-4 bg-blue-50 border-t-2 border-blue-200">
                <p className="text-sm text-gray-700 flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-medium">Drag the slider left and right to compare</span>
                </p>
              </div>
            </div>

            {/* Treatment Info */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-start gap-4 mb-4">
                <div className="p-3 bg-blue-100 rounded-lg text-blue-700">
                  {currentScenario.icon}
                </div>
                <div className="flex-1">
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">
                    {currentScenario.name}
                  </h3>
                  <p className="text-gray-600">
                    {currentScenario.description}
                  </p>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold text-gray-900 mb-3">Key Benefits:</h4>
                <ul className="space-y-2">
                  {currentScenario.benefits.map((benefit, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <svg
                        className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      <span className="text-gray-700">{benefit}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-6 pt-6 border-t">
                <button className="w-full bg-blue-700 text-white py-3 px-6 rounded-lg hover:bg-blue-800 transition-colors font-semibold">
                  Add {currentScenario.name} to My Order
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
