import { useEffect, useMemo, useState } from 'react';
import { Eye, Scale, Ruler, Droplet, Award } from 'lucide-react';

// Refractive index, density (g/cm³), Abbe number, and a short copy line per material.
// Density values are widely-published averages from optical-lab data sheets.
interface Material {
  id: string;
  name: string;
  shortName: string;
  index: number;
  density: number;
  abbe: number;
  color: string;
  blurb: string;
}

const MATERIALS: Material[] = [
  {
    id: 'cr39',
    name: 'CR-39 Plastic',
    shortName: 'CR-39',
    index: 1.498,
    density: 1.32,
    abbe: 58,
    color: '#64748b',
    blurb: 'Best optical clarity. Heavy and thick at high Rx.',
  },
  {
    id: 'trivex',
    name: 'Trivex',
    shortName: 'Trivex',
    index: 1.53,
    density: 1.11,
    abbe: 45,
    color: '#0ea5e9',
    blurb: 'Lightest material. Impact-resistant. Great for kids & rimless.',
  },
  {
    id: 'poly',
    name: 'Polycarbonate',
    shortName: 'Poly',
    index: 1.586,
    density: 1.20,
    abbe: 30,
    color: '#10b981',
    blurb: 'Impact-resistant, light. Mild chromatic aberration.',
  },
  {
    id: 'hi160',
    name: 'High-Index 1.60',
    shortName: '1.60',
    index: 1.60,
    density: 1.30,
    abbe: 36,
    color: '#f59e0b',
    blurb: 'Thinner than poly. Good middle-ground for moderate Rx.',
  },
  {
    id: 'hi167',
    name: 'High-Index 1.67',
    shortName: '1.67',
    index: 1.67,
    density: 1.36,
    abbe: 32,
    color: '#f97316',
    blurb: 'Recommended above ~±4.00 D for slimmer profile.',
  },
  {
    id: 'hi174',
    name: 'High-Index 1.74',
    shortName: '1.74',
    index: 1.74,
    density: 1.46,
    abbe: 33,
    color: '#ef4444',
    blurb: 'Thinnest available. Best for strong Rx (±6.00 D and up).',
  },
];

interface RxEye {
  sphere: number;
  cylinder: number;
}

// Strongest meridian power (drives edge/center thickness).
function maxAbsPower(eye: RxEye): number {
  const sph = eye.sphere;
  const other = eye.sphere + eye.cylinder;
  return Math.max(Math.abs(sph), Math.abs(other));
}

// Sag (mm) for a single refracting surface.
//   s = h² · |D| / (2000 · (n - 1))
// h in mm, D in diopters → s in mm.
function sag(power: number, semiDiameterMm: number, n: number): number {
  if (Math.abs(power) < 0.01) return 0;
  return (semiDiameterMm * semiDiameterMm * Math.abs(power)) / (2000 * (n - 1));
}

interface LensCalc {
  edgeThicknessMm: number;
  centerThicknessMm: number;
  weightGrams: number;
  isMinus: boolean;
}

function computeLens(
  power: number,
  material: Material,
  lensWidthMm: number,
  lensHeightMm: number,
): LensCalc {
  const semiDiameter = Math.max(lensWidthMm, lensHeightMm) / 2;
  const s = sag(power, semiDiameter, material.index);
  const isMinus = power < 0;

  // Industry minimums: minus lenses min 1.5 mm at center, plus lenses min 1.5 mm at edge.
  // High-index can run thinner centers but 1.5 mm is a safe display default.
  const minThickness = 1.5;
  const centerThicknessMm = isMinus ? minThickness : minThickness + s;
  const edgeThicknessMm = isMinus ? minThickness + s : minThickness;

  // Volume of an oval lens with linearly-varying thickness across the radius.
  // Average thickness for either curvature is roughly (t_center + t_edge) / 2 — fine
  // for relative comparison even though the true integral is closer to (t_e + t_c/2)/1.5.
  const areaCm2 = (Math.PI * (lensWidthMm / 2) * (lensHeightMm / 2)) / 100; // mm² → cm²
  const avgThicknessCm = (centerThicknessMm + edgeThicknessMm) / 2 / 10; // mm → cm
  const volumeCm3 = areaCm2 * avgThicknessCm;
  // Two lenses per pair.
  const weightGrams = volumeCm3 * material.density * 2;

  return { edgeThicknessMm, centerThicknessMm, weightGrams, isMinus };
}

