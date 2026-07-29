import { useState, useRef, useEffect } from 'react';
import { Scan, Star, Trash2, ShoppingBag } from 'lucide-react';

interface ScannedFrame {
  id: string;
  upc: string;
  brand?: string;
  model?: string;
  color?: string;
  size?: string;
  imageUrl?: string;
  scannedAt: string;
  isFavorite: boolean;
}

export default function FrameScannerDemo() {
  const [scannedFrames, setScannedFrames] = useState<ScannedFrame[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [manualUpc, setManualUpc] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraActive, setCameraActive] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('scannedFrames');
    if (saved) {
      setScannedFrames(JSON.parse(saved));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('scannedFrames', JSON.stringify(scannedFrames));
  }, [scannedFrames]);

  const startCamera = async () => {
    try {
      console.log('Starting camera...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 1280, height: 720 }
      });
      console.log('Camera stream obtained:', stream);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        console.log('Stream set to video element');
        
        // Switch UI immediately when stream is set
        setCameraActive(true);
        
        // Then try to play the video
        videoRef.current.onloadedmetadata = () => {
          console.log('Video metadata loaded');
          videoRef.current?.play()
            .then(() => console.log('Video playing'))
            .catch(e => console.error('Play error:', e));
        };
        
        // Fallback: try to play immediately in case metadata already loaded
        videoRef.current.play().catch(() => {
          console.log('Initial play blocked, waiting for metadata event');
        });
      }
    } catch (err) {
      console.error('Camera error:', err);
      alert(`Unable to access camera: ${err instanceof Error ? err.message : 'Unknown error'}. You can enter UPC codes manually.`);
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
      setCameraActive(false);
    }
  };

  const simulateScan = () => {
    setIsScanning(true);
    
    setTimeout(() => {
      const mockFrames = [
        { brand: 'Ray-Ban', model: 'Wayfarer', color: 'Black', size: '50-20-145', upc: '805289126577' },
        { brand: 'Oakley', model: 'Holbrook', color: 'Matte Black', size: '55-18-137', upc: '888392145529' },
        { brand: 'Gucci', model: 'GG0061S', color: 'Gold/Green', size: '56-17-145', upc: '889652080017' },
        { brand: 'Prada', model: 'PR 17WS', color: 'Havana', size: '54-19-140', upc: '8053672828374' }
      ];
      
      const randomFrame = mockFrames[Math.floor(Math.random() * mockFrames.length)];
      
      const newFrame: ScannedFrame = {
        id: Date.now().toString(),
        upc: randomFrame.upc,
        brand: randomFrame.brand,
        model: randomFrame.model,
        color: randomFrame.color,
        size: randomFrame.size,
        scannedAt: new Date().toISOString(),
        isFavorite: false
      };
      
      setScannedFrames(prev => [newFrame, ...prev]);
      setIsScanning(false);
    }, 1500);
  };

  const handleManualEntry = () => {
    if (!manualUpc.trim()) return;
    
    const newFrame: ScannedFrame = {
      id: Date.now().toString(),
      upc: manualUpc.trim(),
      scannedAt: new Date().toISOString(),
      isFavorite: false
    };
    
    setScannedFrames(prev => [newFrame, ...prev]);
    setManualUpc('');
  };

  const toggleFavorite = (id: string) => {
    setScannedFrames(prev =>
      prev.map(frame =>
        frame.id === id ? { ...frame, isFavorite: !frame.isFavorite } : frame
      )
    );
  };

  const deleteFrame = (id: string) => {
    setScannedFrames(prev => prev.filter(frame => frame.id !== id));
  };

  const favorites = scannedFrames.filter(f => f.isFavorite);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Frame Scanner</h1>
          <p className="text-xl text-gray-600">
            Scan frame barcodes to save favorites and build your collection
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Scan className="w-6 h-6 text-blue-600" />
              Scan Frame
            </h2>

            {!cameraActive ? (
              <div className="space-y-4">
                <button
                  onClick={startCamera}
                  className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                >
                  <Scan className="w-5 h-5" />
                  Start Camera Scanner
                </button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-300"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white text-gray-500">or</span>
                  </div>
                </div>

                <button
                  onClick={simulateScan}
                  disabled={isScanning}
                  className="w-full px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors"
                >
                  {isScanning ? 'Scanning...' : 'Simulate Scan (Demo)'}
                </button>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Manual UPC Entry
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={manualUpc}
                      onChange={(e) => setManualUpc(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleManualEntry()}
                      placeholder="Enter UPC code"
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      onClick={handleManualEntry}
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="relative bg-black rounded-lg overflow-hidden" style={{ minHeight: '320px' }}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full object-cover"
                    style={{ minHeight: '320px', display: 'block' }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="border-4 border-green-400 w-64 h-40 rounded-lg shadow-lg">
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white text-xs bg-black bg-opacity-50 px-2 py-1 rounded">
                        Align barcode here
                      </div>
                    </div>
                  </div>
                  <div className="absolute top-4 left-4 bg-green-500 text-white px-3 py-1 rounded-full text-sm">
                    ● Camera Active
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={simulateScan}
                    disabled={isScanning}
                    className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors"
                  >
                    {isScanning ? 'Scanning...' : 'Capture Barcode'}
                  </button>
                  <button
                    onClick={stopCamera}
                    className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="font-semibold text-blue-900 mb-2">How to Use:</h3>
              <ul className="space-y-1 text-sm text-blue-800">
                <li>• Point camera at frame barcode</li>
                <li>• Wait for automatic detection</li>
                <li>• Or enter UPC code manually</li>
                <li>• Save favorites for later review</li>
              </ul>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Star className="w-6 h-6 text-yellow-500" />
                Favorites ({favorites.length})
              </span>
              {favorites.length > 0 && (
                <button className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center gap-1">
                  <ShoppingBag className="w-4 h-4" />
                  Order Selected
                </button>
              )}
            </h2>

            {favorites.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Star className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>No favorites yet</p>
                <p className="text-sm">Star frames to add them here</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {favorites.map(frame => (
                  <div key={frame.id} className="border border-gray-200 rounded-lg p-3 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        {frame.brand && (
                          <h3 className="font-semibold text-gray-900">
                            {frame.brand} {frame.model}
                          </h3>
                        )}
                        <p className="text-sm text-gray-600">UPC: {frame.upc}</p>
                      </div>
                      <button
                        onClick={() => toggleFavorite(frame.id)}
                        className="text-yellow-500 hover:text-yellow-600"
                      >
                        <Star className="w-5 h-5 fill-current" />
                      </button>
                    </div>
                    {frame.color && (
                      <p className="text-sm text-gray-600">Color: {frame.color}</p>
                    )}
                    {frame.size && (
                      <p className="text-sm text-gray-600">Size: {frame.size}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">
            Recent Scans ({scannedFrames.length})
          </h2>

          {scannedFrames.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Scan className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No frames scanned yet</p>
              <p className="text-sm">Start scanning to build your collection</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {scannedFrames.map(frame => (
                <div key={frame.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      {frame.brand ? (
                        <h3 className="font-semibold text-gray-900">
                          {frame.brand} {frame.model}
                        </h3>
                      ) : (
                        <h3 className="font-semibold text-gray-900">Unknown Frame</h3>
                      )}
                      <p className="text-xs text-gray-500">
                        {new Date(frame.scannedAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => toggleFavorite(frame.id)}
                        className={`p-1 rounded hover:bg-gray-100 ${
                          frame.isFavorite ? 'text-yellow-500' : 'text-gray-400'
                        }`}
                        title={frame.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                      >
                        <Star className={`w-5 h-5 ${frame.isFavorite ? 'fill-current' : ''}`} />
                      </button>
                      <button
                        onClick={() => deleteFrame(frame.id)}
                        className="p-1 text-red-500 rounded hover:bg-red-50"
                        title="Delete"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1 text-sm text-gray-600">
                    <p><strong>UPC:</strong> {frame.upc}</p>
                    {frame.color && <p><strong>Color:</strong> {frame.color}</p>}
                    {frame.size && <p><strong>Size:</strong> {frame.size}</p>}
                  </div>

                  {frame.isFavorite && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <button className="w-full px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors flex items-center justify-center gap-2">
                        <ShoppingBag className="w-4 h-4" />
                        Add to Order
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
