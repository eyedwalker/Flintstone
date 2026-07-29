import { useEffect, useState } from 'react';
import { ExternalLink, Video, FileText, Image as ImageIcon, MessageSquare, Play } from 'lucide-react';
import { Tile } from '../../types/tile';
import { tileService } from '../../services/tileService';
import { Modal } from '../Modal';
import { VideoModal } from '../VideoModal';
import { PDFModal } from '../PDFModal';
import { ImageModal } from '../ImageModal';

/**
 * Reusable tile grid + action modals. Used by:
 *   - <TileGridPage /> for admin-defined "Tile Grid" pages
 *   - <ARCoatingsPage /> (and any other page that wants tile-driven content
 *     under its own custom header)
 *
 * Layout prop controls the visual:
 *   - "stacked": rows of `columns` tiles, each tile a vertical card (default;
 *     matches Light Filters)
 *   - "row":     a single horizontal row, all tiles side-by-side; the title
 *     becomes a colored header band (matches the AR Coatings screenshot)
 */
interface Props {
  pageId: string;
  layout?: 'stacked' | 'row';
  columns?: number; // only for stacked
}

const ACTION_ICON: Record<string, React.ReactNode> = {
  external_link: <ExternalLink className="w-4 h-4" />,
  video:         <Video className="w-4 h-4" />,
  pdf:           <FileText className="w-4 h-4" />,
  image:         <ImageIcon className="w-4 h-4" />,
  popup:         <MessageSquare className="w-4 h-4" />,
  demo:          <Play className="w-4 h-4" />,
};

const ACTION_LABEL: Record<string, string> = {
  external_link: 'Visit Link',
  video:         'Watch Video',
  pdf:           'View PDF',
  image:         'View Image',
  popup:         'See Details',
  demo:          'Try Demo',
};

export default function TileGrid({ pageId, layout = 'stacked', columns = 3 }: Props) {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [selected, setSelected] = useState<Tile | null>(null);
  const [actionTile, setActionTile] = useState<Tile | null>(null);

  useEffect(() => {
    setTiles(tileService.getEnabledForPage(pageId));
  }, [pageId]);

  const closeAction = () => setActionTile(null);

  const triggerAction = (tile: Tile) => {
    // External links open in a new tab — embedded iframes get blocked by
    // X-Frame-Options/CSP on most retail sites, so the modal would render
    // a "refused to connect" page.
    if (tile.actionType === 'external_link' && tile.actionUrl) {
      window.open(tile.actionUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    setActionTile(tile);
  };

  if (tiles.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 text-sm">
        No tiles assigned to this page yet. Open admin → Tiles → Edit → "Show on page".
      </div>
    );
  }

  const tileCard = (tile: Tile, variant: 'stacked' | 'row') => (
    <div
      key={tile.id}
      className={`${tile.bgColor} rounded-lg overflow-hidden transition-all relative ${
        selected?.id === tile.id ? 'ring-4 ring-blue-700 shadow-xl' : ''
      } ${variant === 'row' ? 'flex flex-col' : ''}`}
    >
      <button
        type="button"
        onClick={() => setSelected(tile)}
        className="w-full text-left transition-transform hover:scale-[1.01] flex-1"
      >
        <div className={`p-4 ${variant === 'row' ? 'border-b border-blue-200' : 'border-b-2 border-blue-300'}`}>
          <h3 className="text-lg font-semibold text-center">{tile.title}</h3>
        </div>
        <div className="bg-white p-6 flex-1 flex flex-col items-center justify-between min-h-[180px]">
          <p className="text-sm text-center text-gray-700 mb-6">{tile.description}</p>
          <div className="text-center">
            <div className="text-sm text-gray-600 mb-1">You Pay</div>
            <div className="text-4xl font-bold">
              <span className="text-2xl align-top">$</span>{tile.price}
            </div>
          </div>
        </div>
      </button>

      {selected?.id === tile.id && tile.actionType !== 'none' && (
        <div className="bg-blue-50 border-t border-blue-200 p-4">
          <button
            type="button"
            onClick={() => triggerAction(tile)}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-700 text-white rounded-lg hover:bg-blue-800 transition-colors font-semibold"
          >
            {ACTION_ICON[tile.actionType] || null}
            <span>{ACTION_LABEL[tile.actionType] || 'Open'}</span>
          </button>
        </div>
      )}
    </div>
  );

  const grid = layout === 'row' ? (
    <div
      className="grid gap-0 border border-gray-200 rounded overflow-hidden"
      style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}
    >
      {tiles.map((t) => tileCard(t, 'row'))}
    </div>
  ) : (
    <div className="space-y-4">
      {(() => {
        const rows: Tile[][] = [];
        for (let i = 0; i < tiles.length; i += columns) rows.push(tiles.slice(i, i + columns));
        return rows.map((row, idx) => (
          <div
            key={idx}
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {row.map((t) => tileCard(t, 'stacked'))}
          </div>
        ));
      })()}
    </div>
  );

  return (
    <>
      {grid}

      {actionTile?.actionType === 'video' && actionTile.videoId && actionTile.videoType && (
        <VideoModal isOpen onClose={closeAction} videoType={actionTile.videoType} videoId={actionTile.videoId} title={actionTile.title} />
      )}
      {actionTile?.actionType === 'pdf' && actionTile.pdfUrl && (
        <PDFModal isOpen onClose={closeAction} pdfUrl={actionTile.pdfUrl} title={actionTile.title} />
      )}
      {actionTile?.actionType === 'image' && actionTile.imageUrl && (
        <ImageModal isOpen onClose={closeAction} imageUrl={actionTile.imageUrl} title={actionTile.title} />
      )}
      {actionTile?.actionType === 'popup' && (
        <Modal isOpen onClose={closeAction} title={actionTile.title}>
          <div className="p-6"><p className="text-gray-700">{actionTile.description}</p></div>
        </Modal>
      )}
      {actionTile?.actionType === 'external_link' && actionTile.actionUrl && (
        <Modal isOpen onClose={closeAction} title={actionTile.title} size="full">
          <div className="h-[85vh]">
            <iframe
              src={actionTile.actionUrl}
              className="w-full h-full border-0"
              title={actionTile.title}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        </Modal>
      )}
    </>
  );
}
