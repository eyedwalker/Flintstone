/**
 * Guided Shopping — "3 Complete Pairs".
 *
 * Instead of a step-by-step wizard, the patient immediately sees three finished
 * recommendations (Primary / Computer / Sunglass) built from their favorite
 * frames + context, with insurance applied to its best use and one promotion
 * per pair. Selectors under each pair change frame/package; benefits can be
 * moved; pairs can be added/removed from the cart or saved for later; checkout
 * produces the invoice (office: complete sale / text a purchase link; portal:
 * pay now with pickup-or-ship).
 *
 * Patient context arrives via URL params from timeline-prc
 * (PatientJourneyDetails "Guided Shopping" button): patientId, patientName,
 * legacyPatientId, companyId, officeId, reasonForVisit, retailApiBase,
 * returnUrl, and the active Rx (odSphere…add, pd). A saved cart re-opens via
 * ?savedCart=<token> (token minted by timeline-prc at checkout).
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  UseCase, Favorite, LensPackage, Promotion, PatientContext, Pair,
  pickFrame, pickPackage, allocate, AllocationPlan,
} from './lib/recommend';

/* ── Catalog (estimate data — swap for live retail packages later) ─────────── */
const FAVORITES: Favorite[] = [
  { id: 'f1', name: 'Ray-Ban Classic', brand: 'Ray-Ban', retailPrice: 180, tags: ['metal', 'light'] },
  { id: 'f2', name: 'Oakley Sport Wrap', brand: 'Oakley', retailPrice: 220, tags: ['wrap', 'sport', 'large'] },
  { id: 'f3', name: 'Bold Acetate', brand: 'Gucci', retailPrice: 260, tags: ['plastic', 'large'] },
  { id: 'f4', name: 'Titanium Rimless', brand: 'Silhouette', retailPrice: 240, tags: ['rimless', 'light', 'metal'] },
];
const PACKAGES: LensPackage[] = [
  { id: 'p-prog', name: 'Premium Digital Progressive + AR', kind: 'progressive', retailPrice: 320, fits: ['primary'] },
  { id: 'p-prog2', name: 'Standard Progressive', kind: 'progressive', retailPrice: 210, fits: ['primary'] },
  { id: 'p-sv', name: 'Single Vision + AR', kind: 'single-vision', retailPrice: 120, fits: ['primary'] },
  { id: 'p-blue', name: 'Blue-Light Office Lens', kind: 'blue-light', retailPrice: 180, fits: ['computer'] },
  { id: 'p-blue2', name: 'Computer Progressive + AR', kind: 'computer', retailPrice: 250, fits: ['computer'] },
  { id: 'p-sun', name: 'Polarized Sun Tint', kind: 'sun', retailPrice: 200, fits: ['sunglass'] },
  { id: 'p-sun2', name: 'Gradient Sun Tint', kind: 'sun', retailPrice: 150, fits: ['sunglass'] },
];
const PROMOS: Promotion[] = [
  { id: 'sp50', name: 'Second pair 50% off (with insurance)', kind: 'second-pair', value: 0.5, expiresDays: 30 },
  { id: 'bogo', name: 'BOGO 50% (cash pay)', kind: 'bogo', value: 0.5, expiresDays: 30 },
  { id: 'sun30', name: 'Sunwear $30 off', kind: 'amount', value: 30, appliesTo: ['sunglass'] },
];
const USE: UseCase[] = ['primary', 'computer', 'sunglass'];
const LBL: Record<UseCase, string> = { primary: 'Primary', computer: 'Computer', sunglass: 'Sunglass' };
const SUB: Record<UseCase, string> = { primary: 'Everyday all-purpose', computer: 'Screens & office', sunglass: 'Outdoors & driving' };
const USECLR: Record<UseCase, string> = { primary: 'var(--brand)', computer: '#7C3AED', sunglass: '#0EA5E9' };
const SHIP_FEE = 9.95;
const money = (n: number) => '$' + Math.round(n).toLocaleString();

