import { useRef, useState } from "react";
import { fmtNum, fmtSigned } from "./ScreenerTable";

// The chart pieces Market Pulse is built from (moved out of pages/MarketPulse.tsx 2026-10-25 so the macro and FII / DII sections can share them).

// [symbol, close, day %, company name]
export type ListRow = [string, number, number | null, string?];

export interface PulseRow {
  date: string;
  nifty500?: number | null;
  brent?: number | null;
  gold?: number | null;
  silver?: number | null;
  wh?: number | null;
  wl?: number | null;
  universe?: number | null;
  // the long-history "core" stocks (~750, the same names every day) — reaches back ~3 years; the all-stocks counts only ~1 year
  // the stocks behind the all-stocks counts for the last ~30 sessions: [symbol, close, day %]
  wh_list?: ListRow[] | null;
  wl_list?: ListRow[] | null;
  // macro / geopolitical drivers (marketPulse runner, 2026-10-25) — yields in %, usdinr in rupees per dollar
  usdinr?: number | null;
  dxy?: number | null;
  us10y?: number | null;
  us3m?: number | null;
  in10y?: number | null;
  in10y_est?: number; // 1 = estimated from the gilt index (before the first real CNBC reading)
  vix?: number | null;
  indiavix?: number | null;
  sp500?: number | null;
  // FII / DII cash-segment net buying in Rs Cr (+ = buying); mrow = a month-end row of the long history, not a trading day
  fii?: number | null;
  dii?: number | null;
  fii_buy?: number | null;
  fii_sell?: number | null;
  dii_buy?: number | null;
  dii_sell?: number | null;
  mrow?: number;
  // derived on the page: India 10Y minus US 10Y, and the US 10Y minus the 3-month bill (negative = inverted curve), both in percentage points
  spread?: number | null;
  curve?: number | null;
  wh_core?: number | null;
  wl_core?: number | null;
  universe_core?: number | null;
}

export type Key = "nifty500" | "brent" | "gold" | "silver" | "wh" | "wl" | "usdinr" | "dxy" | "us10y" | "us3m" | "in10y" | "vix" | "indiavix" | "sp500" | "spread" | "curve" | "fii" | "dii";

// shown as a change in basis points (or Rs Cr for the flows) rather than a % change
export const YIELD_KEYS: Key[] = ["us10y", "us3m", "in10y", "spread", "curve"];


export const GREEN = "#16a34a";
export const RED = "#dc2626";

export const pct = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null || b === 0 ? null : (a / b - 1) * 100;

export function Delta({ v, digits = 2, suffix = "", invert = false }: { v: number | null; digits?: number; suffix?: string; invert?: boolean }) {
  if (v == null) return <span className="text-slate-300">—</span>;
  const good = invert ? v <= 0 : v >= 0;
  return <span className={good ? "text-emerald-600" : "text-red-600"}>{fmtSigned(v, digits)}{suffix}</span>;
}

export interface LineSeries {
  name: string;
  color: string;
  data: (number | null)[];
}

const W = 640;
const H = 190;
const PAD = { l: 54, r: 10, t: 10, b: 22 };

