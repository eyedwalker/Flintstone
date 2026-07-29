import { ComponentType } from 'react';
import ARCoatingsPage from './ARCoatingsPage';
import FramesPage from './FramesPage';
import MeasurementsPage from './MeasurementsPage';
import TileGridPage from './TileGridPage';
import LensMaterialsPage from './LensMaterialsPage';
import WarrantiesPage from './WarrantiesPage';
import LabsPage from './LabsPage';
import InvoicingPage from './InvoicingPage';

/** Props every page component receives from App.tsx. */
export interface ShoppingPageProps {
  /** Page id from pageService — useful for filtering tiles, etc. */
  pageId?: string;
}

/**
 * Allowed page-component types. Admin can only add pages whose key is in
 * here — keeps the surface area predictable and makes "add a page" a real
 * config decision instead of arbitrary code execution.
 *
 * `light-filters` is a SENTINEL for the inline Light Filters content that
 * still lives in App.tsx. It has no entry in this map; App.tsx checks the
 * componentKey and renders its own JSX when it matches.
 */
export interface PageComponentDef {
  key: string;
  label: string;
  description: string;
  component?: ComponentType<ShoppingPageProps>;   // omitted for `light-filters` (rendered inline)
}

export const PAGE_COMPONENTS: PageComponentDef[] = [
  {
    key: 'light-filters',
    label: 'Light Filters',
    description: 'Solution / package selector + light-filter pricing tiles',
    // component: undefined — rendered inline by App.tsx
  },
  {
    key: 'tile-grid',
    label: 'Tile Grid',
    description: 'Generic page rendering tiles assigned to this page (set "Show on page" on each tile)',
    component: TileGridPage,
  },
  {
    key: 'ar-coatings',
    label: 'AR Coatings',
    description: 'Standard / Elite / Elite UVR non-glare picker',
    component: ARCoatingsPage,
  },
  {
    key: 'frames',
    label: 'Frames',
    description: 'Frame catalog with favorites + search',
    component: FramesPage,
  },
  {
    key: 'measurements',
    label: 'Measurements',
    description: 'PD + seg height capture using the device camera',
    component: MeasurementsPage,
  },
  {
    key: 'lens-materials',
    label: 'Lens Materials',
    description: 'Rx-driven thickness + weight comparison across CR-39, Trivex, Poly, and high-index',
    component: LensMaterialsPage,
  },
  {
    key: 'warranties',
    label: 'Warranties',
    description: 'Select warranty plans (frame / lens coverage) for the current eyeglass order',
    component: WarrantiesPage,
  },
  {
    key: 'labs',
    label: 'Lab Selection',
    description: 'Pick the fabricating lab and confirm promise date / frame routing',
    component: LabsPage,
  },
  {
    key: 'invoicing',
    label: 'Invoicing',
    description: 'Payment method, applied payment per order, generate the invoice',
    component: InvoicingPage,
  },
];

export const PAGE_COMPONENT_MAP: Record<string, PageComponentDef> = Object.fromEntries(
  PAGE_COMPONENTS.map(p => [p.key, p]),
);
