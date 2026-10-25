import type { PulseRow } from "../components/PulseCharts";

// Correlations behind Market Pulse's macro section (2026-10-25, "USDINR, US Bond & IN Bond Yields ... and all correlations").
// Every series is turned into a DAILY CHANGE first — a % move for prices and the VIXes, a point move for yields — because two
// trending levels always look correlated. FII / DII net buying is already a daily flow, so it is used as it is.
//
// Clock: the US-hours series (S&P, VIX, crude, gold, silver, the dollar index, the US yield) close AFTER the Indian market does,
// so their move on a given date can only reach Indian prices the next session. With `lagUs` on, a US-clock series is paired with the
// Indian series of the NEXT trading day (that is how a US sell-off shows up in Nifty, a day later); same-clock pairs are unchanged.

export type Kind = "pct" | "diff" | "level";
export interface CorrSeries {
  key: string;
  label: string;
  kind: Kind;
  clock: "in" | "us";
  get: (r: PulseRow) => number | null | undefined;
}

export const CORR_SERIES: CorrSeries[] = [
  { key: "nifty500", label: "Nifty 500", kind: "pct", clock: "in", get: (r) => r.nifty500 },
  { key: "usdinr", label: "USD/INR", kind: "pct", clock: "in", get: (r) => r.usdinr },
  { key: "dxy", label: "Dollar Index", kind: "pct", clock: "us", get: (r) => r.dxy },
  { key: "us10y", label: "US 10Y yield", kind: "diff", clock: "us", get: (r) => r.us10y },
  { key: "in10y", label: "India 10Y yield", kind: "diff", clock: "in", get: (r) => r.in10y },
  { key: "brent", label: "Crude (Brent)", kind: "pct", clock: "us", get: (r) => r.brent },
  { key: "gold", label: "Gold", kind: "pct", clock: "us", get: (r) => r.gold },
  { key: "silver", label: "Silver", kind: "pct", clock: "us", get: (r) => r.silver },
  { key: "vix", label: "US VIX", kind: "pct", clock: "us", get: (r) => r.vix },
  { key: "indiavix", label: "India VIX", kind: "pct", clock: "in", get: (r) => r.indiavix },
  { key: "sp500", label: "S&P 500", kind: "pct", clock: "us", get: (r) => r.sp500 },
  { key: "fii", label: "FII net buying", kind: "level", clock: "in", get: (r) => r.fii },
  { key: "dii", label: "DII net buying", kind: "level", clock: "in", get: (r) => r.dii },
];

/** One value per row: the day-over-day change of the series (null when either day is missing). */
export function dailyChanges(rows: PulseRow[], s: CorrSeries): (number | null)[] {
  return rows.map((r, i) => {
    const v = s.get(r);
    if (v == null) return null;
    if (s.kind === "level") return v;
    const p = i > 0 ? s.get(rows[i - 1]) : null;
    if (p == null) return null;
    if (s.kind === "diff") return v - p;
    return p === 0 ? null : (v / p - 1) * 100;
  });
}

export const MIN_PAIRS = 15;

/** Pearson r over indexes [from, to) of the two change series, pairing them with a one-row lag when the clocks differ and lagUs is on. */
export function pairCorr(a: (number | null)[], b: (number | null)[], sa: CorrSeries, sb: CorrSeries, lagUs: boolean, from: number, to: number): { r: number | null; n: number } {
  let la = 0;
  let lb = 0;
  if (lagUs && sa.clock !== sb.clock) {
    if (sa.clock === "us") la = 1;
    else lb = 1;
  }
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let t = Math.max(from, 1); t < to; t++) {
    const x = a[t - la];
    const y = b[t - lb];
    if (x == null || y == null) continue;
    n++;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  if (n < MIN_PAIRS) return { r: null, n };
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  if (vx <= 1e-12 || vy <= 1e-12) return { r: null, n };
  return { r: cov / Math.sqrt(vx * vy), n };
}

/** The rolling `win`-row correlation of a and b, one value per row (null until the window fills). */
export function rollingCorr(a: (number | null)[], b: (number | null)[], sa: CorrSeries, sb: CorrSeries, lagUs: boolean, win: number): (number | null)[] {
  return a.map((_, t) => (t < win ? null : pairCorr(a, b, sa, sb, lagUs, t - win + 1, t + 1).r));
}
