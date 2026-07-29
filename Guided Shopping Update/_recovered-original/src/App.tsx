import { useState, useEffect } from 'react'
import { Menu, User, Shield, Tag, Briefcase, Bell, Eye, ClipboardList, Settings, Lightbulb, ExternalLink, Video, FileText, Image as ImageIcon, MessageSquare, Play, Check } from 'lucide-react'
import { Tile } from './types/tile'
import { tileService } from './services/tileService'
import { ShoppingPage } from './types/page'
import { pageService } from './services/pageService'
import { PAGE_COMPONENT_MAP } from './components/pages/registry'
import { Admin } from './components/Admin'
import { VideoModal } from './components/VideoModal'
import { PDFModal } from './components/PDFModal'
import { ImageModal } from './components/ImageModal'
import { Modal } from './components/Modal'
import { LensDemo } from './components/LensDemo'
import { VirtualTryOn } from './components/VirtualTryOn'
import { ARLensSimulator } from './components/ARLensSimulator'
import { DemoGallery } from './components/DemoGallery'
import { VisionConditionSimulator } from './components/VisionConditionSimulator'
import { InteractiveVideoTours } from './components/InteractiveVideoTours'
import { LifestyleImageGallery } from './components/LifestyleImageGallery'
import GuidedShopping from './components/GuidedShopping'
import FacialMeasurementDemo from './components/FacialMeasurementDemo'
import FrameScannerDemo from './components/FrameScannerDemo'
import LensMaterialComparison from './components/LensMaterialComparison'

