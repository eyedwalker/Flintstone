import { useState } from 'react';
import { Ruler, User, Eye, Download, Save, Zap } from 'lucide-react';
import FacialMeasurement from './FacialMeasurement';
import FacialMeasurementAdvanced from './FacialMeasurementAdvanced';
import { PDMeasurement, CalibrationData } from '../lib/services/measurement-service';

interface SavedMeasurement {
  id: string;
  patientName?: string;
  pd: PDMeasurement;
  segHeight?: any;
  calibration: CalibrationData;
  depthMap?: any;
  faceGeometry?: any;
  timestamp: string;
  measurementType: 'simple' | 'advanced';
}

export default function FacialMeasurementDemo() {
  const [savedMeasurements, setSavedMeasurements] = useState<SavedMeasurement[]>(() => {
    const saved = localStorage.getItem('savedMeasurements');
    return saved ? JSON.parse(saved) : [];
  });
  const [showMeasurement, setShowMeasurement] = useState(false);
  const [measurementMode, setMeasurementMode] = useState<'simple' | 'advanced'>('simple');
  const [currentMeasurement, setCurrentMeasurement] = useState<SavedMeasurement | null>(null);
  const [patientName, setPatientName] = useState('');

  const handleMeasurementComplete = (data: {
    pd: PDMeasurement;
    segHeight?: any;
    calibration: CalibrationData;
    depthMap?: any;
    faceGeometry?: any;
  }) => {
    const measurement: SavedMeasurement = {
      id: Date.now().toString(),
      patientName: patientName || 'Patient',
      pd: data.pd,
      segHeight: data.segHeight,
      calibration: data.calibration,
      depthMap: data.depthMap,
      faceGeometry: data.faceGeometry,
      timestamp: new Date().toISOString(),
      measurementType: measurementMode
    };

    const updated = [measurement, ...savedMeasurements];
    setSavedMeasurements(updated);
    localStorage.setItem('savedMeasurements', JSON.stringify(updated));
    
    setCurrentMeasurement(measurement);
    setShowMeasurement(false);
    setPatientName('');
  };

  const deleteMeasurement = (id: string) => {
    const updated = savedMeasurements.filter(m => m.id !== id);
    setSavedMeasurements(updated);
    localStorage.setItem('savedMeasurements', JSON.stringify(updated));
    if (currentMeasurement?.id === id) {
      setCurrentMeasurement(null);
    }
  };

  const exportMeasurement = (measurement: SavedMeasurement) => {
    const dataStr = JSON.stringify(measurement, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `measurement-${measurement.patientName}-${Date.now()}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  if (showMeasurement) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="container mx-auto px-4">
          <button
            onClick={() => setShowMeasurement(false)}
            className="mb-4 px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            ← Back to Dashboard
          </button>
          {measurementMode === 'advanced' ? (
            <FacialMeasurementAdvanced
              onMeasurementComplete={handleMeasurementComplete}
              onSkip={() => setShowMeasurement(false)}
            />
          ) : (
            <FacialMeasurement
              onMeasurementComplete={handleMeasurementComplete}
              onSkip={() => setShowMeasurement(false)}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Facial Measurements</h1>
          <p className="text-xl text-gray-600">
            Precision measurements for optimal lens fitting
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-md p-6 text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Eye className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">Pupillary Distance</h3>
            <p className="text-sm text-gray-600">Precise PD measurement for lens centering</p>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Ruler className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">Seg Height</h3>
            <p className="text-sm text-gray-600">Essential for progressive & bifocal lenses</p>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6 text-center">
            <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <User className="w-8 h-8 text-purple-600" />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">OC Height</h3>
            <p className="text-sm text-gray-600">Optical center positioning accuracy</p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-2xl font-semibold mb-4">Start New Measurement</h2>
          
          <div className="max-w-2xl">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Patient Name (Optional)
            </label>
            <input
              type="text"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              placeholder="Enter patient name"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-6"
            />
            
            <div className="grid md:grid-cols-2 gap-4">
              <button
                onClick={() => {
                  setMeasurementMode('simple');
                  setShowMeasurement(true);
                }}
                className="p-6 bg-blue-50 border-2 border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-left"
              >
                <div className="flex items-center gap-3 mb-3">
                  <Ruler className="w-6 h-6 text-blue-600" />
                  <h3 className="font-semibold text-lg text-gray-900">Quick Measurement</h3>
                </div>
                <p className="text-sm text-gray-700 mb-2">
                  PD + seg height with credit-card calibration
                </p>
                <p className="text-xs text-gray-500">⏱️ ~1-2 minutes</p>
              </button>
              
              <button
                onClick={() => {
                  setMeasurementMode('advanced');
                  setShowMeasurement(true);
                }}
                className="p-6 bg-gradient-to-br from-indigo-50 to-purple-50 border-2 border-indigo-200 rounded-lg hover:from-indigo-100 hover:to-purple-100 transition-colors text-left"
              >
                <div className="flex items-center gap-3 mb-3">
                  <Zap className="w-6 h-6 text-indigo-600" />
                  <h3 className="font-semibold text-lg text-gray-900">Advanced 3D</h3>
                </div>
                <p className="text-sm text-gray-700 mb-2">
                  Full PD, seg height, OC + 3D face model
                </p>
                <p className="text-xs text-gray-500">⏱️ ~2-3 minutes</p>
              </button>
            </div>
          </div>
        </div>

        {currentMeasurement && (
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-lg shadow-md p-6 mb-8">
            <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
              <Save className="w-6 h-6 text-blue-600" />
              Latest Measurement
            </h2>
            
            <div className="bg-white rounded-lg p-4 mb-4">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-semibold text-lg text-gray-900">
                    {currentMeasurement.patientName}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {new Date(currentMeasurement.timestamp).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => exportMeasurement(currentMeasurement)}
                  className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors flex items-center gap-1"
                >
                  <Download className="w-4 h-4" />
                  Export
                </button>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-3 bg-gray-50 rounded">
                  <div className="text-sm text-gray-600 mb-1">Total PD</div>
                  <div className="text-2xl font-bold text-gray-900">
                    {currentMeasurement.pd.pdTotal}
                  </div>
                  <div className="text-xs text-gray-500">mm</div>
                </div>
                
                <div className="text-center p-3 bg-gray-50 rounded">
                  <div className="text-sm text-gray-600 mb-1">Right PD</div>
                  <div className="text-2xl font-bold text-gray-900">
                    {currentMeasurement.pd.pdRight}
                  </div>
                  <div className="text-xs text-gray-500">mm</div>
                </div>
                
                <div className="text-center p-3 bg-gray-50 rounded">
                  <div className="text-sm text-gray-600 mb-1">Left PD</div>
                  <div className="text-2xl font-bold text-gray-900">
                    {currentMeasurement.pd.pdLeft}
                  </div>
                  <div className="text-xs text-gray-500">mm</div>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-gray-200 text-sm text-gray-600">
                <div className="flex justify-between">
                  <span>Method:</span>
                  <span className="font-medium">{currentMeasurement.pd.method}</span>
                </div>
                <div className="flex justify-between">
                  <span>Confidence:</span>
                  <span className="font-medium">
                    {Math.round(currentMeasurement.pd.confidence * 100)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-2xl font-semibold mb-4">
            Saved Measurements ({savedMeasurements.length})
          </h2>

          {savedMeasurements.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Ruler className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-lg mb-2">No measurements yet</p>
              <p className="text-sm">Start a measurement to see results here</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {savedMeasurements.map(measurement => (
                <div
                  key={measurement.id}
                  className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        {measurement.patientName}
                      </h3>
                      <p className="text-xs text-gray-500">
                        {new Date(measurement.timestamp).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteMeasurement(measurement.id)}
                      className="text-red-500 hover:text-red-700 transition-colors"
                      title="Delete measurement"
                    >
                      ×
                    </button>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total PD:</span>
                      <span className="font-semibold">{measurement.pd.pdTotal} mm</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Right:</span>
                      <span className="font-semibold">{measurement.pd.pdRight} mm</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Left:</span>
                      <span className="font-semibold">{measurement.pd.pdLeft} mm</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Confidence:</span>
                      <span className="font-semibold">
                        {Math.round(measurement.pd.confidence * 100)}%
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-gray-200 flex gap-2">
                    <button
                      onClick={() => setCurrentMeasurement(measurement)}
                      className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                    >
                      View
                    </button>
                    <button
                      onClick={() => exportMeasurement(measurement)}
                      className="px-3 py-2 bg-gray-600 text-white text-sm rounded hover:bg-gray-700 transition-colors"
                      title="Export"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
