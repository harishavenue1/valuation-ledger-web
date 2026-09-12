// Reverse DCF — added 2026-09-11, "at 19th minute a concept discussed
// dcf, can we build exactly as its discussed a new page". The video
// (confirmed: "Anatomy of Mispriced Stock | Anshul Saigal", a CFA
// Society India webinar — full transcript reviewed) shows Saigal doing
// a reverse discounted cash flow on Century Plyboards at two points in
// time: instead of forecasting cash flows to derive a fair value (a
// normal DCF), you hold the stock's CURRENT market price fixed and
// solve BACKWARD for what the market must be implicitly pricing in —
// then judge whether that implied scenario looks conservative (a
// mispriced bet) or already-aggressive (no margin of safety left). His
// slide shows three numbers per snapshot: 10-year sales growth %,
// sustainable margin %, and implied terminal growth % — all sourced
// from Bloomberg's own reverse-DCF tool, whose actual inputs (WACC,
// tax rate, capex/working-capital treatment) are never disclosed in
// the talk. That's a real gap this module can't paper over — solving
// for all three of (growth, margin, terminal growth) from one equation
// (current price) is mathematically underdetermined without more
// structure than Bloomberg's black box reveals. So here, margin and
// terminal growth are INPUT ASSUMPTIONS (sensible defaults, but
// user-adjustable — confirmed with Harish before building), and the
// one number this module actually SOLVES for for is the implied
// constant revenue growth rate over the projection period — the
// closest honest match to Saigal's "sales growth % (10yr)" line,
// without claiming to replicate Bloomberg's undisclosed model exactly.
//
// FCFF simplification (also an assumption, not from the video): FCFF_t
// = Revenue_t × margin × (1 − tax) − netCapex_t − ΔWC_t, where
// netCapex/ΔWC are both user-adjustable as a % of revenue/incremental
// revenue (default 0% — "maintenance capex ≈ D&A, no net WC drag" —
// the standard simplification when a granular capex/WC schedule isn't
// available; bump these up if you know a company needs real growth
// capex or working capital). Terminal value uses a standard Gordon
// growth perpetuity on the final year's FCFF.

export interface ReverseDcfInputs {
  currentRevenueCr: number; // latest actual annual revenue, Cr — year-0 base
  sustainableMarginPct: number; // held constant across the whole projection window
  taxRatePct: number;
  waccPct: number;
  years: number; // projection period (video uses 10)
  terminalGrowthPct: number; // must be < waccPct or the perpetuity is undefined
  netCapexPctOfRevenue: number; // (capex − D&A) as % of revenue each year, default 0
  wcPctOfIncrementalRevenue: number; // ΔWC as % of (revenue_t − revenue_t-1), default 0
  targetEvCr: number; // current EV to match — market cap + net debt
}

export interface ReverseDcfResult {
  impliedGrowthPct: number | null; // null if unsolvable within the search bounds (e.g. WACC <= terminal growth, or target EV out of reach)
  evAtImpliedGrowth: number | null;
}

const SEARCH_LO_PCT = -50;
const SEARCH_HI_PCT = 200;
const MAX_ITER = 60;

/** EV implied by a given constant annual revenue growth rate, holding
 * every other input fixed. Monotonically increasing in growth (more
 * growth -> more revenue -> more FCFF each year and at the terminal
 * value), which is what makes the bisection solve below well-behaved. */
export function evForGrowth(inputs: Omit<ReverseDcfInputs, "targetEvCr">, growthPct: number): number {
  const margin = inputs.sustainableMarginPct / 100;
  const tax = inputs.taxRatePct / 100;
  const wacc = inputs.waccPct / 100;
  const tg = inputs.terminalGrowthPct / 100;
  const g = growthPct / 100;

  let prevRev = inputs.currentRevenueCr;
  let pv = 0;
  let finalFcff = 0;
  for (let t = 1; t <= inputs.years; t++) {
    const rev = prevRev * (1 + g);
    const incRev = rev - prevRev;
    const nopat = rev * margin * (1 - tax);
    const netCapex = rev * (inputs.netCapexPctOfRevenue / 100);
    const deltaWC = incRev * (inputs.wcPctOfIncrementalRevenue / 100);
    const fcff = nopat - netCapex - deltaWC;
    pv += fcff / Math.pow(1 + wacc, t);
    prevRev = rev;
    finalFcff = fcff;
  }
  if (wacc <= tg) return Infinity; // undefined perpetuity — caller should guard against this input combo
  const terminalFcff = finalFcff * (1 + tg);
  const tv = terminalFcff / (wacc - tg);
  const pvTv = tv / Math.pow(1 + wacc, inputs.years);
  return pv + pvTv;
}

/** Bisects for the constant annual revenue growth rate (%) that makes
 * evForGrowth(...) equal targetEvCr. Returns null if the target isn't
 * reachable within [SEARCH_LO_PCT, SEARCH_HI_PCT] (e.g. WACC <=
 * terminal growth makes every EV infinite, or the target EV is
 * negative/unreachable given the other assumptions) — shown as "—" by
 * the page rather than a misleading extreme number. */