function App() {
  const [selectedSolution, setSelectedSolution] = useState('Poly SV & Premium Digital Prog.')
  const [selectedPackage, setSelectedPackage] = useState('Standard Single Vision')
  const [singlePageView, setSinglePageView] = useState(false)
  const [isAdminMode, setIsAdminMode] = useState(false)
  const [isDemoMode, setIsDemoMode] = useState(false)
  const [activeDemoScenario, setActiveDemoScenario] = useState<string | null>(null)
  const [tiles, setTiles] = useState<Tile[]>([])
  const [pages, setPages] = useState<ShoppingPage[]>([])
  const [currentPageId, setCurrentPageId] = useState<string | null>(null)
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null)
  const [selectedTileForAction, setSelectedTileForAction] = useState<Tile | null>(null)
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false)
  const [isPDFModalOpen, setIsPDFModalOpen] = useState(false)
  const [isImageModalOpen, setIsImageModalOpen] = useState(false)
  const [isPopupModalOpen, setIsPopupModalOpen] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  // Patient context from Timeline launch (query params)
  const [patientContext, setPatientContext] = useState<{
    patientId?: string
    patientName?: string
    legacyPatientId?: string
    companyId?: string
    reasonForVisit?: string
    returnUrl?: string
    rx?: {
      odSphere?: string; odCylinder?: string; odAxis?: string
      osSphere?: string; osCylinder?: string; osAxis?: string
      add?: string; pd?: string
      rxNumber?: string; rxDate?: string; providerName?: string
    }
  } | null>(null)

  useEffect(() => {
    // Pull server-side admin config first so we don't render with stale
    // localStorage from a different browser. After hydration, refresh
    // the in-memory tile/page state so the UI picks up the canonical config.
    Promise.all([
      tileService.hydrateFromServer(),
      pageService.hydrateFromServer(),
    ]).finally(() => {
      loadTiles()
      loadPages()
    })

    // Check URL params for direct demo linking (e.g., ?demo=polarization)
    const params = new URLSearchParams(window.location.search)
    const demoParam = params.get('demo')
    if (demoParam) {
      setActiveDemoScenario(demoParam)
      setIsDemoMode(true)
      // standalone mode hides "Back to Shopping" for cleaner embeds
      if (params.get('standalone') === 'true') {
        setIsStandalone(true)
      }
    }

    // Read patient context from Timeline launch
    const patientId = params.get('patientId')
    if (patientId) {
      setPatientContext({
        patientId,
        patientName: params.get('patientName') || undefined,
        legacyPatientId: params.get('legacyPatientId') || undefined,
        companyId: params.get('companyId') || undefined,
        reasonForVisit: params.get('reasonForVisit') || undefined,
        returnUrl: params.get('returnUrl') || undefined,
        rx: {
          odSphere: params.get('odSphere') || undefined,
          odCylinder: params.get('odCylinder') || undefined,
          odAxis: params.get('odAxis') || undefined,
          osSphere: params.get('osSphere') || undefined,
          osCylinder: params.get('osCylinder') || undefined,
          osAxis: params.get('osAxis') || undefined,
          add: params.get('add') || undefined,
          pd: params.get('pd') || undefined,
          rxNumber: params.get('rxNumber') || undefined,
          rxDate: params.get('rxDate') || undefined,
          providerName: params.get('providerName') || undefined,
        },
      })
      // Persist for downstream components (webhook sender, measurements, etc.)
      try {
        sessionStorage.setItem('timeline_patient_context', JSON.stringify({
          patientId,
          patientName: params.get('patientName'),
          legacyPatientId: params.get('legacyPatientId'),
          companyId: params.get('companyId'),
          returnUrl: params.get('returnUrl'),
        }))
      } catch { /* ignore storage errors */ }
    }
  }, [])

  const loadTiles = () => {
    // Light Filters is the only inline-rendered page that uses the tile grid in
    // App.tsx; filter to that page so tiles assigned to other pages don't leak in.
    setTiles(tileService.getEnabledForPage('light-filters'))
  }

  const loadPages = () => {
    const enabled = pageService.getEnabled()
    setPages(enabled)
    setCurrentPageId(prev => {
      if (prev && enabled.some(p => p.id === prev)) return prev
      return enabled[0]?.id || null
    })
  }

  useEffect(() => { loadPages() }, [])

  const handleTileClick = (tile: Tile) => {
    setSelectedTile(tile)
  }

  const handleTileAction = (tile: Tile) => {
    setSelectedTileForAction(tile)
    
    switch (tile.actionType) {
      case 'external_link':
        // Open in a new tab — most external sites refuse iframe embedding via
        // X-Frame-Options/CSP frame-ancestors, so the in-app modal would just
        // show a "refused to connect" page.
        if (tile.actionUrl) {
          window.open(tile.actionUrl, '_blank', 'noopener,noreferrer')
        }
        break
      case 'popup':
        setIsPopupModalOpen(true)
        break
      case 'video':
        setIsVideoModalOpen(true)
        break
      case 'image':
        setIsImageModalOpen(true)
        break
      case 'pdf':
        setIsPDFModalOpen(true)
        break
      case 'demo':
        if (tile.demoScenarioId) {
          setActiveDemoScenario(tile.demoScenarioId)
          setIsDemoMode(true)
        }
        break
    }
  }

  const handleDemoSelection = (demoId: string) => {
    setActiveDemoScenario(demoId)
  }

  const closeModals = () => {
    setIsVideoModalOpen(false)
    setIsPDFModalOpen(false)
    setIsImageModalOpen(false)
    setIsPopupModalOpen(false)
    setSelectedTileForAction(null)
  }

  const getActionIcon = (actionType: string) => {
    switch (actionType) {
      case 'external_link':
        return <ExternalLink className="w-4 h-4" />
      case 'video':
        return <Video className="w-4 h-4" />
      case 'pdf':
        return <FileText className="w-4 h-4" />
      case 'image':
        return <ImageIcon className="w-4 h-4" />
      case 'popup':
        return <MessageSquare className="w-4 h-4" />
      case 'demo':
        return <Play className="w-4 h-4" />
      default:
        return null
    }
  }

  if (isDemoMode) {
    const renderDemoContent = () => {
      switch (activeDemoScenario) {
        case 'polarization':
        case 'blue-light':
        case 'anti-reflective':
        case 'night-driving':
        case 'photochromic':
        case 'water-reflection':
          return <LensDemo initialScenario={activeDemoScenario} />
        case 'ar-simulator':
          return <ARLensSimulator />
        case 'virtual-tryon':
          return <VirtualTryOn />
        case 'vision-conditions':
          return <VisionConditionSimulator />
        case 'video-tours':
          return <InteractiveVideoTours />
        case 'lifestyle-gallery':
          return <LifestyleImageGallery />
        case 'guided-shopping':
          return <GuidedShopping />
        case 'facial-measurements':
          return <FacialMeasurementDemo />
        case 'frame-scanner':
          return <FrameScannerDemo />
        case 'lens-materials':
          return <LensMaterialComparison initialRx={patientContext?.rx} />
        case 'demo-gallery':
          return <DemoGallery onSelectDemo={handleDemoSelection} />
        default:
          return <DemoGallery onSelectDemo={handleDemoSelection} />
      }
    }

    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-slate-900 text-white py-3 px-6 flex justify-between items-center">
          <h1 className="text-xl font-semibold">Interactive Experience Center</h1>
          {!isStandalone && (
            <div className="flex gap-3">
              {activeDemoScenario && activeDemoScenario !== 'demo-gallery' && (
                <button
                  onClick={() => setActiveDemoScenario('demo-gallery')}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded transition-colors"
                >
                  View All Demos
                </button>
              )}
              <button
                onClick={() => {
                  setIsDemoMode(false)
                  setActiveDemoScenario(null)
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded transition-colors"
              >
                Back to Shopping
              </button>
            </div>
          )}
        </div>
        {renderDemoContent()}
      </div>
    )
  }

  if (isAdminMode) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-slate-900 text-white py-3 px-6 flex justify-between items-center">
          <h1 className="text-xl font-semibold">Admin Mode</h1>
          <button
            onClick={() => {
              setIsAdminMode(false)
              loadTiles()
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded transition-colors"
          >
            Back to User View
          </button>
        </div>
        <Admin />
      </div>
    )
  }

  const displayTiles = tiles.slice(0, 18)
  const tilesPerRow = 3
  const rows: Tile[][] = []
  for (let i = 0; i < displayTiles.length; i += tilesPerRow) {
    rows.push(displayTiles.slice(i, i + tilesPerRow))
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-slate-900 text-white py-3">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between mb-4">
            <Menu className="w-6 h-6" />
            <h1 className="text-xl font-semibold flex-1 text-center">A Visionary Approach to Your Eye Health</h1>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setActiveDemoScenario('demo-gallery')
                  setIsDemoMode(true)
                }}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded transition-colors text-sm"
                title="Interactive Demo"
              >
                <Lightbulb className="w-4 h-4" />
                <span>See Treatments</span>
              </button>
              <button
                onClick={() => setIsAdminMode(true)}
                className="text-white hover:text-blue-300 transition-colors"
                title="Admin Settings"
              >
                <Settings className="w-6 h-6" />
              </button>
            </div>
          </div>
          
          {/* Progress Steps — driven by pageService config */}
          {pages.length > 0 && (
            <div className="flex items-center justify-center">
              <div className="flex items-center gap-8">
                {pages.map((page, idx) => {
                  const currentIdx = pages.findIndex(p => p.id === currentPageId)
                  const isCurrent = page.id === currentPageId
                  const isDone = currentIdx > idx
                  return (
                    <div key={page.id} className="flex items-center gap-8">
                      <button
                        type="button"
                        onClick={() => setCurrentPageId(page.id)}
                        className="flex flex-col items-center group"
                        title={page.label}
                      >
                        <div className={`w-4 h-4 rounded-full mb-1 flex items-center justify-center ${
                          isCurrent ? 'bg-white' : isDone ? 'bg-blue-500' : 'border-2 border-white'
                        }`}>
                          {isDone && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className={`text-xs ${isCurrent ? 'font-semibold' : ''}`}>{page.label}</span>
                      </button>
                      {idx < pages.length - 1 && (
                        <div className={`w-24 h-0.5 -mt-6 ${isDone ? 'bg-blue-500' : 'bg-gray-600'}`} />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Patient Info Bar */}
      <div className="bg-gray-200 py-3 border-b border-gray-300">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-blue-700 text-white p-2 rounded">
                <User className="w-5 h-5" />
              </div>
              <div>
                <span className="font-semibold text-lg">{patientContext?.patientName || 'David Walker'}</span>
                {!patientContext && <span className="text-gray-600 ml-2">(57)</span>}
              </div>
            </div>
            
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-700" />
                <span className="text-sm font-medium">Insurance</span>
              </div>
              <div className="flex items-center gap-2">
                <Tag className="w-5 h-5 text-blue-700" />
                <span className="text-sm font-medium">Promotion</span>
              </div>
              <div className="flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-blue-700" />
                <span className="text-sm font-medium">Occupation</span>
              </div>
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-blue-700" />
                <span className="text-sm font-medium">Lifestyle</span>
              </div>
              <div className="flex items-center gap-2">
                <Eye className="w-5 h-5 text-blue-700" />
                <span className="text-sm font-medium">Reason for visit</span>
              </div>
            </div>
          </div>
          
          <div className="flex gap-3 mt-2">
            <button className="bg-white border border-gray-300 px-3 py-1 rounded text-sm">
              VISION SERVICE
            </button>
            <button className="bg-white border border-gray-300 px-3 py-1 rounded text-sm">
              Promotion Applied
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        {/* Render the registry component for the active page (anything other than the
            inline Light Filters content). Light Filters is rendered by the original card
            below since it owns Rx + Doctor's Recommendations + the dynamic Tile rows. */}
        {(() => {
          const current = pages.find(p => p.id === currentPageId)
          if (!current || current.componentKey === 'light-filters') return null
          const Comp = PAGE_COMPONENT_MAP[current.componentKey]?.component
          if (!Comp) {
            return (
              <div className="bg-yellow-50 border border-yellow-300 rounded p-4 mb-6 text-sm text-yellow-900">
                The "{current.label}" page is configured to render an unknown component
                ("{current.componentKey}"). Edit it in Admin → Pages.
              </div>
            )
          }
          return <div className="mb-6"><Comp pageId={current.id} /></div>
        })()}

        {pages.find(p => p.id === currentPageId)?.componentKey === 'light-filters' && (
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex justify-between items-start mb-6">
            {/* Prescription */}
            <div className="flex gap-8">
              <div className="flex items-start gap-3">
                <div className="bg-blue-700 text-white p-2 rounded">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                </div>
                <div>
                  <div className="font-semibold mb-2">Edit</div>
                  <div className="text-sm">
                    <div className="grid grid-cols-5 gap-4">
                      <div></div>
                      <div className="font-semibold">Sphere</div>
                      <div className="font-semibold">Cylinder</div>
                      <div className="font-semibold">Axis</div>
                      <div className="font-semibold">Add</div>
                      
                      <div className="font-semibold">Right</div>
                      <div>{patientContext?.rx?.odSphere || '-1.75'}</div>
                      <div>{patientContext?.rx?.odCylinder || '--'}</div>
                      <div>{patientContext?.rx?.odAxis || '--'}</div>
                      <div>{patientContext?.rx?.add || '--'}</div>

                      <div className="font-semibold">Left</div>
                      <div>{patientContext?.rx?.osSphere || '-1.75'}</div>
                      <div>{patientContext?.rx?.osCylinder || '--'}</div>
                      <div>{patientContext?.rx?.osAxis || '--'}</div>
                      <div>{patientContext?.rx?.add || '--'}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Doctor's Recommendations */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-w-md">
              <div className="flex items-start gap-3">
                <ClipboardList className="w-5 h-5 mt-1" />
                <div>
                  <div className="font-semibold mb-1">Dr's Recommendations</div>
                  <div className="text-sm text-gray-700">Need Unity Via and AR Coating</div>
                </div>
              </div>
            </div>
          </div>

          {/* Light Filtering Options */}
          <div className="mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-semibold text-center flex-1">Light Filtering Options</h2>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Single page view</span>
                <button
                  onClick={() => setSinglePageView(!singlePageView)}
                  className={`w-12 h-6 rounded-full transition-colors ${singlePageView ? 'bg-blue-600' : 'bg-gray-300'}`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full transform transition-transform ${singlePageView ? 'translate-x-6' : 'translate-x-0.5'}`}></div>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-semibold mb-2">Solution</label>
                <select
                  value={selectedSolution}
                  onChange={(e) => setSelectedSolution(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                >
                  <option>Poly SV & Premium Digital Prog.</option>
                  <option>High Index</option>
                  <option>Polycarbonate</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">Package</label>
                <select
                  value={selectedPackage}
                  onChange={(e) => setSelectedPackage(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                >
                  <option>Standard Single Vision</option>
                  <option>Premium Single Vision</option>
                  <option>Basic Single Vision</option>
                </select>
              </div>
            </div>

            {/* Info Banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 16v-4m0-4h.01" />
              </svg>
              <p className="text-sm text-gray-700">
                Prices shown below are estimates only. Prices with insurance discounts may be less. See actual prices at checkout.
              </p>
            </div>

            {/* Pricing Cards - Dynamic Tiles */}
            <div className="space-y-4">
              {rows.map((row, rowIndex) => (
                <div key={rowIndex} className="grid grid-cols-3 gap-4">
                  {row.map((tile) => (
                    <div
                      key={tile.id}
                      className={`${tile.bgColor} rounded-lg overflow-hidden transition-all relative ${selectedTile?.id === tile.id ? 'ring-4 ring-blue-600 shadow-xl' : ''}`}
                    >
                      <button
                        onClick={() => handleTileClick(tile)}
                        className="w-full text-left transition-transform hover:scale-[1.02]"
                      >
                        <div className="p-4 border-b-2 border-blue-300">
                          <h3 className="text-lg font-semibold text-center">{tile.title}</h3>
                        </div>
                        <div className="bg-white p-6">
                          <p className="text-sm text-center text-gray-700 mb-8">{tile.description}</p>
                          <div className="text-center">
                            <div className="text-sm text-gray-600 mb-1">You Pay</div>
                            <div className="text-4xl font-bold">
                              <span className="text-2xl align-top">$</span>
                              {tile.price}
                            </div>
                          </div>
                        </div>
                      </button>
                      
                      {selectedTile?.id === tile.id && tile.actionType !== 'none' && (
                        <div className="bg-blue-50 border-t border-blue-200 p-4">
                          <button
                            onClick={() => handleTileAction(tile)}
                            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-700 text-white rounded-lg hover:bg-blue-800 transition-colors font-semibold"
                          >
                            {getActionIcon(tile.actionType)}
                            <span>
                              {tile.actionType === 'external_link' ? 'Visit Link' : 
                               tile.actionType === 'video' ? 'Watch Video' : 
                               tile.actionType === 'pdf' ? 'View PDF' : 
                               tile.actionType === 'image' ? 'View Image' : 
                               tile.actionType === 'demo' ? 'Try Interactive Demo' : 
                               'See Details'}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            
            {tiles.length === 0 && (
              <div className="text-center py-12 bg-gray-50 rounded-lg">
                <p className="text-gray-500 mb-4">No tiles configured yet.</p>
                <button
                  onClick={() => setIsAdminMode(true)}
                  className="px-4 py-2 bg-blue-700 text-white rounded hover:bg-blue-800"
                >
                  Configure Tiles in Admin
                </button>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-between items-center pt-6 border-t border-gray-200">
            <div className="flex gap-3">
              <button className="px-6 py-2 border border-gray-300 rounded hover:bg-gray-50">
                Back
              </button>
              <button className="px-6 py-2 border border-gray-300 rounded hover:bg-gray-50">
                Cancel
              </button>
            </div>
            <div className="flex gap-3">
              <button className="px-6 py-2 bg-blue-700 text-white rounded hover:bg-blue-800">
                Continue
              </button>
              <button className="px-6 py-2 bg-blue-400 text-white rounded hover:bg-blue-500">
                Complete Order
              </button>
            </div>
          </div>
        </div>
        )}

        {/* Page Navigation — works for every page in the stepper */}
        {pages.length > 1 && (() => {
          const currentIdx = pages.findIndex(p => p.id === currentPageId)
          const prev = currentIdx > 0 ? pages[currentIdx - 1] : null
          const next = currentIdx < pages.length - 1 ? pages[currentIdx + 1] : null
          return (
            <div className="flex justify-between items-center mb-6">
              <button
                type="button"
                disabled={!prev}
                onClick={() => prev && setCurrentPageId(prev.id)}
                className="px-6 py-2 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
              >
                Back{prev ? ` to ${prev.label}` : ''}
              </button>
              <button
                type="button"
                disabled={!next}
                onClick={() => next && setCurrentPageId(next.id)}
                className="px-6 py-2 bg-blue-700 text-white rounded hover:bg-blue-800 disabled:opacity-40"
              >
                {next ? `Continue to ${next.label}` : 'Complete Order'}
              </button>
            </div>
          )
        })()}

        {/* Order Summary */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="grid grid-cols-2 gap-8">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold mb-2">Exam:</h3>
                <p className="text-sm text-gray-600">--</p>
              </div>
              <div>
                <h3 className="font-semibold mb-2">Lens:</h3>
                <p className="text-sm text-gray-700">Lens Type: Single Vision - $170</p>
                <p className="text-sm text-gray-700">Material: Polycarbonate - $50</p>
                <p className="text-sm text-gray-700">Style: Single Vision - $0</p>
                <p className="text-sm text-gray-700">Color: Clear - $0</p>
              </div>
              <div>
                <h3 className="font-semibold mb-2">Extras:</h3>
                <p className="text-sm text-gray-700">Elite Non-Glare - UVR - $145</p>
                <p className="text-sm text-gray-700">BackSide U V - $15</p>
              </div>
              <div>
                <h3 className="font-semibold mb-2">Frame:</h3>
                <p className="text-sm text-gray-600">--</p>
              </div>
            </div>
            
            <div className="flex justify-end">
              <div className="bg-slate-900 text-white px-12 py-8 rounded-lg text-center">
                <div className="text-sm mb-2">TOTAL</div>
                <div className="text-5xl font-bold">
                  <span className="text-3xl align-top">$</span>
                  380.00
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {selectedTileForAction && (
        <>
          {/* external_link is handled by window.open in handleTileAction —
              external sites refuse iframe embedding via X-Frame-Options/CSP. */}

          {selectedTileForAction.actionType === 'video' && selectedTileForAction.videoType && selectedTileForAction.videoId && (
            <VideoModal
              isOpen={isVideoModalOpen}
              onClose={closeModals}
              videoType={selectedTileForAction.videoType}
              videoId={selectedTileForAction.videoId}
              title={selectedTileForAction.title}
            />
          )}

          {selectedTileForAction.actionType === 'pdf' && selectedTileForAction.pdfUrl && (
            <PDFModal
              isOpen={isPDFModalOpen}
              onClose={closeModals}
              pdfUrl={selectedTileForAction.pdfUrl}
              title={selectedTileForAction.title}
            />
          )}

          {selectedTileForAction.actionType === 'image' && selectedTileForAction.imageUrl && (
            <ImageModal
              isOpen={isImageModalOpen}
              onClose={closeModals}
              imageUrl={selectedTileForAction.imageUrl}
              title={selectedTileForAction.title}
            />
          )}

          {selectedTileForAction.actionType === 'popup' && (
            <Modal
              isOpen={isPopupModalOpen}
              onClose={closeModals}
              title={selectedTileForAction.title}
              size="md"
            >
              <div className="p-6">
                <div className="text-gray-700 whitespace-pre-wrap">
                  {selectedTileForAction.actionUrl || 'No content available'}
                </div>
              </div>
            </Modal>
          )}
        </>
      )}
    </div>
  )
}

export default App
