import type { ChartBar } from "./api";

// Anchored VWAP: the volume-weighted average typical price [(H+L+C)/3] from an
// anchor bar to each later bar — "the average price of everyone who bought since
// that day" — with standard-deviation bands (volume-weighted variance of the
// same typical price). Computed from the bars the chart already has, so on a
// weekly/monthly chart each bar is one observation (the anchor bar is the bar
// that CONTAINS the date); a daily chart gives the exact day. Optional and off
// by default (2026-10-04, after @jadeja_rajdeep's NSE Momentum Screener post).
export interface AnchorSpec {
  enabled: boolean;
  date: string; // ISO yyyy-mm-dd
  bands: number; // 0-3 SD bands each side
  color: string;
}

export interface AvwapPoint {
  date: string;
  vwap: number;
  sd: number;
}

export const DEFAULT_ANCHORS: AnchorSpec[] = [
  { enabled: false, date: "", bands: 3, color: "#f59e0b" },
  { enabled: false, date: "", bands: 3, color: "#22d3ee" },
  { enabled: false, date: "", bands: 3, color: "#c084fc" },
];

export function computeAvwap(bars: ChartBar[], anchorDate: string): AvwapPoint[] {
  if (!anchorDate || bars.length === 0) return [];
  // the bar containing the anchor date = the last bar dated on/before it (the first bar if the date is earlier than all of them)
  let start = 0;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].date <= anchorDate) start = i;
    else break;
  }
  const out: AvwapPoint[] = [];
  let cumV = 0;
  let cumPV = 0;
  let cumPV2 = 0;
  for (let i = start; i < bars.length; i++) {
    const b = bars[i];
    const tp = (b.high + b.low + b.close) / 3;
    const v = b.volume && b.volume > 0 ? b.volume : 0;
    cumV += v;
    cumPV += tp * v;
    cumPV2 += tp * tp * v;
    if (cumV <= 0) continue;
    const vwap = cumPV / cumV;
    out.push({ date: b.date, vwap, sd: Math.sqrt(Math.max(0, cumPV2 / cumV - vwap * vwap)) });
  }
  return out;
}