export function solveReverseDcf(inputs: ReverseDcfInputs): ReverseDcfResult {
  if (inputs.waccPct <= inputs.terminalGrowthPct || inputs.currentRevenueCr <= 0 || inputs.targetEvCr <= 0) {
    return { impliedGrowthPct: null, evAtImpliedGrowth: null };
  }
  const rest = { ...inputs };
  const evLo = evForGrowth(rest, SEARCH_LO_PCT);
  const evHi = evForGrowth(rest, SEARCH_HI_PCT);
  if (!(evLo <= inputs.targetEvCr && inputs.targetEvCr <= evHi)) {
    return { impliedGrowthPct: null, evAtImpliedGrowth: null };
  }
  let lo = SEARCH_LO_PCT;
  let hi = SEARCH_HI_PCT;
  for (let i = 0; i < MAX_ITER; i++) {
    const mid = (lo + hi) / 2;
    const evMid = evForGrowth(rest, mid);
    if (evMid < inputs.targetEvCr) lo = mid;
    else hi = mid;
  }
  const impliedGrowthPct = (lo + hi) / 2;
  return { impliedGrowthPct, evAtImpliedGrowth: evForGrowth(rest, impliedGrowthPct) };
}

// Staged growth + visible calculation table — added 2026-09-12
// ("show the calculation table, also the growth rate should be
// editable, as a company can't grow at same rate for 10yrs, so 1-3
// high, 3-6 medium, 6-10 low teens"). A single flat growth rate for
// all 10 years (the functions above) is a fine SOLVE target, but not
// a realistic thing to hand-edit — real growth decelerates. This adds
// a fixed 3-stage shape (years 1-3 / 4-6 / 7-10, each its own editable
// rate) and exposes every year's own numbers, not just the final
// total, so the calculation is visible rather than a black box. The
// flat-rate functions above are UNCHANGED and still back both the
// single-stock page's initial auto-fill (seeds all three stages with
// the same solved flat rate as a starting point) and the bulk Scan
// page (which intentionally stays flat-rate — a first-pass screen
// across many stocks has no business asking for 3 hand-tuned inputs
// per company).

export interface StagedGrowthInputs {
  currentRevenueCr: number;
  sustainableMarginPct: number;
  taxRatePct: number;
  waccPct: number;
  terminalGrowthPct: number;
  netCapexPctOfRevenue: number;
  wcPctOfIncrementalRevenue: number;
  stage1Pct: number; // years 1-3
  stage2Pct: number; // years 4-6
  stage3Pct: number; // years 7-10
}

export interface StagedYearRow {
  year: number;
  stage: 1 | 2 | 3;
  growthPct: number;
  revenueCr: number;
  fcffCr: number;
  discountFactor: number;
  pvCr: number;
}

export interface StagedDcfResult {
  yearRows: StagedYearRow[];
  terminalFcffCr: number;
  terminalValueCr: number; // undiscounted, as of year 10
  pvTerminalValueCr: number;
  totalEvCr: number; // sum of all 10 years' PV + PV of terminal value
}

function stageGrowthForYear(t: number, inputs: StagedGrowthInputs): { stage: 1 | 2 | 3; growthPct: number } {
  if (t <= 3) return { stage: 1, growthPct: inputs.stage1Pct };
  if (t <= 6) return { stage: 2, growthPct: inputs.stage2Pct };
  return { stage: 3, growthPct: inputs.stage3Pct };
}

/** Builds the full 10-year table (fixed at 10 years — 3+3+4 — matching
 * the three stages) plus terminal value, from explicit per-stage
 * growth rates. Unlike solveReverseDcf, this doesn't solve for
 * anything — it's a forward calculation FROM whatever growth rates
 * you hand it, which is the point: edit a stage, see the resulting
 * fair value shift immediately, no re-solving. */
export function computeStagedDcf(inputs: StagedGrowthInputs): StagedDcfResult {
  const margin = inputs.sustainableMarginPct / 100;
  const tax = inputs.taxRatePct / 100;
  const wacc = inputs.waccPct / 100;
  const tg = inputs.terminalGrowthPct / 100;

  const yearRows: StagedYearRow[] = [];
  let prevRev = inputs.currentRevenueCr;
  for (let t = 1; t <= 10; t++) {
    const { stage, growthPct } = stageGrowthForYear(t, inputs);
    const revenueCr = prevRev * (1 + growthPct / 100);
    const incRev = revenueCr - prevRev;
    const nopat = revenueCr * margin * (1 - tax);
    const netCapex = revenueCr * (inputs.netCapexPctOfRevenue / 100);
    const deltaWC = incRev * (inputs.wcPctOfIncrementalRevenue / 100);
    const fcffCr = nopat - netCapex - deltaWC;
    const discountFactor = 1 / Math.pow(1 + wacc, t);
    yearRows.push({ year: t, stage, growthPct, revenueCr, fcffCr, discountFactor, pvCr: fcffCr * discountFactor });
    prevRev = revenueCr;
  }

  const finalFcff = yearRows[yearRows.length - 1].fcffCr;
  const terminalFcffCr = finalFcff * (1 + tg);
  const terminalValueCr = wacc > tg ? terminalFcffCr / (wacc - tg) : Infinity;
  const pvTerminalValueCr = terminalValueCr / Math.pow(1 + wacc, 10);
  const totalEvCr = yearRows.reduce((s, y) => s + y.pvCr, 0) + pvTerminalValueCr;

  return { yearRows, terminalFcffCr, terminalValueCr, pvTerminalValueCr, totalEvCr };
}
