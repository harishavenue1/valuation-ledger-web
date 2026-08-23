// Compute engine — ported line-for-line from ~/valuation-ledger/app.py
// (the Streamlit version, the most current of the ledger's prior
// implementations as of 2026-08-16). Keep in sync if the source ever
// changes; this is the ONE place CAGR/EPS/PBT math lives in this app —
// everything is computed client-side from the raw stock JSON + saved
// scenario drivers, same "mirrors the Artifact exactly" philosophy the
// Python version documented for itself.

export type Case = "base" | "bull" | "bear" | "mgmt";
export const CASES: Case[] = ["base", "bull", "bear", "mgmt"];
export const GRID_CASES: Case[] = ["base", "bull", "bear"];
export const CASE_LABEL: Record<Case, string> = {
  base: "Base Case",
  bull: "Bull Case",
  bear: "Bear Case",
  mgmt: "Management Case",
};
// Light-theme palette (2026-08-22 redesign) — the original pastel set
// was tuned for a dark background and reads as washed-out/low-contrast
// on white. Base = indigo (matches the reference "BASE CASE" badge).
export const CASE_COLOR: Record<Case, string> = {
  base: "#4f46e5",
  bull: "#16a34a",
  bear: "#dc2626",
  mgmt: "#9333ea",
};
export const N_EST_YEARS = 3;
export const DEFAULT_REV_GROWTH: Record<string, number> = { base: 20.0, bull: 25.0, bear: 15.0 };

export interface Driver {
  revGrowth: number | null;
  opm: number | null;
  tax: number | null;
  other_income: number | null;
  interest: number | null;
  depreciation: number | null;
  shares: number | null;
  pe: number | null;
  // Expenses Cr override — null (the default) means "keep deriving
  // Expenses from Revenue x OPM%" (the original behavior, where
  // Expenses implicitly grows at exactly Revenue's growth rate since
  // it's always a fixed (1-OPM%) share of Revenue). A non-null value
  // overrides that for this year: Operating Profit is then derived
  // from Revenue - Expenses instead, letting Expenses grow at its own
  // rate independent of Revenue (2026-08-23, "expense field editable,
  // defaulted to current calculation"). The OPM% driver/input for
  // that year is unaffected by this and still saves normally, but is
  // ignored for computation while an Expenses override is present —
  // clear this field (blank the input) to hand control back to OPM%.
  expenses: number | null;
}

export interface CaseState {
  drivers: Driver[];
  assumptions: string;
  // Which estimate year (0/1/2) this case's headline CAGR should use —
  // an explicit "Use this year" pick (CAGR Estimator card), not
  // auto-derived. null/undefined falls back to the old forward-walk
  // (first year with a PE filled in) for scenarios saved before this
  // existed.
  chosenYear?: number | null;
}

export interface Guidance {
  revenue_growth?: Partial<Record<Case, number>>;
  source_text?: string;
  confidence?: string;
  source_urls?: string[];
  as_of?: string;
}

export interface Stock {
  ticker: string;
  name: string;
  base_url?: string;
  consolidated?: boolean;
  current_price: number | null;
  pe_ratio: number | null;
  market_cap_cr: number | null;
  week52_high: number | null;
  ema20d?: number | null;
  ema50d?: number | null;
  ema33w?: number | null;
  rsi_weekly?: number | null;
  pe_history?: { min: number; median: number; avg: number; max: number; at_last_fy: number | null; last_fy_year: number } | null;
  years: string[];
  revenue: (number | null)[];
  revenue_growth_pct: (number | null)[];
  expenses: (number | null)[];
  operating_profit: (number | null)[];
  opm_pct: (number | null)[];
  other_income: (number | null)[];
  interest: (number | null)[];
  depreciation: (number | null)[];
  pbt: (number | null)[];
  tax_pct: (number | null)[];
  net_profit: (number | null)[];
  pat_growth_pct: (number | null)[];
  eps: (number | null)[];
  shares_cr: (number | null)[];
  quarters?: string[];
  owned?: boolean;
  fetched_at?: string;
  fundamentals_fetched_at?: string;
  [key: string]: any;
}

export function lastActual(arr: (number | null)[] | undefined): number | null {
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && arr[i] !== undefined) return arr[i] as number;
  }
  return null;
}

