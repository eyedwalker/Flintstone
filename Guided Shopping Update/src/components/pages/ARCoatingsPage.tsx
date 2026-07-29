import { useState } from 'react';
import TileGrid from './TileGrid';

const PACKAGES = [
  { id: 'standard', label: 'Standard Single Vision' },
  { id: 'premium', label: 'Premium Single Vision' },
  { id: 'progressive', label: 'Premium Digital Progressive' },
];
const SOLUTIONS = [
  'Poly SV & Premium Digital Prog.',
  'High Index',
  'Polycarbonate',
];

interface Props {
  pageId?: string;
}

export default function ARCoatingsPage({ pageId }: Props) {
  const [solution, setSolution] = useState(SOLUTIONS[0]);
  const [pkg, setPkg] = useState(PACKAGES[0].id);

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <h2 className="text-2xl font-semibold text-center mb-4">AR Coating Options</h2>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm font-semibold mb-2">Solution</label>
          <select
            title="Solution"
            value={solution}
            onChange={(e) => setSolution(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2"
          >
            {SOLUTIONS.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold mb-2">Package</label>
          <select
            title="Package"
            value={pkg}
            onChange={(e) => setPkg(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2"
          >
            {PACKAGES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
      </div>

      <TileGrid pageId={pageId || 'ar-coatings'} layout="row" />
    </div>
  );
}
