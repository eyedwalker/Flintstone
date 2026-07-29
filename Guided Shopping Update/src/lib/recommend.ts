/**
 * Recommendation + allocation engine for the 3-complete-pairs experience.
 *
 * From the patient's favorite frames + context (Rx, occupation, lifestyle, the
 * doctor's recommendation) it builds three FINISHED pairs — Primary, Computer,
 * Sunglass — each a frame + a complete lens package, then allocates the two
 * money levers to maximize the patient's savings:
 *
 *   - INSURANCE goes to ONE pair (vision plans cover one frame allowance + one
 *     lens per benefit period), placed on the pair where it saves the MOST.
 *   - PROMOTIONS fill the rest: a second-pair discount lands on the most
 *     valuable *remaining* pair; per-pair promos go where they save the most.
 *
 * PURE — no I/O, no clock. Prices are passed in (frame + package retail), so it
 * works on today's estimate data and drops straight onto live retail pricing
 * later without touching the UI. Every allocation is explained in `notes` so the
 * screen can show the patient exactly why each pair costs what it costs.
 */

export type UseCase = 'primary' | 'computer' | 'sunglass';

export interface Rx {
  rightAdd?: number | null;
  leftAdd?: number | null;
}

export interface Favorite {
  id: string;
  name: string;
  brand?: string;
  retailPrice: number;
  /** free-form descriptors used for use-case fit: 'wrap','large','rimless','metal','plastic','sport','light' */
  tags?: string[];
}

export interface LensPackage {
  id: string;
  name: string;
  /** 'progressive' | 'single-vision' | 'computer' | 'sun' | 'blue-light' | ... */
  kind: string;
  retailPrice: number;
  features?: string[];
  /** which use-cases this package is a good fit for */
  fits?: UseCase[];
}

/** Simplified vision-plan model (VSP-style: one frame allowance + one lens per period). */
export interface Insurance {
  planName?: string;
  frameAllowance: number;   // dollars the plan pays toward one frame
  lensCopay: number;        // patient copay for a covered lens (plan pays the rest)
  /** lens types the plan covers as "standard"; upgrades beyond these are patient-paid */
  coveredLensKinds?: string[];
}

export interface Promotion {
  id: string;
  name: string;
  /**
   * second-pair : fraction off an ADDITIONAL pair (the insured pair is skipped)
   * bogo        : buy-one-get-one — fraction off a second pair; for cash-pay it
   *               does not require insurance, so it may pair with a full-price pair
   * percent     : straight fraction off any eligible pair
   * amount      : flat dollars off any eligible pair
   */
  kind: 'second-pair' | 'bogo' | 'percent' | 'amount';
  /** for percent/second-pair/bogo: 0.50 = 50% off; for amount: dollars off */
  value: number;
  /** limit which use-cases the promo may apply to; omit = any */
  appliesTo?: UseCase[];
  /** second-pair/bogo need at least 2 pairs to make sense */
  requiresSecondPair?: boolean;
  /**
   * Validity window in days, anchored to the qualifying purchase. A saved-for-
   * later pair keeps its second-pair discount for this many days after the
   * original checkout; after that the promo silently drops at reprice time.
   */
  expiresDays?: number;
}

/**
 * Is a promo still valid relative to its anchor purchase? No expiresDays or no
 * anchor date = always valid (evergreen in-store promo). Day N is still valid.
 */
export function promoActive(promo: Promotion, anchorPurchaseAt?: string | Date | null, now: Date = new Date()): boolean {
  if (!promo.expiresDays || !anchorPurchaseAt) return true;
  const anchor = new Date(anchorPurchaseAt).getTime();
  if (Number.isNaN(anchor)) return true;
  return (now.getTime() - anchor) / 86400000 <= promo.expiresDays;
}

export interface PatientContext {
  rx?: Rx;
  occupation?: string;
  lifestyle?: string;
  reasonForVisit?: string;
  drRecommendation?: string;
  insurance?: Insurance | null;
  promotions?: Promotion[];
  /**
   * Set when repricing a SAVED cart after the original checkout: the date of
   * the anchoring purchase. Promos with expiresDays are dropped once outside
   * their window; second-pair discounts anchor to this purchase (so a single
   * saved pair still qualifies — the first pair was already bought).
   */
  anchorPurchaseAt?: string | Date | null;
  /** saved-cart repricing: did the anchoring purchase use the insurance benefit? */
  anchorHadInsurance?: boolean;
}