/** Revenue Growth % seeds from guidance (Base=midpoint, Bull=upper,
 * Bear=lower — never Management Case), falling back to
 * DEFAULT_REV_GROWTH when there's no guidance yet. OPM%/Tax%/etc always
 * carry the last actual value forward regardless of guidance — the
 * model needs both non-null before it can produce PBT/PAT/EPS at all.
 * PE defaults to the same value as Revenue Growth % (a PEG-of-1 seed) so
 * every case computes a CAGR immediately instead of sitting on "fill PE"
 * until the user types one in — except Management Case, which never
 * seeds a growth default (nor therefore a PE default) at all. */
export function defaultCaseState(stock: Stock, guidance: Guidance | null, case_: Case): CaseState {
  const fromGuidance = guidance && case_ !== "mgmt" ? guidance.revenue_growth?.[case_] ?? null : null;
  let guidedGrowth = fromGuidance;
  if (guidedGrowth === null && case_ !== "mgmt") {
    guidedGrowth = DEFAULT_REV_GROWTH[case_] ?? null;
  }
  const drivers: Driver[] = [];
  for (let i = 0; i < N_EST_YEARS; i++) {
    drivers.push({
      revGrowth: guidedGrowth,
      opm: lastActual(stock.opm_pct),
      tax: lastActual(stock.tax_pct),
      other_income: lastActual(stock.other_income),
      interest: lastActual(stock.interest),
      depreciation: lastActual(stock.depreciation),
      shares: lastActual(stock.shares_cr),
      pe: guidedGrowth,
      expenses: null,
    });
  }
  let assumptions = "";
  if (fromGuidance !== null && guidance?.source_text) {
    const which =
      case_ === "base" ? "guidance range midpoint" : case_ === "bull" ? "guidance range upper end" : "guidance range lower end";
    assumptions =
      `[Auto-filled from management guidance research]\n\n` +
      `Revenue Growth % (${CASE_LABEL[case_]}): ${fromGuidance}% — ${which}.\n\n` +
      `Guidance: ${guidance.source_text}\n\n` +
      `Confidence: ${guidance.confidence ?? ""}\n\n` +
      `Sources: ${(guidance.source_urls ?? []).join(", ")}\n\n` +
      `As of: ${guidance.as_of ?? ""}`;
  }
  return { drivers, assumptions };
}

export function getCaseState(
  scenarios: Record<string, Partial<Record<Case, CaseState>>> | undefined,
  stock: Stock,
  guidance: Guidance | null,
  ticker: string,
  case_: Case
): CaseState {
  const saved = scenarios?.[ticker]?.[case_];
  if (saved && saved.drivers) return saved;
  return defaultCaseState(stock, guidance, case_);
}

export interface ModelRow {
  revenue: number | null;
  operating_profit: number | null;
  expenses: number | null;
  other_income: number;
  interest: number;
  depreciation: number;
  pbt: number | null;
  pat: number | null;
  pat_growth: number | null;
  shares: number | null;
  eps: number | null;
  forward_pe: number | null;
}

export function computeModel(stock: Stock, state: CaseState): ModelRow[] {
  let revenuePrev = stock.revenue[stock.revenue.length - 1];
  let patPrev = stock.net_profit[stock.net_profit.length - 1];
  const rows: ModelRow[] = [];
  for (const dr of state.drivers) {
    const revenue =
      dr.revGrowth !== null && dr.revGrowth !== undefined && revenuePrev !== null
        ? revenuePrev * (1 + dr.revGrowth / 100)
        : null;
    const opFromOpm = revenue !== null && dr.opm !== null && dr.opm !== undefined ? (revenue * dr.opm) / 100 : null;
    // Expenses override (see Driver.expenses) reverses the usual
    // Revenue+OPM%->Expenses derivation for this year: when set,
    // Operating Profit comes from Revenue - Expenses instead, so
    // Expenses can grow at its own rate rather than always being a
    // fixed share of Revenue.
    const hasExpensesOverride = dr.expenses !== null && dr.expenses !== undefined;
    const expenses = hasExpensesOverride ? dr.expenses! : revenue !== null && opFromOpm !== null ? revenue - opFromOpm : null;
    const op = hasExpensesOverride ? (revenue !== null ? revenue - expenses! : null) : opFromOpm;
    const oi = dr.other_income ?? 0;
    const interest = dr.interest ?? 0;
    const dep = dr.depreciation ?? 0;
    const pbt = op !== null ? op + oi - interest - dep : null;
    const pat = pbt !== null && dr.tax !== null && dr.tax !== undefined ? pbt * (1 - dr.tax / 100) : null;
    const patGrowth = pat !== null && patPrev !== null && patPrev !== 0 ? ((pat - patPrev) / Math.abs(patPrev)) * 100 : null;
    const shares = dr.shares ?? stock.shares_cr[stock.shares_cr.length - 1];
    const eps = pat !== null && shares ? pat / shares : null;
    const fwdPe = eps !== null && eps !== 0 && stock.current_price ? stock.current_price / eps : null;
    rows.push({
      revenue,
      operating_profit: op,
      expenses,
      other_income: oi,
      interest,
      depreciation: dep,
      pbt,
      pat,
      pat_growth: patGrowth,
      shares,
      eps,
      forward_pe: fwdPe,
    });
    revenuePrev = revenue !== null ? revenue : revenuePrev;
    patPrev = pat !== null ? pat : patPrev;
  }
  return rows;
}

