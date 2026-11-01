// RS Rating — the one definition used by every page that shows it (Portfolio Allocation, All Technicals).
//
// score  = 0.40 x return(3M) + 0.30 x return(6M) + 0.30 x return(1Y)          (weekly-bar returns from the technicals store: w_pct_3m, w_pct_6m, yearly_pct)
// rating = percentile rank (1-99) of the score among NSE 750 scores; a tie counts half, so the median stock reads 50
//
// IBD weights 3 / 6 / 9 / 12 months 40 / 20 / 20 / 20; the store has no 9-month return, so 6M and 1Y carry the rest. A stock without a year of history has no score and no rating.
// The same percentile rank is used for the 1W / 1M / 1Q columns (rank of a single window's return). Ranking returns or returns minus the index gives the same order, so the benchmark is not needed.

export const RS_WEIGHTS = { m3: 0.4, m6: 0.3, y1: 0.3 } as const;
const MIN_UNIVERSE = 50; // below this a percentile means nothing

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function rsScore(m3: unknown, m6: unknown, y1: unknown): number | null {
  return num(m3) && num(m6) && num(y1) ? RS_WEIGHTS.m3 * m3 + RS_WEIGHTS.m6 * m6 + RS_WEIGHTS.y1 * y1 : null;
}

/** percentile rank 1-99 of x in an ascending array: the share of the array x beats, a tie counting half */
export function percentileRank(sorted: number[], x: number | null | undefined): number | null {
  if (x == null || !num(x) || sorted.length < MIN_UNIVERSE) return null;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < x) lo = m + 1; else hi = m; }
  let top = lo;
  while (top < sorted.length && sorted[top] === x) top++;
  return Math.min(99, Math.max(1, Math.round(((lo + 0.5 * (top - lo)) / sorted.length) * 100)));
}

export interface RsUniverse { scoreBy: Map<string, number>; sorted: number[] }

/** scores for every symbol the store has returns for, and the ascending array of those that belong to the ranking universe (NSE 750) */
export function buildRsUniverse(rows: Iterable<{ symbol: string; w_pct_3m?: unknown; w_pct_6m?: unknown; yearly_pct?: unknown }>, universe: Set<string>): RsUniverse {
  const scoreBy = new Map<string, number>();
  for (const t of rows) {
    const s = rsScore(t.w_pct_3m, t.w_pct_6m, t.yearly_pct);
    if (s != null) scoreBy.set(t.symbol, s);
  }
  const sorted = [...scoreBy.entries()].filter(([sym]) => universe.has(sym)).map(([, v]) => v).sort((a, b) => a - b);
  return { scoreBy, sorted };
}

export const rsRatingOf = (u: RsUniverse, symbol: string): number | null => percentileRank(u.sorted, u.scoreBy.get(symbol));

/** text colour for a 1-99 rating */
export const rsTone = (v: number): string =>
  v >= 90 ? "text-emerald-700 font-bold" : v >= 80 ? "text-emerald-600 font-bold" : v >= 60 ? "text-emerald-600" : v >= 40 ? "text-slate-700" : v >= 20 ? "text-orange-600" : "text-red-600 font-semibold";
