import { useState } from 'react';
import { Eye, AlertCircle, Glasses, BookOpen } from 'lucide-react';

interface Condition {
  id: string;
  name: string;
  shortName: string;
  description: string;
  symptoms: string[];
  filter: string;
  icon: React.ReactNode;
  severity: 'mild' | 'moderate' | 'severe';
  explanation: string;
}

export function VisionConditionSimulator() {
  const [selectedCondition, setSelectedCondition] = useState<string>('normal');
  const [severity, setSeverity] = useState<'mild' | 'moderate' | 'severe'>('moderate');

  const conditions: Condition[] = [
    {
      id: 'normal',
      name: 'Normal Vision',
      shortName: 'Normal',
      description: 'Clear, sharp vision at all distances',
      symptoms: ['Clear distance vision', 'Sharp near vision', 'No distortion'],
      filter: '',
      icon: <Eye className="w-6 h-6" />,
      severity: 'mild',
      explanation: 'Normal vision allows you to see clearly at all distances without correction.'
    },
    {
      id: 'myopia',
      name: 'Myopia (Nearsightedness)',
      shortName: 'Myopia',
      description: 'Difficulty seeing distant objects clearly',
      symptoms: ['Blurry distance vision', 'Squinting', 'Eye strain', 'Headaches'],
      filter: 'blur(4px)',
      icon: <AlertCircle className="w-6 h-6" />,
      severity: 'moderate',
      explanation: 'Objects far away appear blurry while close-up vision remains clear. Light focuses in front of the retina instead of directly on it.'
    },
    {
      id: 'hyperopia',
      name: 'Hyperopia (Farsightedness)',
      shortName: 'Hyperopia',
      description: 'Difficulty focusing on nearby objects',
      symptoms: ['Blurry near vision', 'Eye fatigue when reading', 'Difficulty focusing', 'Headaches'],
      filter: 'blur(3px) brightness(1.1)',
      icon: <BookOpen className="w-6 h-6" />,
      severity: 'moderate',
      explanation: 'Nearby objects appear blurry, making reading and close work difficult. Light focuses behind the retina.'
    },
    {
      id: 'astigmatism',
      name: 'Astigmatism',
      shortName: 'Astigmatism',
      description: 'Distorted or blurred vision at all distances',
      symptoms: ['Distorted vision', 'Blurred edges', 'Double vision', 'Eye strain'],
      filter: 'blur(2px) contrast(0.9)',
      icon: <Glasses className="w-6 h-6" />,
      severity: 'moderate',
      explanation: 'The cornea or lens has an irregular shape, causing light to focus unevenly and creating distorted vision.'
    },
    {
      id: 'presbyopia',
      name: 'Presbyopia',
      shortName: 'Presbyopia',
      description: 'Age-related difficulty focusing on close objects',
      symptoms: ['Need to hold reading material far away', 'Blurry near vision', 'Eye fatigue', 'Headaches when reading'],
      filter: 'blur(3px) brightness(0.95)',
      icon: <BookOpen className="w-6 h-6" />,
      severity: 'moderate',
      explanation: 'A natural aging process where the eye\'s lens loses flexibility, making it harder to focus on nearby objects. Typically begins around age 40.'
    }
  ];

  const getSeverityFilter = (baseFilter: string, sev: 'mild' | 'moderate' | 'severe') => {
    if (!baseFilter) return '';
    
    const blurMatch = baseFilter.match(/blur\((\d+)px\)/);
    if (blurMatch) {
      const baseBlur = parseInt(blurMatch[1]);
      const multiplier = sev === 'mild' ? 0.5 : sev === 'severe' ? 1.5 : 1;
      return baseFilter.replace(/blur\(\d+px\)/, `blur(${Math.round(baseBlur * multiplier)}px)`);
    }
    return baseFilter;
  };

  const currentCondition = conditions.find(c => c.id === selectedCondition) || conditions[0];
  const appliedFilter = getSeverityFilter(currentCondition.filter, severity);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Vision Condition Simulator</h1>
          <p className="text-gray-600">Experience how different eye conditions affect vision</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Simulation View */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
              {/* Simulated Vision */}
              <div className="aspect-[16/9] relative overflow-hidden bg-gradient-to-br from-blue-50 to-blue-100">
                <div 
                  className="absolute inset-0"
                  style={{ filter: appliedFilter }}
                >
                  {/* Sample Scene */}
                  <img
                    src="https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1200&h=675&fit=crop"
                    alt="City street scene"
                    className="w-full h-full object-cover"
                  />
                  
                  {/* Text Overlay for Reading Test */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="bg-white bg-opacity-90 p-8 rounded-lg max-w-md">
                      <h3 className="text-2xl font-bold mb-4 text-gray-900">Eye Chart Sample</h3>
                      <div className="space-y-2 text-center">
                        <p className="text-4xl font-bold">E</p>
                        <p className="text-3xl font-bold">F P</p>
                        <p className="text-2xl font-semibold">T O Z</p>
                        <p className="text-xl">L P E D</p>
                        <p className="text-lg">P E C F D</p>
                        <p className="text-base">E D F C Z P</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Condition Badge */}
                <div className="absolute top-4 left-4 bg-black bg-opacity-70 text-white px-4 py-2 rounded-full">
                  <div className="flex items-center gap-2">
                    {currentCondition.icon}
                    <span className="font-semibold">{currentCondition.shortName}</span>
                  </div>
                </div>

                {/* Severity Indicator */}
                {selectedCondition !== 'normal' && (
                  <div className="absolute top-4 right-4 bg-black bg-opacity-70 text-white px-4 py-2 rounded-full text-sm">
                    Severity: {severity.charAt(0).toUpperCase() + severity.slice(1)}
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="p-6 bg-gray-50 border-t space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Condition Type
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {conditions.map((condition) => (
                      <button
                        key={condition.id}
                        onClick={() => setSelectedCondition(condition.id)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          selectedCondition === condition.id
                            ? 'bg-blue-700 text-white'
                            : 'bg-white text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {condition.shortName}
                      </button>
                    ))}
                  </div>
                </div>

                {selectedCondition !== 'normal' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Severity Level
                    </label>
                    <div className="flex gap-2">
                      {(['mild', 'moderate', 'severe'] as const).map((level) => (
                        <button
                          key={level}
                          onClick={() => setSeverity(level)}
                          className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            severity === level
                              ? 'bg-orange-600 text-white'
                              : 'bg-white text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          {level.charAt(0).toUpperCase() + level.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Information Panel */}
          <div className="space-y-6">
            {/* Condition Info */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-blue-100 rounded-lg text-blue-700">
                  {currentCondition.icon}
                </div>
                <h3 className="text-xl font-bold text-gray-900">{currentCondition.name}</h3>
              </div>
              
              <p className="text-gray-700 mb-4">{currentCondition.description}</p>
              
              <div className="mb-4">
                <h4 className="font-semibold text-gray-900 mb-2">Common Symptoms:</h4>
                <ul className="space-y-1">
                  {currentCondition.symptoms.map((symptom, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-gray-600">
                      <svg className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{symptom}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-gray-700">{currentCondition.explanation}</p>
              </div>
            </div>

            {/* Educational Info */}
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg shadow-lg p-6 text-white">
              <h3 className="text-lg font-bold mb-3">How Corrective Lenses Help</h3>
              <p className="text-sm text-blue-100 mb-4">
                Prescription lenses bend light rays to focus correctly on your retina, providing clear, comfortable vision at the distances you need.
              </p>
              <button className="w-full px-4 py-2 bg-white text-blue-700 rounded-lg hover:bg-blue-50 transition-colors font-semibold text-sm">
                Learn About Solutions
              </button>
            </div>

            {/* Statistics */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Did You Know?</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-2">
                  <span className="text-2xl font-bold text-blue-600">42%</span>
                  <p className="text-gray-600 mt-1">of Americans have myopia</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-2xl font-bold text-blue-600">90%</span>
                  <p className="text-gray-600 mt-1">of people over 45 develop presbyopia</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-2xl font-bold text-blue-600">1 in 3</span>
                  <p className="text-gray-600 mt-1">people have astigmatism</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
