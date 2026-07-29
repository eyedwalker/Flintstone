import { ShoppingPage, ShoppingPageFormData } from '../types/page';
import { fetchRemote, pushRemote } from './configClient';

const STORAGE_KEY = 'shopping_pages_v1';
const REMOTE_KEY = 'pages';

const now = () => new Date().toISOString();

const defaultPages: ShoppingPage[] = [
  {
    id: 'light-filters',
    label: 'Light Filters',
    componentKey: 'light-filters',
    enabled: true,
    position: 0,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'ar-coatings',
    label: 'AR Coatings',
    componentKey: 'ar-coatings',
    enabled: true,
    position: 1,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'frames',
    label: 'Frames',
    componentKey: 'frames',
    enabled: true,
    position: 2,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'measurements',
    label: 'Measurements',
    componentKey: 'measurements',
    enabled: true,
    position: 3,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'warranties',
    label: 'Warranties',
    componentKey: 'warranties',
    enabled: true,
    position: 4,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'labs',
    label: 'Labs',
    componentKey: 'labs',
    enabled: true,
    position: 5,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'invoicing',
    label: 'Invoicing',
    componentKey: 'invoicing',
    enabled: true,
    position: 6,
    createdAt: now(),
    updatedAt: now(),
  },
];

class PageService {
  private load(): ShoppingPage[] {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try { return JSON.parse(stored); } catch { /* fall through */ }
    }
    this.save(defaultPages);
    return defaultPages;
  }

  private save(pages: ShoppingPage[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pages));
    // Background push — same pattern as tileService.
    pushRemote(REMOTE_KEY, pages);
  }

  async hydrateFromServer(): Promise<void> {
    const remote = await fetchRemote<ShoppingPage[]>(REMOTE_KEY);
    if (Array.isArray(remote) && remote.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
      return;
    }
    const pages = this.load();
    pushRemote(REMOTE_KEY, pages);
  }

  getAll(): ShoppingPage[] {
    return this.load().sort((a, b) => a.position - b.position);
  }

  getEnabled(): ShoppingPage[] {
    return this.getAll().filter(p => p.enabled);
  }

  create(data: ShoppingPageFormData): ShoppingPage {
    const pages = this.load();
    const page: ShoppingPage = {
      id: `page-${Date.now()}`,
      ...data,
      position: pages.length,
      createdAt: now(),
      updatedAt: now(),
    };
    pages.push(page);
    this.save(pages);
    return page;
  }

  update(id: string, data: Partial<ShoppingPageFormData>): ShoppingPage | null {
    const pages = this.load();
    const idx = pages.findIndex(p => p.id === id);
    if (idx === -1) return null;
    pages[idx] = { ...pages[idx], ...data, updatedAt: now() };
    this.save(pages);
    return pages[idx];
  }

  delete(id: string): boolean {
    const pages = this.load();
    const filtered = pages.filter(p => p.id !== id);
    if (filtered.length === pages.length) return false;
    filtered.forEach((p, i) => { p.position = i; });
    this.save(filtered);
    return true;
  }

  move(id: string, direction: 'up' | 'down'): void {
    const pages = this.getAll();
    const idx = pages.findIndex(p => p.id === id);
    if (idx === -1) return;
    const swap = direction === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= pages.length) return;
    [pages[idx].position, pages[swap].position] = [pages[swap].position, pages[idx].position];
    this.save(pages);
  }

  resetToDefaults(): void {
    this.save(defaultPages);
  }
}

export const pageService = new PageService();
