import { Tile, TileFormData } from '../types/tile';
import { fetchRemote, pushRemote } from './configClient';

const STORAGE_KEY = 'tiles_database';
const REMOTE_KEY = 'tiles';

const defaultTiles: Tile[] = [
  {
    id: '1',
    title: 'Smart Screen',
    description: 'Reduces Blue Light Exposure',
    price: 50,
    bgColor: 'bg-blue-200',
    position: 0,
    enabled: true,
    actionType: 'none',
    pageId: 'light-filters',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '2',
    title: 'Light Reactive Grey',
    description: 'Changes from Clear to Dark Grey',
    price: 150,
    bgColor: 'bg-blue-100',
    position: 1,
    enabled: true,
    actionType: 'none',
    pageId: 'light-filters',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '3',
    title: 'Light Reactive Brown',
    description: 'Changes from Clear to Dark Brown',
    price: 150,
    bgColor: 'bg-blue-100',
    position: 2,
    enabled: true,
    actionType: 'demo',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'measurements-tile',
    title: 'Measurements',
    description: 'Measure PD and Segs this can be sent to patient to self measure',
    price: 0,
    bgColor: 'bg-orange-100',
    position: 3,
    enabled: true,
    actionType: 'demo',
    demoScenarioId: 'facial-measurements',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'frame-scanner-tile',
    title: 'Frame Scanner',
    description: 'Add to Patients Favorite Frames - in app this will be sent to patient',
    price: 0,
    bgColor: 'bg-orange-100',
    position: 4,
    enabled: true,
    actionType: 'demo',
    demoScenarioId: 'frame-scanner',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'package-builder-tile',
    title: 'Package Builder',
    description: 'Discovery',
    price: 0,
    bgColor: 'bg-orange-100',
    position: 5,
    enabled: true,
    actionType: 'demo',
    demoScenarioId: 'guided-shopping',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  // AR Coatings page defaults
  {
    id: 'ar-standard-non-glare',
    title: 'Standard Non Glare',
    description: 'Reduces Reflections & Glare, Improves Clarity',
    price: 40,
    bgColor: 'bg-blue-100',
    position: 6,
    enabled: true,
    actionType: 'none',
    pageId: 'ar-coatings',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'ar-elite-non-glare',
    title: 'Elite Non Glare',
    description: '+ Easier to Clean',
    price: 58,
    bgColor: 'bg-blue-100',
    position: 7,
    enabled: true,
    actionType: 'none',
    pageId: 'ar-coatings',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'ar-elite-uvr-non-glare',
    title: 'Elite UVR Non Glare',
    description: '+ Easiest to Clean and Most Scratch Resistant',
    price: 58,
    bgColor: 'bg-blue-100',
    position: 8,
    enabled: true,
    actionType: 'none',
    pageId: 'ar-coatings',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

class TileService {
  private loadTiles(): Tile[] {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const tiles = JSON.parse(stored) as Tile[];
      let mutated = false;
      // Backfill pageId for tiles that pre-date the page-mapping feature.
      for (const t of tiles) {
        if (!t.pageId) { t.pageId = 'light-filters'; mutated = true; }
      }
      // Seed default AR coatings tiles if none exist for that page yet —
      // older localStorage data wouldn't have them and the page would be empty.
      const hasArTiles = tiles.some(t => t.pageId === 'ar-coatings');
      if (!hasArTiles) {
        const arDefaults = defaultTiles.filter(t => t.pageId === 'ar-coatings');
        if (arDefaults.length) {
          let pos = tiles.length;
          for (const t of arDefaults) tiles.push({ ...t, position: pos++ });
          mutated = true;
        }
      }
      if (mutated) this.saveTiles(tiles);
      return tiles;
    }
    this.saveTiles(defaultTiles);
    return defaultTiles;
  }

  /** Tiles for one specific page. */
  getEnabledForPage(pageId: string): Tile[] {
    return this.getEnabled().filter(t => (t.pageId || 'light-filters') === pageId);
  }

  private saveTiles(tiles: Tile[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tiles));
    // Push to server in the background so changes stick across browsers /
    // sessions / devices. We don't await — the sync getter API is preserved.
    pushRemote(REMOTE_KEY, tiles);
  }

  /**
   * Pull the canonical tile list from the server and overwrite localStorage.
   * Call once on app mount so a fresh browser sees the latest config without
   * an admin having to re-save.
   */
  async hydrateFromServer(): Promise<void> {
    const remote = await fetchRemote<Tile[]>(REMOTE_KEY);
    if (Array.isArray(remote) && remote.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
      return;
    }
    // No server-side state yet → seed it from whatever the local default
    // path produced. Next browser will see this state on hydrate.
    const tiles = this.loadTiles();
    pushRemote(REMOTE_KEY, tiles);
  }

  getAll(): Tile[] {
    return this.loadTiles().sort((a, b) => a.position - b.position);
  }

  getById(id: string): Tile | undefined {
    return this.loadTiles().find(tile => tile.id === id);
  }

  getEnabled(): Tile[] {
    return this.getAll().filter(tile => tile.enabled);
  }

  create(data: TileFormData): Tile {
    const tiles = this.loadTiles();
    const newTile: Tile = {
      id: Date.now().toString(),
      ...data,
      position: tiles.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    tiles.push(newTile);
    this.saveTiles(tiles);
    return newTile;
  }

  update(id: string, data: Partial<TileFormData>): Tile | null {
    const tiles = this.loadTiles();
    const index = tiles.findIndex(tile => tile.id === id);
    if (index === -1) return null;

    tiles[index] = {
      ...tiles[index],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    this.saveTiles(tiles);
    return tiles[index];
  }

  delete(id: string): boolean {
    const tiles = this.loadTiles();
    const filtered = tiles.filter(tile => tile.id !== id);
    if (filtered.length === tiles.length) return false;
    
    filtered.forEach((tile, index) => {
      tile.position = index;
    });
    this.saveTiles(filtered);
    return true;
  }

  reorder(tiles: Tile[]): void {
    tiles.forEach((tile, index) => {
      tile.position = index;
    });
    this.saveTiles(tiles);
  }

  resetToDefaults(): void {
    this.saveTiles(defaultTiles);
  }
}

export const tileService = new TileService();