// Parse Rx values from a query-string-derived object: numbers come in as strings ("-2.50").
function parseNum(s: string | undefined, fallback = 0): number {
  if (!s) return fallback;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

interface RxFromContext {
  odSphere?: string; odCylinder?: string;
  osSphere?: string; osCylinder?: string;
}

function loadRxFromSession(): RxFromContext {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl: RxFromContext = {
      odSphere: params.get('odSphere') || undefined,
      odCylinder: params.get('odCylinder') || undefined,
      osSphere: params.get('osSphere') || undefined,
      osCylinder: params.get('osCylinder') || undefined,
    };
    if (Object.values(fromUrl).some(Boolean)) return fromUrl;

    const stored = sessionStorage.getItem('timeline_patient_context');
    if (stored) {
      const ctx = JSON.parse(stored);
      if (ctx?.rx) return ctx.rx;
    }
  } catch { /* ignore */ }
  return {};
}

// SVG cross-section: draw the lens edge profile to scale so users can SEE the difference.
function LensProfile({ calc, color, scale }: { calc: LensCalc; color: string; scale: number }) {
  const { edgeThicknessMm, centerThicknessMm, isMinus } = calc;
  const w = 220;
  const h = 110;
  const lensRadiusPx = 80;
  const cx = w / 2;
  const cy = h / 2;
  const edgePx = edgeThicknessMm * scale;
  const centerPx = centerThicknessMm * scale;

  // Build a symmetric lens cross-section as a closed path.
  // Top curve: from (cx-r, cy-edgePx/2) bezier through (cx, cy-centerPx/2) to (cx+r, cy-edgePx/2).
  // Bottom curve mirrors it.
  const topY = cy - centerPx / 2;
  const edgeTopY = cy - edgePx / 2;
  const bottomY = cy + centerPx / 2;
  const edgeBottomY = cy + edgePx / 2;
  const left = cx - lensRadiusPx;
  const right = cx + lensRadiusPx;

  const path = isMinus
    ? // Minus: center is thinner. Curves bow inward toward middle.
      `M ${left} ${edgeTopY}
       Q ${cx} ${topY} ${right} ${edgeTopY}
       L ${right} ${edgeBottomY}
       Q ${cx} ${bottomY} ${left} ${edgeBottomY} Z`
    : // Plus: center is thicker. Curves bulge outward.
      `M ${left} ${edgeTopY}
       Q ${cx} ${topY} ${right} ${edgeTopY}
       L ${right} ${edgeBottomY}
       Q ${cx} ${bottomY} ${left} ${edgeBottomY} Z`;

  const labelMm = isMinus ? edgeThicknessMm : centerThicknessMm;
  const labelText = isMinus ? 'edge' : 'center';

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
      {/* baseline frame outline */}
      <line x1={left} y1={cy - 45} x2={left} y2={cy + 45} stroke="#cbd5e1" strokeDasharray="2 3" />
      <line x1={right} y1={cy - 45} x2={right} y2={cy + 45} stroke="#cbd5e1" strokeDasharray="2 3" />
      <path d={path} fill={color} fillOpacity="0.85" stroke={color} strokeWidth="1" />
      {/* thickness annotation */}
      <line
        x1={isMinus ? right + 4 : cx}
        y1={isMinus ? edgeTopY : topY}
        x2={isMinus ? right + 4 : cx}
        y2={isMinus ? edgeBottomY : bottomY}
        stroke="#1e293b"
        strokeWidth="1"
      />
      <text
        x={isMinus ? right + 8 : cx + 6}
        y={cy + 4}
        fontSize="11"
        fill="#1e293b"
        fontFamily="ui-sans-serif, system-ui"
      >
        {labelMm.toFixed(1)} mm {labelText}
      </text>
    </svg>
  );
}

interface Props {
  /** Optional initial Rx (overrides URL/session). */
  initialRx?: { odSphere?: string; odCylinder?: string; osSphere?: string; osCylinder?: string };
}