export interface Pricing {
  retail: number;
  insurance: number;   // dollars covered by insurance on this pair
  promo: number;       // dollars discounted by promotions on this pair
  youPay: number;
  notes: string[];     // human-readable explanation of each adjustment
}

export interface Pair {
  useCase: UseCase;
  label: string;
  frame: Favorite;
  pkg: LensPackage;
  pricing: Pricing;
}

export interface Recommendation {
  pairs: Pair[];
  total: { retail: number; youPay: number; saved: number };
}

const USE_LABEL: Record<UseCase, string> = { primary: 'Primary', computer: 'Computer', sunglass: 'Sunglass' };
const round2 = (n: number) => Math.round(n * 100) / 100;
const hasTag = (f: Favorite, t: string) => (f.tags || []).some((x) => x.toLowerCase() === t);

export function needsProgressive(rx?: Rx): boolean {
  const a = Math.abs(Number(rx?.rightAdd) || 0);
  const b = Math.abs(Number(rx?.leftAdd) || 0);
  return a > 0 || b > 0;
}

/** Score a favorite for a use-case; highest score wins. Ties break toward pricier (nicer) frames. */
function scoreFrame(f: Favorite, useCase: UseCase, ctx: PatientContext): number {
  let s = 0;
  if (useCase === 'sunglass') {
    if (hasTag(f, 'wrap') || hasTag(f, 'sport')) s += 3;
    if (hasTag(f, 'large')) s += 1;
    if (/sun|sport|outdoor|golf|drive/i.test(ctx.lifestyle || '')) s += 1;
  } else if (useCase === 'computer') {
    if (hasTag(f, 'light') || hasTag(f, 'rimless') || hasTag(f, 'metal')) s += 2;
    if (/office|comput|desk|screen|develop|analyst|writer/i.test(ctx.occupation || '')) s += 1;
  } else {
    // primary — favor the frame the doctor called out, else the top pick
    if (ctx.drRecommendation && f.name && ctx.drRecommendation.toLowerCase().includes(f.name.toLowerCase())) s += 4;
    s += 1; // every favorite is a valid everyday frame
  }
  return s + f.retailPrice / 100000; // tiny tiebreak toward nicer frames
}

/** Pick the best favorite for a use-case; never returns undefined if any favorite exists. */
export function pickFrame(favorites: Favorite[], useCase: UseCase, ctx: PatientContext): Favorite | null {
  if (!favorites.length) return null;
  return [...favorites].sort((a, b) => scoreFrame(b, useCase, ctx) - scoreFrame(a, useCase, ctx))[0];
}

function scorePackage(p: LensPackage, useCase: UseCase, ctx: PatientContext): number {
  let s = 0;
  if ((p.fits || []).includes(useCase)) s += 3;
  const k = p.kind.toLowerCase();
  const name = (p.name || '').toLowerCase();
  if (useCase === 'primary') {
    if (needsProgressive(ctx.rx) && k.includes('progressive')) s += 3;
    if (!needsProgressive(ctx.rx) && (k.includes('single') || k.includes('sv'))) s += 2;
    if (ctx.drRecommendation && name && ctx.drRecommendation.toLowerCase().includes(name)) s += 4;
    if (/ar|anti|premium|digital/i.test(name)) s += 1;
  } else if (useCase === 'computer') {
    if (k.includes('computer') || k.includes('blue') || k.includes('office') || /blue|computer|screen/i.test(name)) s += 4;
  } else {
    if (k.includes('sun') || k.includes('polar') || /sun|polar|tint/i.test(name)) s += 4;
  }
  return s + p.retailPrice / 100000;
}

export function pickPackage(packages: LensPackage[], useCase: UseCase, ctx: PatientContext): LensPackage | null {
  if (!packages.length) return null;
  return [...packages].sort((a, b) => scorePackage(b, useCase, ctx) - scorePackage(a, useCase, ctx))[0];
}