export function daysUntil(year: number): number {
  const target = new Date(year, 2, 31); // 31 Mar, local time
  const today = new Date();
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function cagrFor(currentPrice: number | null, sharePrice: number | null, days: number | null): number | null {
  if (!currentPrice || !sharePrice || sharePrice <= 0 || days === null || days === undefined || days <= 0) return null;
  return (Math.pow(sharePrice / currentPrice, 365 / days) - 1) * 100;
}

export interface Headline {
  cagr: number | null;
  sharePrice: number;
  year: number;
  growth: number | null;
  pe: number;
}

/** The chip/summary-column CAGR — nearest estimate year that has a PE
 * Multiple filled in, walking FORWARD (not backward): a user modelling
 * only the first estimate year expects that year's chip, not silently
 * skipping ahead to the last year just because it happens to be
 * checked first. (This is the corrected, current behavior — the
 * original Claude Artifact walked backward; app.py fixed it.) */
export function headlineCagr(stock: Stock, state: CaseState): Headline | null {
  const model = computeModel(stock, state);
  const lastYear = parseInt(stock.years[stock.years.length - 1].split(" ")[1], 10);
  function forYear(i: number): Headline | null {
    const dr = state.drivers[i];
    const eps = model[i]?.eps;
    if (dr?.pe && eps !== undefined && eps !== null) {
      const year = lastYear + i + 1;
      const sharePrice = eps * dr.pe;
      const cagr = cagrFor(stock.current_price, sharePrice, daysUntil(year));
      return { cagr, sharePrice, year, growth: dr.revGrowth, pe: dr.pe };
    }
    return null;
  }
  // An explicit "Use this year" pick (CAGR Estimator card) wins over the
  // auto forward-walk, as long as that year is actually computable.
  if (state.chosenYear !== null && state.chosenYear !== undefined) {
    const chosen = forYear(state.chosenYear);
    if (chosen) return chosen;
  }
  for (let i = 0; i < N_EST_YEARS; i++) {
    const h = forYear(i);
    if (h) return h;
  }
  return null;
}

export function fmt(v: number | null | undefined, digits = 0, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + suffix;
}

export function fmtSigned(v: number | null | undefined, digits = 1, suffix = "%"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = v >= 0 ? "+" : "";
  return s + v.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + suffix;
}

export function estYearLabel(stock: Stock, i: number, fy = false): string {
  const lastYear = parseInt(stock.years[stock.years.length - 1].split(" ")[1], 10);
  return fy ? `FY${lastYear + i + 1}` : `Mar ${lastYear + i + 1}`;
}

const FISCAL_QUARTER_MAP: Record<string, [number, number]> = {
  Mar: [4, 0],
  Jun: [1, 1],
  Sep: [2, 1],
  Dec: [3, 1],
};

export function fiscalQuarterLabel(periodLabel: string | undefined): string {
  if (!periodLabel) return periodLabel ?? "";
  const parts = periodLabel.trim().split(" ");
  if (parts.length !== 2) return periodLabel;
  const [mon, yearStr] = parts;
  const map = FISCAL_QUARTER_MAP[mon];
  if (!map) return periodLabel;
  const [q, offset] = map;
  const fy = (parseInt(yearStr, 10) + offset) % 100;
  return `Q${q}FY${fy.toString().padStart(2, "0")}`;
}
