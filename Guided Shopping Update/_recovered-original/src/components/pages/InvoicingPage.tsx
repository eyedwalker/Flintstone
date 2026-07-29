import { useMemo, useState } from 'react';
import { Plus, X, CreditCard, Receipt } from 'lucide-react';

interface PricedOrder {
  selected: boolean;
  serviceDate: string;
  orderNumber: string;
  type: 'Eyeglass' | 'Contact Lens' | 'Exam';
  patientAmount: number;
  balance: number;
  appliedPayment: number;
}

const PAYMENT_METHODS = [
  'Select',
  'Cash',
  'Credit Card',
  'Check',
  'Care Credit',
  'HSA / FSA Card',
  'Gift Card',
  'Account Credit',
];

interface PaymentLine {
  id: string;
  method: string;
  amount: number;
}

const today = new Date().toISOString().slice(0, 10);

const SAMPLE_ORDERS: PricedOrder[] = [
  {
    selected: true,
    serviceDate: today,
    orderNumber: '5271020',
    type: 'Eyeglass',
    patientAmount: 697.55,
    balance: 0,
    appliedPayment: 697.55,
  },
];

const SAMPLE_TOTAL_BALANCE = 2294.98;
const SAMPLE_AVAILABLE_CREDITS = 0.0;

interface Props {
  pageId?: string;
}