export function LineChart({ dates, series, digits, onHover, onPick }: { dates: string[]; series: LineSeries[]; digits: number; onHover: (i: number | null) => void; onPick?: (i: number) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hi, setHi] = useState<number | null>(null);
  const n = dates.length;
  const vals = series.flatMap((s) => s.data).filter((v): v is number => v != null);
  if (n < 2 || vals.length < 2) return <div className="text-xs text-slate-400 py-10 text-center">Not enough data yet</div>;
  const lo = Math.min(...vals);
  const hiV = Math.max(...vals);
  const span = hiV - lo || Math.abs(hiV) * 0.02 || 1;
  const y0 = lo >= 0 ? Math.max(0, lo - span * 0.06) : lo - span * 0.06; // a count or a price never needs an axis below zero
  const y1 = hiV + span * 0.06;
  const x = (i: number) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const ticks = [0, 1, 2, 3].map((k) => y0 + ((y1 - y0) * k) / 3);
  const path = (data: (number | null)[]) => {
    let d = "";
    data.forEach((v, i) => {
      if (v == null) return;
      d += `${d && data[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    return d;
  };
  const move = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1))));
    setHi(i);
    onHover(i);
  };
  const leave = () => {
    setHi(null);
    onHover(null);
  };
  const short = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className={`w-full h-auto select-none ${onPick ? "cursor-pointer" : ""}`} onMouseMove={move} onMouseLeave={leave} onClick={() => hi != null && onPick?.(hi)}>
      {ticks.map((t, k) => (
        <g key={k}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="stroke-slate-200" strokeWidth={1} />
          <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-400" fontSize={10}>
            {fmtNum(t, digits)}
          </text>
        </g>
      ))}
      {[0, Math.floor((n - 1) / 2), n - 1].map((i, k) => (
        <text key={k} x={x(i)} y={H - 6} textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"} className="fill-slate-400" fontSize={10}>
          {short(dates[i])}
        </text>
      ))}
      {series.map((s) => (
        <path key={s.name} d={path(s.data)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {hi != null && (
        <g>
          <line x1={x(hi)} x2={x(hi)} y1={PAD.t} y2={H - PAD.b} className="stroke-slate-400" strokeWidth={1} strokeDasharray="3 3" />
          {series.map((s) => {
            const v = s.data[hi];
            return v == null ? null : <circle key={s.name} cx={x(hi)} cy={y(v)} r={4} fill={s.color} stroke="white" strokeWidth={2} />;
          })}
        </g>
      )}
    </svg>
  );
}

export function ChartCard({
  title,
  unit,
  rows,
  series,
  digits,
  invert,
  onPick,
}: {
  title: string;
  unit?: string;
  rows: PulseRow[];
  series: { key: Key; name: string; color: string }[];
  digits: number;
  invert?: Key[];
  onPick?: (date: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const dates = rows.map((r) => r.date);
  const i = hover ?? rows.length - 1;
  const row = rows[i];
  const prev = rows[i - 1];
  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <div className="text-sm font-semibold">
          {title} {unit && <span className="text-xs font-normal text-slate-400">{unit}</span>}
        </div>
        <div className="ml-auto flex items-baseline gap-3 text-xs tabular-nums">
          {row &&
            series.map((s) => {
              const v = row[s.key] as number | null | undefined;
              const p = prev?.[s.key] as number | null | undefined;
              const isCount = s.key === "wh" || s.key === "wl";
              const isYield = YIELD_KEYS.includes(s.key);
              const d = isCount ? (v != null && p != null ? v - p : null) : isYield ? (v != null && p != null ? (v - p) * 100 : null) : pct(v, p);
              return (
                <span key={s.key} className="whitespace-nowrap">
                  <span style={{ color: s.color }}>●</span> {series.length > 1 && <span className="text-slate-500">{s.name} </span>}
                  <b>{fmtNum(v, digits)}</b> <Delta v={d} digits={isCount || isYield ? 0 : 2} suffix={isCount ? "" : isYield ? " bp" : "%"} invert={invert?.includes(s.key)} />
                </span>
              );
            })}
          <span className="text-slate-400">{row?.date}</span>
        </div>
      </div>
      <LineChart dates={dates} digits={digits} onHover={setHover} onPick={onPick ? (i) => onPick(dates[i]) : undefined} series={series.map((s) => ({ name: s.name, color: s.color, data: rows.map((r) => (r[s.key] as number | null | undefined) ?? null) }))} />
    </div>
  );
}

export function Tile({ label, unit, value, digits, day, month, dayDigits, dayLabel, invert }: { label: string; unit?: string; value: number | null | undefined; digits: number; day: number | null; month: number | null; dayDigits: number; dayLabel: string; invert?: boolean }) {
  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="text-xs text-slate-500">
        {label} {unit && <span className="text-slate-400">{unit}</span>}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{fmtNum(value, digits)}</div>
      <div className="text-xs mt-1 flex gap-3 tabular-nums">
        <span>
          1D <Delta v={day} digits={dayDigits} suffix={dayLabel} invert={invert} />
        </span>
        <span>
          1M <Delta v={month} digits={dayDigits} suffix={dayLabel} invert={invert} />
        </span>
      </div>
    </div>
  );
}