/** Build the three unpriced pairs. Frames may repeat if the patient has few favorites. */
export function buildPairs(favorites: Favorite[], packages: LensPackage[], ctx: PatientContext): Pair[] {
  const order: UseCase[] = ['primary', 'computer', 'sunglass'];
  return order.map((useCase) => {
    const frame = pickFrame(favorites, useCase, ctx);
    const pkg = pickPackage(packages, useCase, ctx);
    return {
      useCase,
      label: USE_LABEL[useCase],
      frame: frame as Favorite,
      pkg: pkg as LensPackage,
      pricing: { retail: 0, insurance: 0, promo: 0, youPay: 0, notes: [] },
    };
  }).filter((p) => p.frame && p.pkg);
}

function retailOf(p: Pair): number {
  return round2((p.frame?.retailPrice || 0) + (p.pkg?.retailPrice || 0));
}

/**
 * Insurance covers ONE pair. Compute the covered dollars for each candidate and
 * apply the benefit to the pair where it saves the most (usually the priciest).
 */
function insuranceCoveredFor(p: Pair, ins: Insurance): number {
  const framePart = Math.min(p.frame.retailPrice, ins.frameAllowance);
  const lensCovered = !ins.coveredLensKinds || ins.coveredLensKinds.some((k) => p.pkg.kind.toLowerCase().includes(k.toLowerCase()));
  const lensPart = lensCovered ? Math.max(0, p.pkg.retailPrice - ins.lensCopay) : 0;
  return round2(framePart + lensPart);
}

/**
 * Manual allocation overrides. insuranceOn: pin the insurance to a specific
 * pair ('auto' = optimizer decides, null = no insurance). promoOn: pin a promo
 * id to a pair's useCase ('auto' = optimizer decides, null = promo unused).
 */
export interface AllocationPlan {
  insuranceOn?: UseCase | 'auto' | null;
  promoOn?: Record<string, UseCase | 'auto' | null>;
}

/** Allocation of insurance (1 pair) + promotions (one per pair). Mutates pricing. */
export function allocate(pairs: Pair[], ctx: PatientContext, plan: AllocationPlan = {}): void {
  for (const p of pairs) { p.pricing = { retail: retailOf(p), insurance: 0, promo: 0, youPay: 0, notes: [] }; }

  const insuredIds = new Set<string>();
  const ins = ctx.insurance;
  const insWhere = plan.insuranceOn ?? 'auto';
  if (ins && insWhere !== null) {
    let best: Pair | null = null;
    let bestCovered = 0;
    if (insWhere !== 'auto') {
      best = pairs.find((p) => p.useCase === insWhere) || null;
      bestCovered = best ? insuranceCoveredFor(best, ins) : 0;
    } else {
      for (const p of pairs) {
        const c = insuranceCoveredFor(p, ins);
        if (c > bestCovered) { bestCovered = c; best = p; }
      }
    }
    if (best && bestCovered > 0) {
      best.pricing.insurance = bestCovered;
      best.pricing.notes.push(`${ins.planName || 'Insurance'} applied here — saves $${bestCovered.toFixed(0)}${insWhere === 'auto' ? ' (best use of your benefit)' : ''}`);
      insuredIds.add(pairId(best));
    }
  }

  // Promotions — at most ONE discount per pair (spread, don't stack), each
  // promo used once. Manually-pinned promos land first; the rest go through the
  // optimizer (a tiny weighted matching over the still-free pairs).
  const anchored = !!ctx.anchorPurchaseAt; // repricing a saved cart — the first purchase already happened
  const savingsOf = (promo: Promotion, p: Pair): number => {
    if (promo.appliesTo && !promo.appliesTo.includes(p.useCase)) return 0;
    if (!promoActive(promo, ctx.anchorPurchaseAt)) return 0; // e.g. second-pair window (30 days) lapsed
    // second-pair/bogo promos need another pair to anchor to — either in this
    // purchase, or the already-completed anchor purchase (saved-cart case).
    if ((promo.kind === 'second-pair' || promo.kind === 'bogo' || promo.requiresSecondPair) && pairs.length < 2 && !anchored) return 0;
    // The office rule: WITH insurance on one pair, the "second pair 50%" rides
    // along (never on the insured pair itself). WITHOUT insurance (cash pay),
    // the BOGO covers the pairing instead. They're alternatives, not stackable.
    // Saved-cart case: eligibility follows the ANCHOR purchase's insurance use.
    const insuranceInPlay = anchored ? !!ctx.anchorHadInsurance : insuredIds.size > 0;
    if (promo.kind === 'second-pair' && (!insuranceInPlay || insuredIds.has(pairId(p)))) return 0;
    if (promo.kind === 'bogo' && insuranceInPlay) return 0;
    const balance = Math.max(0, p.pricing.retail - p.pricing.insurance);
    return promo.kind === 'amount' ? round2(Math.min(promo.value, balance)) : round2(balance * promo.value);
  };

  const pinned = plan.promoOn || {};
  const usedPromoIds = new Set<string>();
  const takenPairs = new Set<string>();
  for (const promo of ctx.promotions || []) {
    const pin = pinned[promo.id];
    if (!pin || pin === 'auto') continue;
    usedPromoIds.add(promo.id);                 // pinned (even to null) is out of the optimizer
    if (pin === null) continue;                 // explicitly unused
    const p = pairs.find((x) => x.useCase === pin);
    if (!p || takenPairs.has(pairId(p)) || p.pricing.promo > 0) continue;
    const save = savingsOf(promo, p);
    if (save > 0) {
      p.pricing.promo = save;
      p.pricing.notes.push(`${promo.name} applied here — saves $${save.toFixed(0)}`);
      takenPairs.add(pairId(p));
    }
  }

  const freePromos = (ctx.promotions || []).filter((pr) => !usedPromoIds.has(pr.id) && (pinned[pr.id] ?? 'auto') === 'auto');
  const freePairs = pairs.filter((p) => p.pricing.promo === 0);
  const best = bestAssignment(freePromos, freePairs, savingsOf);
  for (const a of best) {
    a.pair.pricing.promo = a.save;
    a.pair.pricing.notes.push(`${a.promo.name} applied here — saves $${a.save.toFixed(0)}`);
  }

  for (const p of pairs) {
    p.pricing.youPay = round2(Math.max(0, p.pricing.retail - p.pricing.insurance - p.pricing.promo));
  }
}

