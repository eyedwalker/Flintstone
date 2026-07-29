export interface CatalogItem {
  catalogItemInternalId: number;
  gridNumber: number;
  catalogItemName: string;
  catalogItemDescription: string;
}

export interface PackageDisplayInfo {
  key: string;
  value: CatalogItem[];
}

export interface PackageSection {
  sectionHeader: string;
  progressIndicator: string;
  stepNumber: number;
  packageDisplayInfos: PackageDisplayInfo[];
}

export interface Package {
  selingModelPackageId: string;
  packageInternalId: number;
  packageName: string;
  packageType: string;
  sellingModelItemType: {
    key: number;
    value: string;
  };
  order: number;
  sellingModelPackageSections: PackageSection[];
}

export interface PricingResponse {
  success: boolean;
  pricing: {
    basePrice: number;
    itemPrices: { [key: number]: number };
    subtotal: number;
    tax: number;
    taxRate: number;
    total: number;
  };
}

export interface QuoteResponse {
  success: boolean;
  quote: {
    quoteId: string;
    packageName: string;
    packageType: string;
    items: Array<{
      id: number;
      name: string;
      description: string;
      price: number;
    }>;
    pricing: {
      basePrice: number;
      subtotal: number;
      tax: number;
      taxRate: number;
      total: number;
    };
    patientInfo?: any;
    createdAt: string;
  };
}
