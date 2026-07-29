import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, ArrowUp, ArrowDown, Save } from 'lucide-react';
import { ShoppingPage, ShoppingPageFormData } from '../types/page';
import { pageService } from '../services/pageService';
import { PAGE_COMPONENTS, PAGE_COMPONENT_MAP } from './pages/registry';
import { Modal } from './Modal';

const blankForm = (): ShoppingPageFormData => ({
  label: '',
  componentKey: PAGE_COMPONENTS[0]?.key || '',
  enabled: true,
});

export function PageAdmin() {
  const [pages, setPages] = useState<ShoppingPage[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<ShoppingPage | null>(null);
  const [form, setForm] = useState<ShoppingPageFormData>(blankForm());

  useEffect(() => { reload(); }, []);
  const reload = () => setPages(pageService.getAll());

  const openModal = (page?: ShoppingPage) => {
    if (page) {
      setEditing(page);
      setForm({ label: page.label, componentKey: page.componentKey, enabled: page.enabled });
    } else {
      setEditing(null);
      setForm(blankForm());
    }
    setIsModalOpen(true);
  };

  const closeModal = () => { setIsModalOpen(false); setEditing(null); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) pageService.update(editing.id, form);
    else pageService.create(form);
    reload();
    closeModal();
  };

  const remove = (page: ShoppingPage) => {
    if (confirm(`Delete the "${page.label}" page?`)) {
      pageService.delete(page.id);
      reload();
    }
  };

  const toggle = (page: ShoppingPage) => {
    pageService.update(page.id, { enabled: !page.enabled });
    reload();
  };

  const move = (id: string, direction: 'up' | 'down') => {
    pageService.move(id, direction);
    reload();
  };

  const reset = () => {
    if (confirm('Reset pages to defaults? This removes any custom pages.')) {
      pageService.resetToDefaults();
      reload();
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Shopping Pages</h2>
          <p className="text-gray-600 text-sm">Configure the steps shown in the guided shopping stepper. Order = stepper order.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={reset}
            className="px-3 py-1.5 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
          >
            Reset to Defaults
          </button>
          <button
            onClick={() => openModal()}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-700 text-white rounded text-sm hover:bg-blue-800"
          >
            <Plus className="w-4 h-4" />
            Add Page
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Order</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Label</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Component</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {pages.map((p, i) => {
              const def = PAGE_COMPONENT_MAP[p.componentKey];
              return (
                <tr key={p.id} className={!p.enabled ? 'bg-gray-50 opacity-60' : ''}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        disabled={i === 0}
                        onClick={() => move(p.id, 'up')}
                        className="p-1 text-gray-500 hover:bg-gray-100 rounded disabled:opacity-30"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        disabled={i === pages.length - 1}
                        onClick={() => move(p.id, 'down')}
                        className="p-1 text-gray-500 hover:bg-gray-100 rounded disabled:opacity-30"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <span className="font-medium ml-1">{i + 1}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{p.label}</td>
                  <td className="px-4 py-3 text-sm">
                    {def
                      ? <span className="text-gray-700">{def.label} <span className="text-gray-500">— {def.description}</span></span>
                      : <span className="text-red-600">Unknown component: {p.componentKey}</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggle(p)}
                      className={`px-2.5 py-1 rounded text-xs font-medium ${
                        p.enabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {p.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openModal(p)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => remove(p)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {pages.length === 0 && (
          <div className="text-center py-12 text-gray-500">No pages configured. Click "Add Page" to start.</div>
        )}
      </div>

      <Modal isOpen={isModalOpen} onClose={closeModal} title={editing ? 'Edit Page' : 'Add Page'} size="md">
        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Label *</label>
            <input
              type="text"
              required
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="e.g. Frames"
              className="w-full px-3 py-2 border border-gray-300 rounded"
            />
            <p className="text-xs text-gray-500 mt-1">Shown in the stepper at the top of the shopping flow.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Component *</label>
            <select
              required
              value={form.componentKey}
              onChange={(e) => setForm({ ...form, componentKey: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded"
            >
              {PAGE_COMPONENTS.map(c => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {PAGE_COMPONENT_MAP[form.componentKey]?.description || 'Pick what this page renders.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="page-enabled"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <label htmlFor="page-enabled" className="text-sm">Enabled (visible in the stepper)</label>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <button type="button" onClick={closeModal} className="px-4 py-2 border border-gray-300 rounded">
              Cancel
            </button>
            <button type="submit" className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded hover:bg-blue-800">
              <Save className="w-4 h-4" />
              {editing ? 'Update' : 'Create'} Page
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
