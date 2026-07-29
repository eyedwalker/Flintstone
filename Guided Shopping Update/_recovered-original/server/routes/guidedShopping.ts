import express, { Request, Response } from 'express';
import { mockSellingModel, mockPackages, mockPricingData } from '../data/mockSellingModel';

const router = express.Router();

router.get('/selling-models', (req: Request, res: Response) => {
  res.json({
    success: true,
    sellingModels: [mockSellingModel]
  });
});

router.get('/selling-model/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  
  if (id === mockSellingModel.sellingModelId || id === 'default') {
    res.json({
      success: true,
      sellingModel: mockSellingModel
    });
  } else {
    res.status(404).json({
      success: false,
      message: 'Selling model not found'
    });
  }
});

router.get('/packages', (req: Request, res: Response) => {
  const { sellingModelId } = req.query;
  
  if (!sellingModelId || sellingModelId === mockSellingModel.sellingModelId || sellingModelId === 'default') {
    res.json({
      success: true,
      packages: mockPackages
    });
  } else {
    res.status(404).json({
      success: false,
      message: 'No packages found for this selling model'
    });
  }
});

router.get('/package/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const packageId = parseInt(id);
  
  const pkg = mockPackages.find(p => p.packageInternalId === packageId);
  
  if (pkg) {
    res.json({
      success: true,
      package: pkg
    });
  } else {
    res.status(404).json({
      success: false,
      message: 'Package not found'
    });
  }
});

router.post('/calculate-price', (req: Request, res: Response) => {
  const { packageId, selectedItems } = req.body;
  
  if (!packageId || !selectedItems) {
    return res.status(400).json({
      success: false,
      message: 'packageId and selectedItems are required'
    });
  }
  
  const pricing = mockPricingData.packages[packageId as keyof typeof mockPricingData.packages];
  
  if (!pricing) {
    return res.status(404).json({
      success: false,
      message: 'Pricing not found for this package'
    });
  }
  
  let subtotal = pricing.basePrice;
  const itemPrices: { [key: number]: number } = {};
  
  selectedItems.forEach((itemId: number) => {
    const itemPrice = pricing.items[itemId as keyof typeof pricing.items] || 0;
    itemPrices[itemId] = itemPrice;
    subtotal += itemPrice;
  });
  
  const taxRate = 0.0825;
  const tax = subtotal * taxRate;
  const total = subtotal + tax;
  
  res.json({
    success: true,
    pricing: {
      basePrice: pricing.basePrice,
      itemPrices,
      subtotal,
      tax,
      taxRate,
      total
    }
  });
});

router.post('/quote', (req: Request, res: Response) => {
  const { packageId, selectedItems, patientInfo } = req.body;
  
  if (!packageId || !selectedItems) {
    return res.status(400).json({
      success: false,
      message: 'packageId and selectedItems are required'
    });
  }
  
  const pkg = mockPackages.find(p => p.packageInternalId === packageId);
  const pricing = mockPricingData.packages[packageId as keyof typeof mockPricingData.packages];
  
  if (!pkg || !pricing) {
    return res.status(404).json({
      success: false,
      message: 'Package or pricing not found'
    });
  }
  
  let subtotal = pricing.basePrice;
  const items: Array<{ id: number; name: string; description: string; price: number }> = [];
  
  pkg.sellingModelPackageSections.forEach(section => {
    section.packageDisplayInfos.forEach(displayInfo => {
      displayInfo.value.forEach(item => {
        if (selectedItems.includes(item.catalogItemInternalId)) {
          const itemPrice = pricing.items[item.catalogItemInternalId as keyof typeof pricing.items] || 0;
          items.push({
            id: item.catalogItemInternalId,
            name: item.catalogItemName,
            description: item.catalogItemDescription,
            price: itemPrice
          });
          subtotal += itemPrice;
        }
      });
    });
  });
  
  const taxRate = 0.0825;
  const tax = subtotal * taxRate;
  const total = subtotal + tax;
  
  const quoteId = `QUOTE-${Date.now()}`;
  
  res.json({
    success: true,
    quote: {
      quoteId,
      packageName: pkg.packageName,
      packageType: pkg.packageType,
      items,
      pricing: {
        basePrice: pricing.basePrice,
        subtotal,
        tax,
        taxRate,
        total
      },
      patientInfo: patientInfo || {},
      createdAt: new Date().toISOString()
    }
  });
});

export default router;
