import { useState } from 'react';
import { Heart, Search } from 'lucide-react';

interface Frame {
  upc: string;
  collection: string;
  style: string;
  color: string;
  size: string;
  retail: number;
  status: 'Active' | 'Inactive';
  patientNote?: string;
  favorite?: boolean;
}

const SAMPLE_FRAMES: Frame[] = [
  { upc: '788678562333', collection: 'Altair Men',  style: 'A4036 (200)',     color: 'Brown',  size: '54-16-140', retail: 51.98,  status: 'Active', patientNote: 'Save for Sunglasses next visit. - Ask Wife when she comes in Saturday', favorite: true },
  { upc: '886895394147', collection: 'Airlock Men', style: 'AIRLOCK 2001 (301)', color: 'Olive', size: '54-17-145', retail: 99.98,  status: 'Active', favorite: true },
  { upc: '788678565921', collection: 'Altair Men',  style: 'A4046 (229)',     color: 'Carmel', size: '54-17-140', retail: 51.98,  status: 'Active', favorite: true },
];

export default function FramesPage() {
  const [search, setSearch] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(true);

  const filtered = SAMPLE_FRAMES.filter(f =>
    (!showFavoritesOnly || f.favorite) &&
    (!search || `${f.collection} ${f.style} ${f.color}`.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <h2 className="text-2xl font-semibold text-center mb-4">CHOOSE YOUR FRAME</h2>

      <div className="bg-gray-50 border border-gray-200 rounded p-3 mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search for frames"
              className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded text-sm"
            />
          </div>
          <button className="px-4 py-2 bg-blue-300 text-white rounded text-sm">Search</button>
          <button onClick={() => setSearch('')} className="px-4 py-2 bg-gray-100 border border-gray-300 rounded text-sm">Clear</button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm">Show Favorites</span>
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={`w-12 h-6 rounded-full transition-colors ${showFavoritesOnly ? 'bg-blue-600' : 'bg-gray-300'}`}
          >
            <div className={`w-5 h-5 bg-white rounded-full transform transition-transform ${showFavoritesOnly ? 'translate-x-6' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </div>

      <div className="border border-gray-200 rounded overflow-hidden">
        <div className="grid grid-cols-12 bg-gray-50 border-b text-xs font-semibold text-gray-600 uppercase px-4 py-2">
          <div className="col-span-6">Frame</div>
          <div className="col-span-2 text-right">Retail</div>
          <div className="col-span-2 text-center">Item Photo</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {filtered.map((f) => (
          <div key={f.upc} className="grid grid-cols-12 px-4 py-4 border-b last:border-b-0 items-start">
            <div className="col-span-6 text-sm">
              <div className="italic mb-2">{f.style} - {f.color}</div>
              <div className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-0.5 text-xs">
                <div className="text-gray-600">UPC:</div><div>{f.upc}</div>
                <div className="text-gray-600">Collection:</div><div>{f.collection}</div>
                <div className="text-gray-600">Style:</div><div>{f.style}</div>
                <div className="text-gray-600">Color:</div><div>{f.color}</div>
                <div className="text-gray-600">Size:</div><div>{f.size}</div>
                <div className="text-gray-600">Item Status:</div><div>{f.status}</div>
                {f.patientNote && (
                  <>
                    <div className="text-gray-600">Patient Note:</div>
                    <div>{f.patientNote}</div>
                  </>
                )}
              </div>
            </div>
            <div className="col-span-2 text-right text-3xl font-bold">
              <span className="text-xl align-top">$</span>{f.retail.toFixed(2)}
            </div>
            <div className="col-span-2 text-center text-gray-400 text-xs">
              <div className="border border-dashed border-gray-300 rounded py-4">IMAGE NOT<br />AVAILABLE</div>
            </div>
            <div className="col-span-2 text-right">
              <button className="text-blue-600 text-sm">View Details</button>
              <div className="mt-1 flex justify-end">
                <Heart className={`w-5 h-5 ${f.favorite ? 'fill-red-500 text-red-500' : 'text-gray-400'}`} />
              </div>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="px-4 py-12 text-center text-gray-500 text-sm">No frames match those filters.</div>
        )}
      </div>
    </div>
  );
}
