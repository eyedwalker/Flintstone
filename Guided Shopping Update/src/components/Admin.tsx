import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, GripVertical, Save, X } from 'lucide-react';
import { Tile, TileFormData, TileActionType } from '../types/tile';
import { ShoppingPage } from '../types/page';
import { tileService } from '../services/tileService';
import { pageService } from '../services/pageService';
import { Modal } from './Modal';
import { PageAdmin } from './PageAdmin';

type AdminTab = 'tiles' | 'pages';

export function Admin() {
  const [activeTab, setActiveTab] = useState<AdminTab>('tiles');
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [pages, setPages] = useState<ShoppingPage[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTile, setEditingTile] = useState<Tile | null>(null);
  const [formData, setFormData] = useState<TileFormData>({
    title: '',
    description: '',
    price: 0,
    bgColor: 'bg-blue-100',
    enabled: true,
    actionType: 'none',
    pageId: 'light-filters',
  });

  useEffect(() => {
    loadTiles();
    setPages(pageService.getAll());
  }, [activeTab]);

  const loadTiles = () => {
    setTiles(tileService.getAll());
  };

  const handleOpenModal = (tile?: Tile) => {
    if (tile) {
      setEditingTile(tile);
      setFormData({
        title: tile.title,
        description: tile.description,
        price: tile.price,
        bgColor: tile.bgColor,
        enabled: tile.enabled,
        actionType: tile.actionType,
        actionUrl: tile.actionUrl,
        videoType: tile.videoType,
        videoId: tile.videoId,
        imageUrl: tile.imageUrl,
        pdfUrl: tile.pdfUrl,
        demoScenarioId: tile.demoScenarioId,
        pageId: tile.pageId || 'light-filters',
      });
    } else {
      setEditingTile(null);
      setFormData({
        title: '',
        description: '',
        price: 0,
        bgColor: 'bg-blue-100',
        enabled: true,
        actionType: 'none',
        pageId: 'light-filters',
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingTile(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingTile) {
      tileService.update(editingTile.id, formData);
    } else {
      tileService.create(formData);
    }
    loadTiles();
    handleCloseModal();
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this tile?')) {
      tileService.delete(id);
      loadTiles();
    }
  };

  const handleToggleEnabled = (tile: Tile) => {
    tileService.update(tile.id, { enabled: !tile.enabled });
    loadTiles();
  };

  const handleResetDefaults = () => {
    if (confirm('Are you sure you want to reset to default tiles? This will delete all custom tiles.')) {
      tileService.resetToDefaults();
      loadTiles();
    }
  };

  const bgColorOptions = [
    { value: 'bg-blue-100', label: 'Light Blue' },
    { value: 'bg-blue-200', label: 'Blue' },
    { value: 'bg-blue-300', label: 'Dark Blue' },
    { value: 'bg-green-100', label: 'Light Green' },
    { value: 'bg-green-200', label: 'Green' },
    { value: 'bg-purple-100', label: 'Light Purple' },
    { value: 'bg-purple-200', label: 'Purple' },
    { value: 'bg-orange-100', label: 'Light Orange' },
    { value: 'bg-orange-200', label: 'Orange' },
    { value: 'bg-gray-100', label: 'Light Gray' },
    { value: 'bg-gray-200', label: 'Gray' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-1">Guided Shopping Admin</h1>
        <p className="text-gray-600 mb-4">Configure pages (the stepper) and tiles (Light Filters cards).</p>

        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-2">
            {([
              { id: 'tiles', label: 'Tiles' },
              { id: 'pages', label: 'Pages' },
            ] as const).map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === t.id
                    ? 'border-blue-700 text-blue-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {activeTab === 'pages' && <PageAdmin />}

        {activeTab === 'tiles' && (<>
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Tile Management</h2>
            <p className="text-gray-600 text-sm mt-1">Manage up to 18 tiles (6 rows × 3 columns)</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleResetDefaults}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
            >
              Reset to Defaults
            </button>
            <button
              onClick={() => handleOpenModal()}
              className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded hover:bg-blue-800 transition-colors"
            >
              <Plus className="w-5 h-5" />
              Add New Tile
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Order</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Title</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Description</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Price</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Action Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tiles.map((tile) => (
                <tr key={tile.id} className={!tile.enabled ? 'bg-gray-50 opacity-60' : ''}>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <GripVertical className="w-4 h-4 text-gray-400" />
                      <span className="font-medium">{tile.position + 1}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="font-medium text-gray-900">{tile.title}</div>
                    <div className={`inline-block mt-1 px-2 py-0.5 ${tile.bgColor} rounded text-xs`}>
                      Color
                    </div>
                  </td>
                  <td className="px-4 py-4 max-w-xs">
                    <p className="text-sm text-gray-600 truncate">{tile.description}</p>
                  </td>
                  <td className="px-4 py-4">
                    <span className="font-semibold text-gray-900">${tile.price}</span>
                  </td>
                  <td className="px-4 py-4">
                    <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                      {tile.actionType.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <button
                      onClick={() => handleToggleEnabled(tile)}
                      className={`px-3 py-1 rounded text-xs font-medium ${
                        tile.enabled
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {tile.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleOpenModal(tile)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="Edit"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(tile.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {tiles.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              No tiles found. Click "Add New Tile" to create one.
            </div>
          )}

          {tiles.length < 18 && tiles.length > 0 && (
            <div className="px-4 py-3 bg-gray-50 border-t text-sm text-gray-600">
              {tiles.length} of 18 tiles used ({18 - tiles.length} remaining)
            </div>
          )}
        </div>
        </>)}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title={editingTile ? 'Edit Tile' : 'Add New Tile'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Price *
                </label>
                <input
                  type="number"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                  min="0"
                  step="0.01"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description *
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Background Color
                </label>
                <select
                  value={formData.bgColor}
                  onChange={(e) => setFormData({ ...formData, bgColor: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {bgColorOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Action Type
                </label>
                <select
                  value={formData.actionType}
                  onChange={(e) => setFormData({ ...formData, actionType: e.target.value as TileActionType })}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="none">None</option>
                  <option value="external_link">External Link</option>
                  <option value="popup">Popup Message</option>
                  <option value="video">Video</option>
                  <option value="image">Image</option>
                  <option value="pdf">PDF Document</option>
                  <option value="demo">Interactive Demo</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Show on page
              </label>
              <select
                title="Show on page"
                value={formData.pageId || 'light-filters'}
                onChange={(e) => setFormData({ ...formData, pageId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {pages.map(p => (
                  <option key={p.id} value={p.id}>{p.label}{p.enabled ? '' : ' (disabled)'}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                The tile renders only on the selected page. To create a new tile-driven page, add a Page with component "Tile Grid".
              </p>
            </div>

            {formData.actionType === 'external_link' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  External URL
                </label>
                <input
                  type="url"
                  value={formData.actionUrl || ''}
                  onChange={(e) => setFormData({ ...formData, actionUrl: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://example.com"
                />
              </div>
            )}

            {formData.actionType === 'popup' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Popup Content (URL or Message)
                </label>
                <textarea
                  value={formData.actionUrl || ''}
                  onChange={(e) => setFormData({ ...formData, actionUrl: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={4}
                  placeholder="Enter message or URL to display in popup"
                />
              </div>
            )}

            {formData.actionType === 'video' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Video Platform
                  </label>
                  <select
                    value={formData.videoType || 'youtube'}
                    onChange={(e) => setFormData({ ...formData, videoType: e.target.value as 'youtube' | 'vimeo' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="youtube">YouTube</option>
                    <option value="vimeo">Vimeo</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Video ID
                  </label>
                  <input
                    type="text"
                    value={formData.videoId || ''}
                    onChange={(e) => setFormData({ ...formData, videoId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., dQw4w9WgXcQ (YouTube) or 123456789 (Vimeo)"
                  />
                </div>
              </div>
            )}

            {formData.actionType === 'image' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Image URL
                </label>
                <input
                  type="url"
                  value={formData.imageUrl || ''}
                  onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://example.com/image.jpg"
                />
              </div>
            )}

            {formData.actionType === 'pdf' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  PDF URL
                </label>
                <input
                  type="url"
                  value={formData.pdfUrl || ''}
                  onChange={(e) => setFormData({ ...formData, pdfUrl: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://example.com/document.pdf"
                />
              </div>
            )}

            {formData.actionType === 'demo' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Demo Experience
                </label>
                <select
                  value={formData.demoScenarioId || ''}
                  onChange={(e) => setFormData({ ...formData, demoScenarioId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select a demo...</option>
                  <option value="guided-shopping">Guided Shopping / Package Builder</option>
                  <option value="facial-measurements">Facial Measurements (PD, Seg Height)</option>
                  <option value="frame-scanner">Frame Scanner (Barcode/UPC)</option>
                  <option value="polarization">Polarization</option>
                  <option value="blue-light">Blue Light Filter</option>
                  <option value="anti-reflective">Anti-Reflective Coating</option>
                  <option value="night-driving">Night Driving Enhancement</option>
                  <option value="photochromic">Photochromic (Transitions)</option>
                  <option value="water-reflection">Water Polarization</option>
                  <option value="ar-simulator">AR Lens Simulator</option>
                  <option value="virtual-tryon">Virtual Frame Try-On</option>
                  <option value="demo-gallery">Full Demo Gallery</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Select which interactive demo to display when this tile is clicked
                </p>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enabled"
                checked={formData.enabled}
                onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="enabled" className="text-sm font-medium text-gray-700">
                Enable this tile
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-6 border-t">
            <button
              type="button"
              onClick={handleCloseModal}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded hover:bg-blue-800 transition-colors"
            >
              <Save className="w-4 h-4" />
              {editingTile ? 'Update' : 'Create'} Tile
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
