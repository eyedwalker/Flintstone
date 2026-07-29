import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Check, ShoppingCart } from 'lucide-react';
import { Package, CatalogItem, PricingResponse } from '../types/guidedShopping';

// Use relative URL when frontend + backend are served from the same container (production).
// Override via VITE_API_BASE for local dev (e.g. http://localhost:4001/api/guided-shopping).
const API_BASE = (import.meta as any).env?.VITE_API_BASE || '/api/guided-shopping';

export default function GuidedShopping() {
  const [, setPackages] = useState<Package[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<Package | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [pricing, setPricing] = useState<PricingResponse['pricing'] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPackages();
  }, []);

  useEffect(() => {
    if (selectedPackage && selectedItems.length > 0) {
      calculatePricing();
    }
  }, [selectedItems, selectedPackage]);

  const fetchPackages = async () => {
    try {
      const response = await fetch(`${API_BASE}/packages`);
      const data = await response.json();
      if (data.success) {
        setPackages(data.packages);
        if (data.packages.length > 0) {
          setSelectedPackage(data.packages[0]);
        }
      }
    } catch (error) {
      console.error('Error fetching packages:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculatePricing = async () => {
    if (!selectedPackage) return;

    try {
      const response = await fetch(`${API_BASE}/calculate-price`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: selectedPackage.packageInternalId,
          selectedItems
        })
      });
      const data = await response.json();
      if (data.success) {
        setPricing(data.pricing);
      }
    } catch (error) {
      console.error('Error calculating price:', error);
    }
  };

  const handleItemSelect = (itemId: number) => {
    setSelectedItems(prev =>
      prev.includes(itemId)
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    );
  };

  const nextStep = () => {
    if (selectedPackage && currentStep < selectedPackage.sellingModelPackageSections.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const createQuote = async () => {
    if (!selectedPackage) return;

    // Pull patient context from sessionStorage (set by App.tsx when launched from Timeline)
    let patientCtx: { patientId?: string; patientName?: string; legacyPatientId?: string; companyId?: string; returnUrl?: string } = {};
    try {
      const stored = sessionStorage.getItem('timeline_patient_context');
      if (stored) patientCtx = JSON.parse(stored);
    } catch { /* ignore */ }

    try {
      const response = await fetch(`${API_BASE}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: selectedPackage.packageInternalId,
          selectedItems,
          patientInfo: patientCtx,
        })
      });
      const data = await response.json();
      if (!data.success) {
        alert('Failed to create quote');
        return;
      }

      // If launched from Timeline, push the completed order back via webhook
      if (patientCtx.patientId) {
        await notifyTimeline(data.quote, patientCtx);
      }

      alert(`Quote created! Quote ID: ${data.quote.quoteId}\nTotal: $${data.quote.pricing.total.toFixed(2)}`);

      // Return to Timeline if we have a return URL
      if (patientCtx.returnUrl) {
        if (confirm('Return to patient journey in Timeline?')) {
          window.location.href = patientCtx.returnUrl;
        }
      }
    } catch (error) {
      console.error('Error creating quote:', error);
      alert('Failed to create quote — see console');
    }
  };

  const notifyTimeline = async (quote: any, ctx: { patientId?: string; legacyPatientId?: string; companyId?: string }) => {
    const timelineBase = (import.meta as any).env?.VITE_TIMELINE_BASE_URL || 'https://prc.wubba.ai';
    const secret = (import.meta as any).env?.VITE_TIMELINE_WEBHOOK_SECRET || '';
    if (!ctx.patientId) return;

    try {
      const res = await fetch(`${timelineBase}/api/guided-shopping/order-complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { 'X-Guided-Shopping-Secret': secret } : {}),
        },
        body: JSON.stringify({
          patientId: ctx.patientId,
          legacyPatientId: ctx.legacyPatientId,
          companyId: ctx.companyId,
          quoteId: quote.quoteId,
          packageName: quote.packageName,
          packageType: quote.packageType,
          items: quote.items,
          totals: quote.pricing,
          completedAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        console.warn('[GuidedShopping] Timeline webhook failed:', res.status);
      } else {
        console.log('[GuidedShopping] Order sent back to Timeline');
      }
    } catch (err: any) {
      console.warn('[GuidedShopping] Could not notify Timeline:', err.message);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading guided shopping...</div>
      </div>
    );
  }

  if (!selectedPackage) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">No packages available</div>
      </div>
    );
  }

  const currentSection = selectedPackage.sellingModelPackageSections[currentStep];
  const isLastStep = currentStep === selectedPackage.sellingModelPackageSections.length - 1;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 py-8">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Find Your Perfect Eyewear
          </h1>
          <p className="text-gray-600">
            Build your ideal glasses step by step
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-2xl font-bold text-white">
                  {selectedPackage.packageName}
                </h2>
                <p className="text-blue-100">{selectedPackage.packageType} Package</p>
              </div>
              {pricing && (
                <div className="bg-white/20 backdrop-blur-sm rounded-lg p-4 text-right">
                  <div className="text-sm text-blue-100">Estimated Total</div>
                  <div className="text-3xl font-bold text-white">
                    ${pricing.total.toFixed(2)}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {selectedPackage.sellingModelPackageSections.map((section, idx) => (
                <div key={idx} className="flex-1">
                  <div className="flex items-center">
                    <div
                      className={`flex-1 h-2 rounded-full ${
                        idx < currentStep
                          ? 'bg-green-400'
                          : idx === currentStep
                          ? 'bg-white'
                          : 'bg-white/30'
                      }`}
                    />
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center ml-2 ${
                        idx < currentStep
                          ? 'bg-green-400 text-white'
                          : idx === currentStep
                          ? 'bg-white text-blue-600'
                          : 'bg-white/30 text-white'
                      }`}
                    >
                      {idx < currentStep ? <Check className="w-4 h-4" /> : idx + 1}
                    </div>
                  </div>
                  <div className="text-xs text-white/80 mt-1 text-center">
                    {section.sectionHeader}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-8">
            <div className="mb-6">
              <h3 className="text-2xl font-bold text-gray-900 mb-2">
                {currentSection.sectionHeader}
              </h3>
              <p className="text-gray-600">{currentSection.progressIndicator}</p>
            </div>

            <div className="space-y-8">
              {currentSection.packageDisplayInfos.map((displayInfo, idx) => (
                <div key={idx}>
                  <h4 className="text-lg font-semibold text-gray-800 mb-4">
                    {displayInfo.key}
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {displayInfo.value.map((item: CatalogItem) => {
                      const isSelected = selectedItems.includes(item.catalogItemInternalId);
                      const itemPrice = pricing?.itemPrices[item.catalogItemInternalId] || 0;

                      return (
                        <button
                          key={item.catalogItemInternalId}
                          onClick={() => handleItemSelect(item.catalogItemInternalId)}
                          className={`p-6 rounded-xl border-2 transition-all text-left ${
                            isSelected
                              ? 'border-blue-600 bg-blue-50 shadow-lg transform scale-105'
                              : 'border-gray-200 hover:border-blue-300 hover:shadow-md'
                          }`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <h5 className="font-semibold text-gray-900">
                              {item.catalogItemName}
                            </h5>
                            {isSelected && (
                              <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center">
                                <Check className="w-4 h-4 text-white" />
                              </div>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 mb-3">
                            {item.catalogItemDescription}
                          </p>
                          <div className="text-lg font-bold text-gray-900">
                            {itemPrice > 0 ? `+$${itemPrice.toFixed(2)}` : 'Included'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 flex items-center justify-between">
              <button
                onClick={prevStep}
                disabled={currentStep === 0}
                className="flex items-center gap-2 px-6 py-3 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
                Previous
              </button>

              {!isLastStep ? (
                <button
                  onClick={nextStep}
                  className="flex items-center gap-2 px-6 py-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                >
                  Next Step
                  <ChevronRight className="w-5 h-5" />
                </button>
              ) : (
                <button
                  onClick={createQuote}
                  className="flex items-center gap-2 px-6 py-3 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
                >
                  <ShoppingCart className="w-5 h-5" />
                  Create Quote
                </button>
              )}
            </div>
          </div>
        </div>

        {pricing && (
          <div className="mt-6 bg-white rounded-xl shadow-lg p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Price Breakdown</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-gray-700">
                <span>Base Package</span>
                <span>${pricing.basePrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-gray-700">
                <span>Add-ons</span>
                <span>${(pricing.subtotal - pricing.basePrice).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-gray-700">
                <span>Tax ({(pricing.taxRate * 100).toFixed(2)}%)</span>
                <span>${pricing.tax.toFixed(2)}</span>
              </div>
              <div className="border-t border-gray-300 pt-2 mt-2">
                <div className="flex justify-between text-xl font-bold text-gray-900">
                  <span>Total</span>
                  <span>${pricing.total.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