function pairId(p: Pair): string { return `${p.useCase}:${p.frame.id}:${p.pkg.id}`; }

interface Assignment { promo: Promotion; pair: Pair; save: number; }

/**
 * Assign promotions to pairs — each pair gets AT MOST ONE discount, each promo
 * used at most once — choosing the combination that maximizes total savings.
 * Brute-forced over the (few) promos × pairs; returns the winning assignment.
 */
function bestAssignment(promos: Promotion[], pairs: Pair[], savingsOf: (promo: Promotion, p: Pair) => number): Assignment[] {
  let winner: Assignment[] = [];
  let winnerTotal = 0;
  const usedPairs = new Set<number>();
  const current: Assignment[] = [];

  const recurse = (i: number, total: number) => {
    if (i === promos.length) {
      if (total > winnerTotal) { winnerTotal = total; winner = [...current]; }
      return;
    }
    // Option 1: don't use this promo.
    recurse(i + 1, total);
    // Option 2: apply it to any eligible, still-free pair.
    const promo = promos[i];
    for (let j = 0; j < pairs.length; j++) {
      if (usedPairs.has(j)) continue;
      const save = savingsOf(promo, pairs[j]);
      if (save <= 0) continue;
      usedPairs.add(j);
      current.push({ promo, pair: pairs[j], save });
      recurse(i + 1, total + save);
      current.pop();
      usedPairs.delete(j);
    }
  };
  recurse(0, 0);
  return winner;
}

/** End-to-end: favorites + packages + context → three priced pairs + totals. */
export function priceRecommendation(favorites: Favorite[], packages: LensPackage[], ctx: PatientContext): Recommendation {
  const pairs = buildPairs(favorites, packages, ctx);
  allocate(pairs, ctx);
  const retail = round2(pairs.reduce((s, p) => s + p.pricing.retail, 0));
  const youPay = round2(pairs.reduce((s, p) => s + p.pricing.youPay, 0));
  return { pairs, total: { retail, youPay, saved: round2(retail - youPay) } };
}