export default function LensMaterialComparison({ initialRx }: Props) {
  const seed = initialRx || loadRxFromSession();
  const [odSphere, setOdSphere] = useState<string>(seed.odSphere ?? '-3.00');
  const [odCylinder, setOdCylinder] = useState<string>(seed.odCylinder ?? '-0.75');
  const [osSphere, setOsSphere] = useState<string>(seed.osSphere ?? '-3.00');
  const [osCylinder, setOsCylinder] = useState<string>(seed.osCylinder ?? '-0.75');
  const [lensWidth, setLensWidth] = useState<number>(50); // mm — typical "A" measurement
  const [lensHeight, setLensHeight] = useState<number>(32); // mm — typical "B" measurement
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Refresh seed if it appears later (e.g., Timeline launch with rx populated post-mount).
  useEffect(() => {
    if (!initialRx && !seed.odSphere && !seed.osSphere) return;
  }, [initialRx, seed.odSphere, seed.osSphere]);

  const { drivingPower, results, scale } = useMemo(() => {
    const od: RxEye = { sphere: parseNum(odSphere), cylinder: parseNum(odCylinder) };
    const os: RxEye = { sphere: parseNum(osSphere), cylinder: parseNum(osCylinder) };
    // Drive the calc off the worst eye, signed so we know plus-vs-minus.
    const odMax = maxAbsPower(od);
    const osMax = maxAbsPower(os);
    const worst = odMax >= osMax ? od : os;
    const worstSigned = worst.sphere + (Math.abs(worst.cylinder) > 0 && Math.abs(worst.sphere + worst.cylinder) > Math.abs(worst.sphere) ? worst.cylinder : 0);

    const calcs = MATERIALS.map(m => ({
      material: m,
      calc: computeLens(worstSigned, m, lensWidth, lensHeight),
    }));

    // Scale all profiles against the thickest material so visual comparison is honest.
    const maxMm = Math.max(...calcs.map(c => Math.max(c.calc.edgeThicknessMm, c.calc.centerThicknessMm)));
    const profileScale = maxMm > 0 ? Math.min(40 / maxMm, 12) : 6; // px-per-mm

    return { drivingPower: worstSigned, results: calcs, scale: profileScale };
  }, [odSphere, odCylinder, osSphere, osCylinder, lensWidth, lensHeight]);

  const sortedByThickness = useMemo(
    () =>
      [...results].sort((a, b) => {
        const aT = a.calc.isMinus ? a.calc.edgeThicknessMm : a.calc.centerThicknessMm;
        const bT = b.calc.isMinus ? b.calc.edgeThicknessMm : b.calc.centerThicknessMm;
        return aT - bT;
      }),
    [results],
  );

  const recommended = useMemo(() => {
    const absP = Math.abs(drivingPower);
    if (absP < 1.5) return MATERIALS.find(m => m.id === 'cr39')!;
    if (absP < 3.0) return MATERIALS.find(m => m.id === 'poly')!;
    if (absP < 5.0) return MATERIALS.find(m => m.id === 'hi160')!;
    if (absP < 7.0) return MATERIALS.find(m => m.id === 'hi167')!;
    return MATERIALS.find(m => m.id === 'hi174')!;
  }, [drivingPower]);

  const maxBarMm = Math.max(
    ...results.map(r => (r.calc.isMinus ? r.calc.edgeThicknessMm : r.calc.centerThicknessMm)),
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 py-8">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Lens Material Comparison
          </h1>
          <p className="text-gray-600">
            See how thickness and weight change for your prescription across every material option.
          </p>
        </div>

        {/* Rx + Frame inputs */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Eye className="w-4 h-4" /> Prescription
              </h2>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div />
                <div className="font-semibold text-gray-700 text-center">Sphere</div>
                <div className="font-semibold text-gray-700 text-center">Cylinder</div>

                <div className="font-semibold self-center">Right (OD)</div>
                <input
                  type="number"
                  step="0.25"
                  value={odSphere}
                  onChange={e => setOdSphere(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-center"
                  aria-label="OD Sphere"
                />
                <input
                  type="number"
                  step="0.25"
                  value={odCylinder}
                  onChange={e => setOdCylinder(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-center"
                  aria-label="OD Cylinder"
                />

                <div className="font-semibold self-center">Left (OS)</div>
                <input
                  type="number"
                  step="0.25"
                  value={osSphere}
                  onChange={e => setOsSphere(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-center"
                  aria-label="OS Sphere"
                />
                <input
                  type="number"
                  step="0.25"
                  value={osCylinder}
                  onChange={e => setOsCylinder(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-center"
                  aria-label="OS Cylinder"
                />
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Ruler className="w-4 h-4" /> Frame Eye Size
              </h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <label className="block">
                  <span className="text-gray-600 text-xs">Width (A): {lensWidth} mm</span>
                  <input
                    type="range"
                    min={42}
                    max={62}
                    value={lensWidth}
                    onChange={e => setLensWidth(parseInt(e.target.value, 10))}
                    className="w-full"
                    aria-label="Lens width"
                  />
                </label>
                <label className="block">
                  <span className="text-gray-600 text-xs">Height (B): {lensHeight} mm</span>
                  <input
                    type="range"
                    min={24}
                    max={45}
                    value={lensHeight}
                    onChange={e => setLensHeight(parseInt(e.target.value, 10))}
                    className="w-full"
                    aria-label="Lens height"
                  />
                </label>
              </div>
              <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                <div className="flex items-center gap-2 text-blue-900">
                  <Award className="w-4 h-4" />
                  <span className="font-semibold">Driving power:</span>
                  <span>{drivingPower > 0 ? '+' : ''}{drivingPower.toFixed(2)} D</span>
                </div>
                <div className="text-xs text-blue-800 mt-1">
                  Recommended: <strong>{recommended.name}</strong> — {recommended.blurb}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bar comparison */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Scale className="w-4 h-4" /> Side-by-side thickness ({drivingPower < 0 ? 'edge' : 'center'})
          </h2>
          <div className="space-y-2">
            {sortedByThickness.map(({ material, calc }) => {
              const t = calc.isMinus ? calc.edgeThicknessMm : calc.centerThicknessMm;
              const pct = maxBarMm > 0 ? (t / maxBarMm) * 100 : 0;
              return (
                <button
                  key={material.id}
                  onClick={() => setHighlightedId(highlightedId === material.id ? null : material.id)}
                  className={`w-full text-left grid grid-cols-[110px_1fr_120px] gap-3 items-center hover:bg-gray-50 rounded p-1 transition ${
                    highlightedId === material.id ? 'bg-blue-50 ring-1 ring-blue-300' : ''
                  }`}
                >
                  <div className="text-sm font-medium text-gray-800">{material.shortName}</div>
                  <div className="bg-gray-100 rounded h-7 overflow-hidden relative">
                    <div
                      className="h-full rounded transition-all"
                      style={{ width: `${pct}%`, backgroundColor: material.color }}
                    />
                  </div>
                  <div className="text-sm text-gray-700 text-right">
                    <span className="font-semibold">{t.toFixed(2)} mm</span>
                    <span className="text-gray-500 ml-2">{calc.weightGrams.toFixed(1)} g</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Material cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {results.map(({ material, calc }) => {
            const isRecommended = material.id === recommended.id;
            return (
              <div
                key={material.id}
                className={`bg-white rounded-xl shadow-sm border-2 overflow-hidden transition-all ${
                  isRecommended ? 'border-blue-500 shadow-lg' : 'border-gray-200'
                }`}
              >
                <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{material.name}</h3>
                    <div className="text-xs text-gray-500">
                      n = {material.index.toFixed(3)} · Abbe {material.abbe} · {material.density.toFixed(2)} g/cm³
                    </div>
                  </div>
                  {isRecommended && (
                    <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full font-semibold">
                      Best fit
                    </span>
                  )}
                </div>

                <div className="bg-gray-50 px-4 py-3">
                  <LensProfile calc={calc} color={material.color} scale={scale} />
                </div>

                <div className="p-4 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <Ruler className="w-3 h-3" /> {calc.isMinus ? 'Edge' : 'Center'} thickness
                    </div>
                    <div className="text-xl font-bold text-gray-900">
                      {(calc.isMinus ? calc.edgeThicknessMm : calc.centerThicknessMm).toFixed(2)} mm
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <Droplet className="w-3 h-3" /> Pair weight
                    </div>
                    <div className="text-xl font-bold text-gray-900">
                      {calc.weightGrams.toFixed(1)} g
                    </div>
                  </div>
                </div>

                <div className="px-4 pb-4 text-xs text-gray-600 leading-relaxed">
                  {material.blurb}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 text-xs text-gray-500 text-center">
          Estimates use the standard sag formula and published density values.
          Actual finished lenses vary with frame shape, decentration, base curve, and lab minimums.
        </div>
      </div>
    </div>
  );
}
