/**
 * A configurable page in the Guided Shopping flow.
 *
 * The `componentKey` is the lookup into pageRegistry — it MUST be a string
 * the registry knows about, since admin can't ship arbitrary code. Adding a
 * new page-type means: implement the component, register it, and admins can
 * then pick it from a dropdown.
 */
export interface ShoppingPage {
  id: string;
  label: string;          // shown in the stepper
  componentKey: string;   // pageRegistry lookup key
  enabled: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShoppingPageFormData {
  label: string;
  componentKey: string;
  enabled: boolean;
}
