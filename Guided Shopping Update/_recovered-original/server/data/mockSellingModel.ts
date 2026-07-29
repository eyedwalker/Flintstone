export const mockSellingModel = {
  sellingModelId: "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
  sellingModelName: "VSP Premier Guided Shopping",
  sellingModelDescription: "Comprehensive eyewear selection experience",
  sellingModelType: "Retail",
  isDefault: true,
  isRetail: true,
  lensText: "Select your perfect lenses",
  priceText: "Your estimated total",
  additionalPairBenefit: "Save 20% on a second pair",
  sellingModelLabel: "Find Your Perfect Eyewear",
  packagesLabel: "Choose Your Package",
  framePageHeading: "Select Your Frame Style",
  framePageText: "Choose frames that match your lifestyle and personality",
  buyingPowerBanner: "VSP members save an average of $200",
  displaySettings: {
    id: "d1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a",
    sellingModelId: "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
    headerLabel: "Build Your Perfect Eyewear",
    isMultiPage: true,
    displayEstimatedPricing: true,
    frameSource: { key: 1, value: "In-Store Inventory" }
  },
  pricePointsSection: {
    id: "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b",
    sellingModelId: "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
    sectionHeader: "Popular Price Points",
    description: "Most patients choose packages in these ranges",
    pricePoints: [149.99, 249.99, 349.99, 449.99]
  }
};

