import { useState } from 'react';
import { Award, Check, Eye, Glasses } from 'lucide-react';

interface WarrantyPlan {
  id: string;
  name: string;
  duration: string;
  price: number;
  covers: { frame: boolean; lenses: boolean };
  description: string;
}

const PLANS: WarrantyPlan[] = [
  {
    id: 'svhi-egpp',
    name: 'S V – Hi-Index / Poly E G P P',
    duration: '13 Months',
    price: 30.0,
    covers: { frame: true, lenses: true },
    description: 'Full replacement coverage for Single Vision Hi-Index / Poly lenses against breakage and prescription change.',
  },
  {
    id: 'egpp',
    name: 'Egpp',
    duration: '13 Months',
    price: 25.0,
    covers: { frame: true, lenses: true },
    description: 'Eyeglass plan covering accidental damage to frame and lenses for 13 months.',
  },
  {
    id: 'davis-scratch',
    name: 'Davis Scratch Warranty',
    duration: '13 Months',
    price: 20.0,
    covers: { frame: false, lenses: true },
    description: 'Lens-only scratch protection. One free replacement per eye within 13 months of purchase.',
  },
];

interface OrderSummary {
  orderNumber: string;
  orderType: string;
  frame: string;
  rightLens: string;
  leftLens: string;
}

const SAMPLE_ORDER: OrderSummary = {
  orderNumber: '5271020',
  orderType: 'Eyeglasses',
  frame: 'BB7214 (500) Plum 57/18/135',
  rightLens: 'Single Vision Polycarbonate',
  leftLens: 'Single Vision Polycarbonate',
};

interface Props {
  pageId?: string;
}

export default function WarrantiesPage(_props: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const [added, setAdded] = useState<WarrantyPlan | null>(null);

  // Pull patient name from sessionStorage when launched from Timeline.
  let patientName = 'David Walker';
  try {
    const stored = sessionStorage.getItem('timeline_patient_context');
    if (stored) {
      const ctx = JSON.parse(stored);
      if (ctx?.patientName) patientName = ctx.patientName;
    }
  } catch { /* ignore */ }

  const handleAdd = () => {
    const plan = PLANS.find(p => p.id === selectedId);
    if (plan) {
      setAdded(plan);
      setDeclined(false);
      try {
        sessionStorage.setItem('guided_shopping_warranty', JSON.stringify(plan));
      } catch { /* ignore */ }
    }
  };

  const handleDecline = () => {
    setDeclined(true);
    setAdded(null);
    setSelectedId(null);
    try {
      sessionStorage.setItem('guided_shopping_warranty', JSON.stringify({ declined: true }));
    } catch { /* ignore */ }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      {/* Header strip — mirrors the EHR's "Add Warranty" dialog */}
      <div className="bg-blue-700 text-white px-6 py-3">
        <h2 className="text-lg font-semibold">Add Warranty</h2>
      </div>

      <div className="p-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">
            Add Warranty for: {patientName}, Order # {SAMPLE_ORDER.orderNumber}
          </h3>
          <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
            <li>Order Type: {SAMPLE_ORDER.orderType}</li>
            <li>Frame: {SAMPLE_ORDER.frame}</li>
            <li>
              Lenses: [Right Lens] {SAMPLE_ORDER.rightLens}, [Left Lens] {SAMPLE_ORDER.leftLens}
            </li>
          </ul>
        </div>

        {(added || declined) && (
          <div
            className={`mb-4 rounded-lg px-4 py-3 text-sm ${
              added ? 'bg-green-50 border border-green-300 text-green-800' : 'bg-gray-100 border border-gray-300 text-gray-700'
            }`}
          >
            {added
              ? `Added ${added.name} ($${added.price.toFixed(2)} for ${added.duration}).`
              : 'Warranty declined for this order.'}
          </div>
        )}

        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="grid grid-cols-[80px_80px_1fr_140px_120px] bg-gray-50 border-b border-gray-200 text-sm font-semibold text-gray-700">
            <div className="px-3 py-2 text-center">Frame</div>
            <div className="px-3 py-2 text-center">Lenses</div>
            <div className="px-3 py-2">Plan</div>
            <div className="px-3 py-2">Duration</div>
            <div className="px-3 py-2 text-right">Price</div>
          </div>
          {PLANS.map(plan => {
            const isSelected = selectedId === plan.id;
            return (
              <button
                key={plan.id}
                type="button"
                onClick={() => {
                  setSelectedId(plan.id);
                  setDeclined(false);
                }}
                className={`w-full grid grid-cols-[80px_80px_1fr_140px_120px] items-center text-left border-b border-gray-200 last:border-b-0 hover:bg-blue-50 transition ${
                  isSelected ? 'bg-blue-50 ring-1 ring-blue-400' : ''
                }`}
              >
                <div className="px-3 py-3 flex justify-center">
                  <Badge active={plan.covers.frame} icon={<Glasses className="w-4 h-4" />} />
                </div>
                <div className="px-3 py-3 flex justify-center">
                  <Badge active={plan.covers.lenses} icon={<Eye className="w-4 h-4" />} />
                </div>
                <div className="px-3 py-3">
                  <div className="font-medium text-gray-900">{plan.name}</div>
                  <div className="text-xs text-gray-500">{plan.description}</div>
                </div>
                <div className="px-3 py-3 text-sm text-gray-700">{plan.duration}</div>
                <div className="px-3 py-3 text-right font-semibold text-gray-900">
                  ${plan.price.toFixed(2)}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex justify-between">
          <button
            type="button"
            onClick={handleDecline}
            className="px-5 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 transition"
          >
            Decline Warranty
          </button>
          <button
            type="button"
            disabled={!selectedId}
            onClick={handleAdd}
            className={`px-5 py-2 rounded transition flex items-center gap-2 ${
              selectedId
                ? 'bg-blue-700 text-white hover:bg-blue-800'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            <Check className="w-4 h-4" />
            Add Warranty
          </button>
        </div>
      </div>
    </div>
  );
}

function Badge({ active, icon }: { active: boolean; icon: React.ReactNode }) {
  return (
    <span
      className={`inline-flex w-7 h-7 items-center justify-center rounded-full ${
        active ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-300'
      }`}
      aria-hidden
    >
      {active ? <Award className="w-4 h-4" /> : icon}
    </span>
  );
}