export default function InvoicingPage(_props: Props) {
  const [orders, setOrders] = useState<PricedOrder[]>(SAMPLE_ORDERS);
  const [showFamily, setShowFamily] = useState(false);
  const [payments, setPayments] = useState<PaymentLine[]>([
    { id: 'p1', method: 'Select', amount: 0 },
  ]);
  const [saved, setSaved] = useState(false);

  // Pull patient name from sessionStorage when launched from Timeline.
  let patientName = 'David Walker';
  try {
    const stored = sessionStorage.getItem('timeline_patient_context');
    if (stored) {
      const ctx = JSON.parse(stored);
      if (ctx?.patientName) patientName = ctx.patientName;
    }
  } catch { /* ignore */ }

  const selectedAmount = useMemo(
    () => orders.filter(o => o.selected).reduce((acc, o) => acc + o.appliedPayment, 0),
    [orders],
  );
  const selectedBalance = useMemo(
    () => orders.filter(o => o.selected).reduce((acc, o) => acc + o.balance, 0),
    [orders],
  );
  const totalPayment = useMemo(
    () => payments.reduce((acc, p) => acc + (Number.isFinite(p.amount) ? p.amount : 0), 0),
    [payments],
  );
  const remainingBalance = selectedAmount - totalPayment;

  const toggleOrder = (idx: number) =>
    setOrders(prev => prev.map((o, i) => (i === idx ? { ...o, selected: !o.selected } : o)));

  const updateApplied = (idx: number, value: string) => {
    const num = parseFloat(value) || 0;
    setOrders(prev => prev.map((o, i) => (i === idx ? { ...o, appliedPayment: num } : o)));
  };

  const addPaymentLine = () =>
    setPayments(prev => [...prev, { id: `p${Date.now()}`, method: 'Select', amount: 0 }]);

  const removePaymentLine = (id: string) =>
    setPayments(prev => (prev.length === 1 ? prev : prev.filter(p => p.id !== id)));

  const handleSave = () => {
    setSaved(true);
    try {
      sessionStorage.setItem(
        'guided_shopping_invoice',
        JSON.stringify({
          patientName,
          orders: orders.filter(o => o.selected),
          payments: payments.filter(p => p.method !== 'Select' && p.amount > 0),
          totalPayment,
          savedAt: new Date().toISOString(),
        }),
      );
    } catch { /* ignore */ }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <div className="flex items-center gap-2 mb-1">
        <Receipt className="w-5 h-5 text-gray-700" />
        <h2 className="text-2xl font-semibold text-gray-900">
          {patientName}: Generate Invoice
        </h2>
      </div>

      <label className="inline-flex items-center gap-2 text-sm text-gray-700 mt-2 mb-4">
        <input
          type="checkbox"
          checked={showFamily}
          onChange={e => setShowFamily(e.target.checked)}
        />
        Show all family members
      </label>

      {/* Balance summary cards */}
      <div className="grid grid-cols-2 gap-3 max-w-lg mb-6">
        <div className="border-2 border-blue-500 rounded px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-700">Total balance:</span>
          <span className="text-red-600 font-semibold">${SAMPLE_TOTAL_BALANCE.toFixed(2)}</span>
        </div>
        <div className="border border-gray-300 rounded px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-700">Available credits:</span>
          <span className="text-gray-900 font-semibold">${SAMPLE_AVAILABLE_CREDITS.toFixed(2)}</span>
        </div>
      </div>

      {/* Payment methods */}
      <h3 className="text-sm font-semibold text-gray-800 mb-2">Select Payment Method</h3>
      <div className="space-y-2 mb-2">
        {payments.map(line => (
          <div key={line.id} className="flex items-center gap-2">
            <select
              value={line.method}
              onChange={e =>
                setPayments(prev =>
                  prev.map(p => (p.id === line.id ? { ...p, method: e.target.value } : p)),
                )
              }
              className="border border-gray-300 rounded px-3 py-2 w-56 text-sm"
              aria-label="Payment method"
            >
              {PAYMENT_METHODS.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              placeholder="$0.00"
              value={line.amount || ''}
              onChange={e =>
                setPayments(prev =>
                  prev.map(p =>
                    p.id === line.id ? { ...p, amount: parseFloat(e.target.value) || 0 } : p,
                  ),
                )
              }
              className="border border-gray-300 rounded px-3 py-2 w-36 text-sm"
              aria-label="Payment amount"
            />
            {payments.length > 1 && (
              <button
                type="button"
                onClick={() => removePaymentLine(line.id)}
                className="p-1.5 text-gray-400 hover:text-red-500"
                title="Remove this payment method"
                aria-label="Remove payment method"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addPaymentLine}
        className="text-blue-600 text-sm hover:underline flex items-center gap-1 mb-6"
      >
        <Plus className="w-3 h-3" /> Add one more method
      </button>

      {/* Totals */}
      <div className="text-sm text-gray-800 space-y-0.5 mb-6">
        <div className="flex items-center justify-end gap-6">
          <span className="text-gray-600">Total Payment:</span>
          <span className="font-semibold w-24 text-right">${totalPayment.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-end gap-6">
          <span className="text-gray-600">Balance:</span>
          <span
            className={`font-semibold w-24 text-right ${
              remainingBalance > 0 ? 'text-red-600' : 'text-gray-900'
            }`}
          >
            ${(selectedBalance + Math.max(remainingBalance, 0)).toFixed(2)}
          </span>
        </div>
      </div>

      {/* Priced Orders table */}
      <h3 className="text-sm font-semibold text-gray-800 mb-2">Priced Orders</h3>
      <div className="border border-gray-200 rounded overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left">
              <th className="px-3 py-2 w-10">
                <input
                  type="checkbox"
                  checked={orders.every(o => o.selected)}
                  onChange={e =>
                    setOrders(prev => prev.map(o => ({ ...o, selected: e.target.checked })))
                  }
                  aria-label="Select all orders"
                />
              </th>
              <th className="px-3 py-2 font-semibold text-gray-700">Service Date</th>
              <th className="px-3 py-2 font-semibold text-gray-700">Order</th>
              <th className="px-3 py-2 font-semibold text-gray-700">Type</th>
              <th className="px-3 py-2 font-semibold text-gray-700 text-right">Patient Amount</th>
              <th className="px-3 py-2 font-semibold text-gray-700 text-right">Balance</th>
              <th className="px-3 py-2 font-semibold text-gray-700 text-right">Applied Payment</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order, idx) => (
              <tr key={order.orderNumber} className="border-b border-gray-100 last:border-b-0">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={order.selected}
                    onChange={() => toggleOrder(idx)}
                    aria-label={`Select order ${order.orderNumber}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="date"
                    value={order.serviceDate}
                    onChange={e =>
                      setOrders(prev =>
                        prev.map((o, i) =>
                          i === idx ? { ...o, serviceDate: e.target.value } : o,
                        ),
                      )
                    }
                    className="border border-gray-300 rounded px-2 py-1 text-sm"
                    aria-label="Service date"
                  />
                </td>
                <td className="px-3 py-2 text-gray-900">{order.orderNumber}</td>
                <td className="px-3 py-2 text-gray-700">{order.type}</td>
                <td className="px-3 py-2 text-right text-gray-900">
                  ${order.patientAmount.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right text-gray-900">
                  ${order.balance.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    step="0.01"
                    value={order.appliedPayment}
                    onChange={e => updateApplied(idx, e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 w-28 text-sm text-right"
                    aria-label={`Applied payment for order ${order.orderNumber}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50">
            <tr>
              <td colSpan={4} className="px-3 py-2 text-right font-semibold text-gray-700">
                Total selected:
              </td>
              <td className="px-3 py-2 text-right font-semibold">
                ${orders.filter(o => o.selected).reduce((s, o) => s + o.patientAmount, 0).toFixed(2)}
              </td>
              <td className="px-3 py-2 text-right font-semibold">
                ${selectedBalance.toFixed(2)}
              </td>
              <td className="px-3 py-2 text-right font-semibold">${selectedAmount.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {saved && (
        <div className="mb-4 bg-green-50 border border-green-300 text-green-800 rounded px-4 py-2 text-sm">
          Invoice saved. Total payment: ${totalPayment.toFixed(2)}.
        </div>
      )}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={() => {
            setOrders(SAMPLE_ORDERS);
            setPayments([{ id: 'p1', method: 'Select', amount: 0 }]);
            setSaved(false);
          }}
          className="px-5 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="px-5 py-2 bg-blue-700 text-white rounded hover:bg-blue-800 flex items-center gap-2"
        >
          <CreditCard className="w-4 h-4" /> Save
        </button>
      </div>
    </div>
  );
}
