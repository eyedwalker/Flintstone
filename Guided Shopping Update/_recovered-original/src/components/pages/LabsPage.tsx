import { useMemo, useState } from 'react';
import { Building2, CheckCircle2, AlertTriangle, Calendar, Package } from 'lucide-react';

interface Lab {
  id: string;
  name: string;
  location: string;
  type: 'onsite' | 'central' | 'partner';
  promiseDays: number;       // turnaround in business days
  frameAvailableAtLab: boolean;
  frameEnclosed: boolean;    // optician encloses the frame with the order
  notes?: string;
}

const LABS: Lab[] = [
  { id: 'onsite',          name: 'Onsite',           location: 'In-Office Edging',  type: 'onsite',  promiseDays: 1,  frameAvailableAtLab: false, frameEnclosed: true,  notes: 'Best for stock lenses and simple Rx.' },
  { id: 'central-schertz', name: 'CentralStandard',  location: 'Schertz, TX',       type: 'central', promiseDays: 14, frameAvailableAtLab: false, frameEnclosed: true,  notes: 'Standard turnaround, frame must be enclosed.' },
  { id: 'central-rush',    name: 'CentralRush',      location: 'Schertz, TX',       type: 'central', promiseDays: 7,  frameAvailableAtLab: false, frameEnclosed: true,  notes: 'Rush queue — surcharge may apply.' },
  { id: 'essilor-dallas',  name: 'Essilor Dallas',   location: 'Dallas, TX',        type: 'partner', promiseDays: 10, frameAvailableAtLab: true,  frameEnclosed: false, notes: 'Partner lab keeps this frame in stock.' },
  { id: 'vsp-folsom',      name: 'VSP Optics',       location: 'Folsom, CA',        type: 'partner', promiseDays: 12, frameAvailableAtLab: false, frameEnclosed: true,  notes: 'Premium AR coatings, longer turnaround.' },
  { id: 'walman-mn',       name: 'Walman Optical',   location: 'Minneapolis, MN',   type: 'partner', promiseDays: 10, frameAvailableAtLab: false, frameEnclosed: true,  notes: 'Strong on progressives and Trivex.' },
];

function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(start);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) added++;
  }
  return d;
}

interface Props {
  pageId?: string;
}

export default function LabsPage(_props: Props) {
  const [selectedId, setSelectedId] = useState<string>(LABS[1].id); // CentralStandard, matches the EHR screenshot

  const today = useMemo(() => new Date(), []);
  const selected = LABS.find(l => l.id === selectedId)!;
  const promiseDate = useMemo(() => addBusinessDays(today, selected.promiseDays), [today, selected.promiseDays]);

  const handleConfirm = () => {
    try {
      sessionStorage.setItem(
        'guided_shopping_lab',
        JSON.stringify({
          labId: selected.id,
          labName: selected.name,
          location: selected.location,
          promiseDate: promiseDate.toISOString().slice(0, 10),
          frameEnclosed: selected.frameEnclosed,
        }),
      );
    } catch { /* ignore */ }
    alert(`Lab confirmed: ${selected.name} — Promise Date ${promiseDate.toLocaleDateString()}`);
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <h2 className="text-2xl font-semibold mb-1">Lab Selection</h2>
      <p className="text-sm text-gray-600 mb-6">
        Choose which lab will fabricate this eyeglass order. Promise dates assume order submission today.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* Lab list */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Labs</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {LABS.map(lab => {
              const isSelected = selectedId === lab.id;
              return (
                <button
                  key={lab.id}
                  type="button"
                  onClick={() => setSelectedId(lab.id)}
                  className={`text-left p-4 border rounded-lg transition ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50 shadow-sm'
                      : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-gray-500" />
                      <span className="font-semibold text-gray-900">{lab.name}</span>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        lab.type === 'onsite'
                          ? 'bg-emerald-100 text-emerald-700'
                          : lab.type === 'central'
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {lab.type}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">{lab.location}</div>
                  <div className="text-xs text-gray-600 mt-1">
                    Turnaround: {lab.promiseDays} business {lab.promiseDays === 1 ? 'day' : 'days'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Lab Router — mirrors EHR's status panel */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Lab Router</h3>
          <div className="border-2 border-blue-500 rounded-lg p-4 bg-blue-50">
            <div className="font-semibold text-gray-900 text-lg mb-0.5">{selected.name}</div>
            <div className="text-sm text-gray-600 mb-3">{selected.location}</div>

            <div className="space-y-2 text-sm">
              <StatusRow
                icon={selected.frameAvailableAtLab ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-amber-600" />}
                label={selected.frameAvailableAtLab ? 'Frame is available at the lab' : 'Frame is not available at the lab'}
              />
              <StatusRow
                icon={<Calendar className="w-4 h-4 text-blue-600" />}
                label={
                  <span>
                    Promise Date: <strong>{promiseDate.toLocaleDateString()}</strong>
                  </span>
                }
              />
              <StatusRow
                icon={<Package className="w-4 h-4 text-gray-600" />}
                label={selected.frameEnclosed ? 'Frame is Enclosed.' : 'Frame ships separately.'}
              />
            </div>

            {selected.notes && (
              <div className="mt-3 pt-3 border-t border-blue-200 text-xs text-gray-700">
                {selected.notes}
              </div>
            )}

            <button
              type="button"
              onClick={handleConfirm}
              className="w-full mt-4 px-4 py-2 bg-blue-700 text-white rounded hover:bg-blue-800 transition text-sm font-medium"
            >
              Confirm Lab
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ icon, label }: { icon: React.ReactNode; label: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5">{icon}</div>
      <div className="text-gray-800">{label}</div>
    </div>
  );
}