export const mockPackages = [
  {
    selingModelPackageId: "pkg-basic-001",
    packageInternalId: 1,
    packageName: "Essential Vision",
    packageType: "Basic",
    sellingModelItemType: { key: 1, value: "Complete Eyewear" },
    order: 1,
    sellingModelPackageSections: [
      {
        sectionHeader: "Choose Your Frame",
        progressIndicator: "Step 1 of 4",
        stepNumber: 1,
        packageDisplayInfos: [
          {
            key: "Metal Frames",
            value: [
              {
                catalogItemInternalId: 101,
                gridNumber: 1,
                catalogItemName: "Classic Metal",
                catalogItemDescription: "Timeless metal frames with adjustable nose pads"
              },
              {
                catalogItemInternalId: 102,
                gridNumber: 2,
                catalogItemName: "Aviator Style",
                catalogItemDescription: "Icon aviator design in multiple colors"
              },
              {
                catalogItemInternalId: 103,
                gridNumber: 3,
                catalogItemName: "Minimalist Metal",
                catalogItemDescription: "Ultra-thin metal frames for a modern look"
              }
            ]
          },
          {
            key: "Plastic Frames",
            value: [
              {
                catalogItemInternalId: 201,
                gridNumber: 4,
                catalogItemName: "Bold Rectangle",
                catalogItemDescription: "Statement rectangular frames in vibrant colors"
              },
              {
                catalogItemInternalId: 202,
                gridNumber: 5,
                catalogItemName: "Round Retro",
                catalogItemDescription: "Vintage-inspired round frames"
              },
              {
                catalogItemInternalId: 203,
                gridNumber: 6,
                catalogItemName: "Cat Eye",
                catalogItemDescription: "Classic cat-eye shape with modern details"
              }
            ]
          }
        ]
      },
      {
        sectionHeader: "Select Lens Type",
        progressIndicator: "Step 2 of 4",
        stepNumber: 2,
        packageDisplayInfos: [
          {
            key: "Vision Correction",
            value: [
              {
                catalogItemInternalId: 301,
                gridNumber: 1,
                catalogItemName: "Single Vision",
                catalogItemDescription: "For distance or reading correction"
              },
              {
                catalogItemInternalId: 302,
                gridNumber: 2,
                catalogItemName: "Progressive (No-Line Bifocal)",
                catalogItemDescription: "Seamless transition for all distances"
              },
              {
                catalogItemInternalId: 303,
                gridNumber: 3,
                catalogItemName: "Bifocal",
                catalogItemDescription: "Traditional lined bifocal lenses"
              }
            ]
          },
          {
            key: "Lens Material",
            value: [
              {
                catalogItemInternalId: 401,
                gridNumber: 4,
                catalogItemName: "Standard Plastic",
                catalogItemDescription: "Affordable and lightweight"
              },
              {
                catalogItemInternalId: 402,
                gridNumber: 5,
                catalogItemName: "Polycarbonate",
                catalogItemDescription: "Impact-resistant, recommended for active lifestyles"
              },
              {
                catalogItemInternalId: 403,
                gridNumber: 6,
                catalogItemName: "High-Index 1.67",
                catalogItemDescription: "Thinner lenses for stronger prescriptions"
              }
            ]
          }
        ]
      },
      {
        sectionHeader: "Add Lens Treatments",
        progressIndicator: "Step 3 of 4",
        stepNumber: 3,
        packageDisplayInfos: [
          {
            key: "Essential Treatments",
            value: [
              {
                catalogItemInternalId: 501,
                gridNumber: 1,
                catalogItemName: "Anti-Reflective Coating",
                catalogItemDescription: "Reduces glare and reflections for clearer vision"
              },
              {
                catalogItemInternalId: 502,
                gridNumber: 2,
                catalogItemName: "Scratch-Resistant Coating",
                catalogItemDescription: "Protects lenses from everyday wear"
              },
              {
                catalogItemInternalId: 503,
                gridNumber: 3,
                catalogItemName: "UV Protection",
                catalogItemDescription: "Blocks 100% of harmful UV rays"
              }
            ]
          },
          {
            key: "Premium Treatments",
            value: [
              {
                catalogItemInternalId: 504,
                gridNumber: 4,
                catalogItemName: "Blue Light Filter",
                catalogItemDescription: "Reduces digital eye strain from screens"
              },
              {
                catalogItemInternalId: 505,
                gridNumber: 5,
                catalogItemName: "Photochromic (Transitions)",
                catalogItemDescription: "Lenses that darken in sunlight"
              },
              {
                catalogItemInternalId: 506,
                gridNumber: 6,
                catalogItemName: "Polarized",
                catalogItemDescription: "Eliminates glare for outdoor activities"
              }
            ]
          }
        ]
      },
      {
        sectionHeader: "Review & Customize",
        progressIndicator: "Step 4 of 4",
        stepNumber: 4,
        packageDisplayInfos: [
          {
            key: "Additional Options",
            value: [
              {
                catalogItemInternalId: 601,
                gridNumber: 1,
                catalogItemName: "Lens Tint",
                catalogItemDescription: "Add custom tint color"
              },
              {
                catalogItemInternalId: 602,
                gridNumber: 2,
                catalogItemName: "Edge Polish",
                catalogItemDescription: "Polished edges for rimless frames"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    selingModelPackageId: "pkg-premium-002",
    packageInternalId: 2,
    packageName: "Premium Vision",
    packageType: "Premium",
    sellingModelItemType: { key: 1, value: "Complete Eyewear" },
    order: 2,
    sellingModelPackageSections: [
      {
        sectionHeader: "Choose Your Frame",
        progressIndicator: "Step 1 of 4",
        stepNumber: 1,
        packageDisplayInfos: [
          {
            key: "Designer Frames",
            value: [
              {
                catalogItemInternalId: 701,
                gridNumber: 1,
                catalogItemName: "Ray-Ban Classic",
                catalogItemDescription: "Iconic Ray-Ban wayfarer style"
              },
              {
                catalogItemInternalId: 702,
                gridNumber: 2,
                catalogItemName: "Oakley Sport",
                catalogItemDescription: "Performance frames for active lifestyles"
              },
              {
                catalogItemInternalId: 703,
                gridNumber: 3,
                catalogItemName: "Prada Luxury",
                catalogItemDescription: "High-fashion Italian design"
              }
            ]
          },
          {
            key: "Premium Materials",
            value: [
              {
                catalogItemInternalId: 704,
                gridNumber: 4,
                catalogItemName: "Titanium Flex",
                catalogItemDescription: "Lightweight, flexible titanium frames"
              },
              {
                catalogItemInternalId: 705,
                gridNumber: 5,
                catalogItemName: "Wood Grain",
                catalogItemDescription: "Eco-friendly wood and acetate blend"
              }
            ]
          }
        ]
      },
      {
        sectionHeader: "Select Premium Lenses",
        progressIndicator: "Step 2 of 4",
        stepNumber: 2,
        packageDisplayInfos: [
          {
            key: "Advanced Lens Technology",
            value: [
              {
                catalogItemInternalId: 801,
                gridNumber: 1,
                catalogItemName: "Digital Progressive HD",
                catalogItemDescription: "Precision-crafted progressive lenses"
              },
              {
                catalogItemInternalId: 802,
                gridNumber: 2,
                catalogItemName: "Varilux X Series",
                catalogItemDescription: "Premium progressive with extended vision"
              }
            ]
          },
          {
            key: "Premium Materials",
            value: [
              {
                catalogItemInternalId: 803,
                gridNumber: 3,
                catalogItemName: "High-Index 1.74",
                catalogItemDescription: "Ultra-thin lenses for strong prescriptions"
              },
              {
                catalogItemInternalId: 804,
                gridNumber: 4,
                catalogItemName: "Trivex",
                catalogItemDescription: "Superior optics and impact resistance"
              }
            ]
          }
        ]
      },
      {
        sectionHeader: "Premium Treatments",
        progressIndicator: "Step 3 of 4",
        stepNumber: 3,
        packageDisplayInfos: [
          {
            key: "Complete Protection Package",
            value: [
              {
                catalogItemInternalId: 901,
                gridNumber: 1,
                catalogItemName: "Crizal Sapphire AR",
                catalogItemDescription: "Premium anti-reflective with all coatings included"
              },
              {
                catalogItemInternalId: 902,
                gridNumber: 2,
                catalogItemName: "Transitions Signature",
                catalogItemDescription: "Advanced photochromic technology"
              }
            ]
          }
        ]
      },
      {
        sectionHeader: "Review Your Selection",
        progressIndicator: "Step 4 of 4",
        stepNumber: 4,
        packageDisplayInfos: []
      }
    ]
  }
];

export const mockPricingData = {
  packages: {
    1: {
      basePrice: 149.99,
      items: {
        101: 0, 102: 0, 103: 0,
        201: 0, 202: 0, 203: 0,
        301: 0,
        302: 120.00,
        303: 80.00,
        401: 0,
        402: 40.00,
        403: 100.00,
        501: 75.00,
        502: 30.00,
        503: 0,
        504: 50.00,
        505: 120.00,
        506: 150.00,
        601: 25.00,
        602: 20.00
      }
    },
    2: {
      basePrice: 349.99,
      items: {
        701: 150.00, 702: 200.00, 703: 350.00,
        704: 180.00, 705: 220.00,
        801: 250.00,
        802: 320.00,
        803: 180.00,
        804: 150.00,
        901: 175.00,
        902: 150.00
      }
    }
  }
};