/* ── Patient context from URL ──────────────────────────────────────────────── */
function readUrlContext() {
  const q = new URLSearchParams(window.location.search);
  const add = parseFloat(q.get('add') || '') || 0;
  const prcBase = (q.get('retailApiBase') || '').replace(/\/api\/retail\/?$/, '');
  return {
    patientId: q.get('patientId') || '',
    legacyPatientId: q.get('legacyPatientId') || '',
    patientName: q.get('patientName') || 'Guest',
    companyId: q.get('companyId') || '',
    officeId: q.get('officeId') || '',
    reasonForVisit: q.get('reasonForVisit') || '',
    rx: {
      od: { sphere: q.get('odSphere') || '', cylinder: q.get('odCylinder') || '', axis: q.get('odAxis') || '' },
      os: { sphere: q.get('osSphere') || '', cylinder: q.get('osCylinder') || '', axis: q.get('osAxis') || '' },
      add, pd: q.get('pd') || '',
    },
    providerName: q.get('providerName') || '',
    prcBase,
    savedCartToken: q.get('savedCart') || '',
    returnUrl: q.get('returnUrl') || '',
  };
}

const Glasses: React.FC<{ useCase: UseCase }> = ({ useCase }) => {
  const lens = useCase === 'sunglass' ? '#1E293B' : useCase === 'computer' ? '#C7D2FE' : '#E0F2FE';
  const op = useCase === 'sunglass' ? 0.9 : 0.55;
  return (
    <svg className="glass" viewBox="0 0 120 70" fill="none" aria-hidden="true">
      <rect x="8" y="20" width="44" height="34" rx="12" fill={lens} fillOpacity={op} stroke="var(--ink)" strokeWidth="2.4" />
      <rect x="68" y="20" width="44" height="34" rx="12" fill={lens} fillOpacity={op} stroke="var(--ink)" strokeWidth="2.4" />
      <path d="M52 34c3-3 13-3 16 0" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M8 30L2 24M112 30l6-6" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
};

export default function App() {
  const url = useMemo(readUrlContext, []);
  const [mode, setMode] = useState<'office' | 'portal'>(url.savedCartToken ? 'portal' : 'office');
  const [view, setView] = useState<'cards' | 'hero' | 'stacked'>('cards');
  const [page, setPage] = useState<'shop' | 'invoice'>('shop');
  const [overrides, setOverrides] = useState<Record<string, { frameId?: string; pkgId?: string }>>({});
  const [inCart, setInCart] = useState<Set<UseCase>>(new Set(USE));
  const [savedLater, setSavedLater] = useState<Set<UseCase>>(new Set());
  const [plan, setPlan] = useState<AllocationPlan>({ insuranceOn: 'auto', promoOn: { sp50: 'auto', bogo: 'auto', sun30: 'auto' } });
  const [fulfill, setFulfill] = useState<'pickup' | 'ship'>('pickup');
  const [textOpen, setTextOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [anchor, setAnchor] = useState<{ at: string; hadInsurance: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const ctx: PatientContext = useMemo(() => ({
    rx: { rightAdd: url.rx.add, leftAdd: url.rx.add },
    occupation: '', lifestyle: '', reasonForVisit: url.reasonForVisit,
    drRecommendation: '',
    insurance: anchor ? null : { planName: 'VSP', frameAllowance: 150, lensCopay: 25, coveredLensKinds: ['progressive', 'single'] },
    promotions: PROMOS,
    anchorPurchaseAt: anchor?.at ?? null,
    anchorHadInsurance: anchor?.hadInsurance,
  }), [url, anchor]);

  /* Saved-cart open: load the persisted pairs + anchor from timeline-prc. */
  useEffect(() => {
    if (!url.savedCartToken || !url.prcBase) return;
    fetch(`${url.prcBase}/api/guided-shopping/saved-cart?token=${encodeURIComponent(url.savedCartToken)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d?.success || !d.cart) return;
        const c = d.cart;
        setAnchor({ at: c.anchor_purchase_at, hadInsurance: !!c.anchor_had_insurance });
        const ov: Record<string, { frameId?: string; pkgId?: string }> = {};
        const cartSet = new Set<UseCase>();
        (c.pairs || []).forEach((p: any) => { ov[p.useCase] = { frameId: p.frameId, pkgId: p.pkgId }; cartSet.add(p.useCase); });
        setOverrides(ov); setInCart(cartSet); setSavedLater(new Set());
        setToastMsg('Welcome back — your saved pair is ready to order.');
      })
      .catch(() => {});
  }, [url]);

  useEffect(() => { if (!toastMsg) return; const t = setTimeout(() => setToastMsg(''), 3400); return () => clearTimeout(t); }, [toastMsg]);

  /* Build pairs, honor overrides, price the CART. */
  const rec = useMemo(() => {
    const all: Pair[] = USE.map((u) => {
      const o = overrides[u] || {};
      return {
        useCase: u, label: LBL[u],
        frame: FAVORITES.find((f) => f.id === o.frameId) || pickFrame(FAVORITES, u, ctx)!,
        pkg: PACKAGES.find((k) => k.id === o.pkgId) || pickPackage(PACKAGES, u, ctx)!,
        pricing: { retail: 0, insurance: 0, promo: 0, youPay: 0, notes: [] },
      };
    });
    const cartPairs = all.filter((p) => inCart.has(p.useCase));
    allocate(cartPairs, ctx, plan);
    all.filter((p) => !inCart.has(p.useCase)).forEach((p) => {
      const retail = Math.round((p.frame.retailPrice + p.pkg.retailPrice) * 100) / 100;
      p.pricing = { retail, insurance: 0, promo: 0, youPay: retail, notes: [] };
    });
    const retail = cartPairs.reduce((s, p) => s + p.pricing.retail, 0);
    const youPay = cartPairs.reduce((s, p) => s + p.pricing.youPay, 0);
    return { all, cartPairs, total: { retail, youPay, saved: retail - youPay } };
  }, [ctx, overrides, inCart, plan]);

  const due = rec.total.youPay + (mode === 'portal' && fulfill === 'ship' ? SHIP_FEE : 0);
  const usedInsurance = rec.cartPairs.some((p) => p.pricing.insurance > 0);

  /* ── Checkout actions (best-effort against timeline-prc; UI never blocks) ── */
  async function postJson(path: string, body: unknown) {
    if (!url.prcBase) return null;
    try {
      const r = await fetch(`${url.prcBase}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return await r.json().catch(() => null);
    } catch { return null; }
  }
  const pairConfig = (u: UseCase) => {
    const p = rec.all.find((x) => x.useCase === u)!;
    return { useCase: u, frameId: p.frame.id, pkgId: p.pkg.id };
  };
  function orderPayload() {
    return {
      patientId: url.patientId || url.legacyPatientId, companyId: url.companyId, officeId: url.officeId,
      patientName: url.patientName,
      items: rec.cartPairs.map((p) => ({
        id: `${p.useCase}`, name: `${p.label}: ${p.frame.name} + ${p.pkg.name}`,
        description: p.pricing.notes.join('; '), price: p.pricing.youPay, category: p.useCase,
      })),
      totals: { retail: rec.total.retail, savings: rec.total.saved, due },
      usedInsurance,
      fulfillment: mode === 'portal' ? fulfill : 'in-office',
    };
  }
  async function completeSale(kind: 'office' | 'portal') {
    setBusy(true);
    await postJson('/api/guided-shopping/order-complete', orderPayload());
    // Saved-for-later pairs persist server-side and are texted to the patient
    // (anchored to THIS purchase, so the second-pair window starts now).
    if (savedLater.size) {
      await postJson('/api/guided-shopping/saved-cart', {
        ...orderPayload(),
        pairs: [...savedLater].map(pairConfig),
        anchorPurchaseAt: new Date().toISOString(),
        anchorHadInsurance: usedInsurance,
        phone, sendSms: !!phone.trim(),
      });
    }
    setBusy(false);
    setToastMsg(kind === 'office'
      ? `Sale completed${savedLater.size ? ' — saved pair link ready to text' : ''}`
      : fulfill === 'ship' ? 'Payment collected — shipping with tracking' : "Payment collected — we'll text you for pickup");
  }
  /* "Text purchase link instead" — no sale yet: the WHOLE cart (plus saved
     pairs) travels; benefits stay live because nothing anchored yet. */
  async function sendTextLink() {
    setBusy(true);
    const d = await postJson('/api/guided-shopping/saved-cart', {
      ...orderPayload(),
      pairs: [...new Set([...inCart, ...savedLater])].map(pairConfig),
      anchorPurchaseAt: null, anchorHadInsurance: false,
      phone, sendSms: true,
    });
    setBusy(false); setTextOpen(false);
    setToastMsg(d?.success ? `Purchase link texted to ${phone}` : 'Could not send — check the phone number');
  }

  /* ── UI pieces ── */
  const pairOpts = () => (
    <>
      <option value="auto">Auto (best use)</option>
      {USE.map((u) => <option key={u} value={u}>{LBL[u]} pair</option>)}
      <option value="none">Not used</option>
    </>
  );
  const benefitVal = (v: UseCase | 'auto' | null | undefined) => (v === null ? 'none' : v || 'auto');
  const parseBenefit = (v: string): UseCase | 'auto' | null => (v === 'none' ? null : (v as UseCase | 'auto'));

  const card = (p: Pair) => {
    const inP = inCart.has(p.useCase);
    const saved = savedLater.has(p.useCase);
    const isHero = view === 'hero' && p.useCase === 'primary';
    const head = (
      <div className="usehead"><span className="usebadge">{p.label}</span><span className="sub">{SUB[p.useCase]}</span></div>
    );
    const glassCol = (
      <div className="glass-wrap"><Glasses useCase={p.useCase} />
        <div><div className="fr-name">{p.frame.name}</div><div className="fr-brand">{p.frame.brand}</div>
          <div className="pkg-name">◆ {p.pkg.name}</div></div>
      </div>
    );
    const sels = (
      <div className="selectors">
        <div className="sel"><label>Frame (favorites)</label>
          <select value={p.frame.id} onChange={(e) => setOverrides((o) => ({ ...o, [p.useCase]: { ...o[p.useCase], frameId: e.target.value } }))}>
            {FAVORITES.map((f) => <option key={f.id} value={f.id}>{f.name} · ${f.retailPrice}</option>)}
          </select></div>
        <div className="sel"><label>Lens package</label>
          <select value={p.pkg.id} onChange={(e) => setOverrides((o) => ({ ...o, [p.useCase]: { ...o[p.useCase], pkgId: e.target.value } }))}>
            {PACKAGES.map((k) => <option key={k.id} value={k.id}>{k.name} · ${k.retailPrice}</option>)}
          </select></div>
      </div>
    );
    const actions = (
      <div className="pairactions">
        <button className="incl" aria-pressed={inP} onClick={() => {
          setInCart((s) => { const n = new Set(s); if (n.has(p.useCase)) n.delete(p.useCase); else { n.add(p.useCase); } return n; });
          setSavedLater((s) => { const n = new Set(s); n.delete(p.useCase); return n; });
        }}>{inP ? '✓ In cart' : '+ Add to cart'}</button>
        <button className="saveltr" aria-pressed={saved} onClick={() => {
          setSavedLater((s) => {
            const n = new Set(s);
            if (n.has(p.useCase)) n.delete(p.useCase);
            else { n.add(p.useCase); setInCart((c) => { const nc = new Set(c); nc.delete(p.useCase); return nc; }); setToastMsg(`${p.label} pair saved for later — it travels with the patient's link`); }
            return n;
          });
        }}>{saved ? '★ Saved' : '☆ Save for later'}</button>
      </div>
    );
    const priceB = (
      <div className="price">
        <div className="prow"><span className="k">Retail</span><span className="v num">{money(p.pricing.retail)}</span></div>
        {inP && p.pricing.insurance > 0 && <div className="prow ins"><span className="k">🛡 Insurance</span><span className="v num">− {money(p.pricing.insurance)}</span></div>}
        {inP && p.pricing.promo > 0 && <div className="prow promo"><span className="k">🏷 Promotion</span><span className="v num">− {money(p.pricing.promo)}</span></div>}
        <div className="youpay"><span className="k">{inP ? 'You pay' : 'If added'}</span><span className="v num">{money(p.pricing.youPay)}</span></div>
        {inP && p.pricing.notes.map((n, i) => <div className="note" key={i}>✓ {n}</div>)}
      </div>
    );
    return (
      <article key={p.useCase} className={`pair ${p.useCase}${inP ? '' : ' out'}`} style={{ ['--useclr' as any]: USECLR[p.useCase] }}>
        <div className="cap" />
        <div className="body">
          {isHero
            ? <>{head}<div className="lead-col">{glassCol}{sels}{actions}</div>{priceB}</>
            : view === 'stacked'
              ? <>{head}{glassCol}<div className="midcol">{sels}{actions}</div>{priceB}</>
              : <>{head}{glassCol}{sels}{priceB}{actions}</>}
        </div>
      </article>
    );
  };

  const n = rec.cartPairs.length;
  return (
    <>
      <header className="gs">
        <div className="hrow">
          <div className="brandmark">
            <div className="logo">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="7" cy="14" r="4.2" stroke="#fff" strokeWidth="1.8" /><circle cx="17" cy="14" r="4.2" stroke="#fff" strokeWidth="1.8" /><path d="M11.2 14a1 1 0 011.6 0M2.8 12l1.8-3.4a2 2 0 011.8-1.1M21.2 12l-1.8-3.4a2 2 0 00-1.8-1.1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </div>
            <div><h1>Your Complete Eyewear</h1><p>{mode === 'office' ? 'GUIDED SHOPPING · IN OFFICE' : 'PATIENT PORTAL · SHOP FROM HOME'}</p></div>
          </div>
          <div className="toggle" role="group" aria-label="Mode">
            <button aria-pressed={mode === 'office'} onClick={() => setMode('office')}>🏢 Office</button>
            <button aria-pressed={mode === 'portal'} onClick={() => setMode('portal')}>🏠 Patient portal</button>
          </div>
          <div className="toggle" role="group" aria-label="View">
            <button aria-pressed={view === 'cards'} onClick={() => setView('cards')}>▦</button>
            <button aria-pressed={view === 'hero'} onClick={() => setView('hero')}>◧</button>
            <button aria-pressed={view === 'stacked'} onClick={() => setView('stacked')}>☰</button>
          </div>
          <button className="cartbtn" onClick={() => setPage(page === 'shop' ? 'invoice' : 'shop')}>🛒 Cart <span className="n">{n}</span></button>
          <button className="theme" title="Toggle theme" onClick={() => {
            const cur = document.documentElement.getAttribute('data-theme');
            const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark' : (matchMedia('(prefers-color-scheme:dark)').matches ? 'light' : 'dark');
            document.documentElement.setAttribute('data-theme', next);
          }}>◐</button>
        </div>
        <div className="patientbar">
          <div className="pchip"><span className="who">{url.patientName}</span></div>
          {url.rx.od.sphere && <div className="pchip">Rx: {url.rx.od.sphere}{url.rx.add ? ` · Add +${url.rx.add}` : ''}</div>}
          <div className="ctx">
            <span>🛡 {ctx.insurance ? ctx.insurance.planName : anchor ? 'Benefit used' : 'No insurance'}</span>
            <span>🏷 {PROMOS.length} promos</span>
            {url.reasonForVisit && <span>👁 {url.reasonForVisit}</span>}
          </div>
        </div>
      </header>

      <main className="gs">
        {page === 'shop' && (
          <section>
            <div className="benefits">
              <span className="title">Apply benefits</span>
              {ctx.insurance && (
                <div className="brule ins"><span className="dot" />🛡 {ctx.insurance.planName} insurance
                  <select value={benefitVal(plan.insuranceOn)} onChange={(e) => setPlan((pl) => ({ ...pl, insuranceOn: parseBenefit(e.target.value) }))}>
                    {pairOpts()}
                  </select>
                </div>
              )}
              {PROMOS.map((pr) => (
                <div className="brule promo" key={pr.id}><span className="dot" />{pr.name}
                  <select value={benefitVal(plan.promoOn?.[pr.id])} onChange={(e) => setPlan((pl) => ({ ...pl, promoOn: { ...pl.promoOn, [pr.id]: parseBenefit(e.target.value) } }))}>
                    {pairOpts()}
                  </select>
                </div>
              ))}
              <span className="bhint">Auto puts each benefit where it saves the most. One discount per pair; the second-pair 50% needs insurance on another pair, the BOGO applies when paying without insurance. Second-pair offers stay good for 30 days after purchase.</span>
            </div>

            <div className="summary">
              <div className="lead">
                <h2>{n === 3 ? 'Three complete pairs, ready to go' : n ? `${n} pair${n > 1 ? 's' : ''} in your cart` : 'Pick the pairs you want'}</h2>
                <p>{mode === 'office'
                  ? 'Benefits recalculate for exactly what’s in the cart · move them with the selectors above'
                  : 'Shop from home — your favorites, insurance, and office promotions are already loaded'}</p>
              </div>
              <div className="savepill">▼ You save {money(rec.total.saved)}</div>
              <div className="bigmoney"><div className="lbl">Total you pay</div><div className="val num">{money(rec.total.youPay)}</div></div>
              <button className="checkout" disabled={n === 0} onClick={() => setPage('invoice')}>Checkout →</button>
            </div>

            <div className={`results ${view}`}>{rec.all.map(card)}</div>
          </section>
        )}

        {page === 'invoice' && (
          <section>
            <button className="backlink" onClick={() => setPage('shop')}>← Back to shopping</button>
            <div className="invoice">
              <div className="inv-head">
                <div className="t"><h2>Order Summary</h2><p>{url.patientName}{ctx.insurance ? ` · ${ctx.insurance.planName}` : ''}</p></div>
                <div className="m">Invoice <b>GS-{(url.patientId || 'draft').slice(0, 6).toUpperCase()}</b><br />
                  {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}<br />
                  {mode === 'office' ? 'In office' : 'Patient portal'}</div>
              </div>
              <div className="inv-body">
                {rec.cartPairs.map((p) => (
                  <div className="inv-pair" key={p.useCase}>
                    <div className="r1"><span>{p.label} pair — {p.frame.name}</span><span className="num">{money(p.pricing.youPay)}</span></div>
                    <div className="r2"><span>{p.frame.brand} frame</span><span className="num">{money(p.frame.retailPrice)}</span></div>
                    <div className="r2"><span>{p.pkg.name}</span><span className="num">{money(p.pkg.retailPrice)}</span></div>
                    {p.pricing.insurance > 0 && <div className="adj ins"><span>🛡 Insurance benefit</span><span className="num">− {money(p.pricing.insurance)}</span></div>}
                    {p.pricing.promo > 0 && <div className="adj promo"><span>🏷 {p.pricing.notes.filter((x) => !x.includes('covers')).join('; ') || 'Promotion'}</span><span className="num">− {money(p.pricing.promo)}</span></div>}
                  </div>
                ))}
                <div className="inv-tot">
                  <div className="row"><span>Retail total</span><span className="num">{money(rec.total.retail)}</span></div>
                  <div className="row save"><span>Total savings (insurance + promotions)</span><span className="num">− {money(rec.total.saved)}</span></div>
                  {mode === 'portal' && fulfill === 'ship' && <div className="row"><span>Shipping</span><span className="num">${SHIP_FEE.toFixed(2)}</span></div>}
                  <div className="row due"><span>Amount due</span><span className="num">{money(due)}</span></div>
                </div>
                {savedLater.size > 0 && (
                  <p style={{ fontSize: 12, color: 'var(--muted)', margin: '12px 0 0' }}>
                    ★ {[...savedLater].map((u) => LBL[u]).join(', ')} pair{savedLater.size > 1 ? 's' : ''} saved for later — included in the patient's purchase link (second-pair pricing holds for 30 days).
                  </p>
                )}
                {mode === 'portal' && (
                  <div className="fulfill">
                    <div className="fhead">How would you like to get your glasses?</div>
                    <label className={`fopt${fulfill === 'pickup' ? ' on' : ''}`}>
                      <input type="radio" name="fulfill" checked={fulfill === 'pickup'} onChange={() => setFulfill('pickup')} />
                      <span><span className="ft">🏬 Pick up in store — free</span><span className="fd">We'll text you when they're ready (typically 7–10 days)</span></span>
                    </label>
                    <label className={`fopt${fulfill === 'ship' ? ' on' : ''}`}>
                      <input type="radio" name="fulfill" checked={fulfill === 'ship'} onChange={() => setFulfill('ship')} />
                      <span><span className="ft">📦 Ship to me — ${SHIP_FEE.toFixed(2)}</span><span className="fd">Delivered with tracking; adjustments always free in store</span></span>
                    </label>
                    <div className={`addr${fulfill === 'ship' ? ' open' : ''}`}>
                      <input className="full" placeholder="Street address" />
                      <input placeholder="City" /><input placeholder="State / ZIP" />
                    </div>
                  </div>
                )}
              </div>
              <div className="inv-actions">
                {mode === 'office' ? (
                  <>
                    <button className="primaryb" disabled={busy} onClick={() => completeSale('office')}>Complete sale — {money(rec.total.youPay)}</button>
                    <button className="ghost" onClick={() => setTextOpen(true)}>📱 Text purchase link instead</button>
                  </>
                ) : (
                  <>
                    <button className="primaryb" disabled={busy} onClick={() => completeSale('portal')}>Pay now — {money(due)}</button>
                    <button className="ghost" onClick={() => setToastMsg('Order saved — the office will follow up')}>Save order for the office</button>
                  </>
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      {page === 'shop' && (
        <footer className="gs">
          Estimates only — final pricing with insurance is confirmed at checkout. Every pair is a complete frame + lens package; use the selectors to adjust.
        </footer>
      )}

      {textOpen && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) setTextOpen(false); }}>
          <div className="modal">
            <h3>Text a purchase link</h3>
            <p>Sends the patient a secure link to review and buy this cart from home. Selections, benefits, and saved pairs come with it; second-pair pricing holds for 30 days.</p>
            <input type="tel" value={phone} placeholder="Patient mobile number" onChange={(e) => setPhone(e.target.value)} aria-label="Patient phone" />
            <div className="msgprev">
              Hi {url.patientName.split(' ')[0]} — your eyewear picks from today are ready to order: {rec.cartPairs.map((p) => LBL[p.useCase]).join(', ')} ({money(due)} after your benefits{savedLater.size ? `, plus ${savedLater.size} saved pair` : ''}). Review and purchase: {'{link}'}
            </div>
            <div className="mrow">
              <button className="cancel" onClick={() => setTextOpen(false)}>Cancel</button>
              <button className="send" disabled={busy || !phone.trim()} onClick={sendTextLink}>Send link</button>
            </div>
          </div>
        </div>
      )}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </>
  );
}
