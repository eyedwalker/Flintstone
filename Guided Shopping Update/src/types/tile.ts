export type TileActionType = 'none' | 'external_link' | 'popup' | 'video' | 'pdf' | 'image' | 'demo';

export interface Tile {
  id: string;
  title: string;
  description: string;
  price: number;
  bgColor: string;
  position: number;
  enabled: boolean;
  /** Which shopping page this tile belongs to (matches ShoppingPage.id). Empty/undefined = light-filters. */
  pageId?: string;
  actionType: TileActionType;
  actionUrl?: string;
  videoType?: 'youtube' | 'vimeo';
  videoId?: string;
  imageUrl?: string;
  pdfUrl?: string;
  demoScenarioId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TileFormData {
  title: string;
  description: string;
  price: number;
  bgColor: string;
  enabled: boolean;
  pageId?: string;
  actionType: TileActionType;
  actionUrl?: string;
  videoType?: 'youtube' | 'vimeo';
  videoId?: string;
  imageUrl?: string;
  pdfUrl?: string;
  demoScenarioId?: string;
}
