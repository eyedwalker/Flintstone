import TileGrid from './TileGrid';

interface Props {
  pageId?: string;
}

/** Generic admin-defined tile grid page. Wraps the shared TileGrid in a card. */
export default function TileGridPage({ pageId }: Props) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <TileGrid pageId={pageId || 'light-filters'} />
    </div>
  );
}
