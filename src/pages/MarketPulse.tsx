import { useMemo, useRef, useState } from "react";
import { useData, useScreeners } from "../App";
import RunButton from "../components/RunButton";
import { MethodologyNote, PriceLink, ScreenerLoading, Signed, fmtNum, fmtSigned } from "../components/ScreenerTable";

// 2026-10-25 ("a dashboard page which shows the day to day changes progress on Crude OIL, GOLD, SILVER,
// NIFTY500, # of Stocks in 52WH, # of Stocks in 52WLow") — one row per Indian trading day, built by
// api/momentum_screeners.py's marketPulse runner. Day-to-day changes are worked out here from
// consecutive rows, so a different range never needs a refetch.

interface PulseRow {
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
  wh_list?: [string, number, number | null][] | null;
  wl_list?: [string, number, number | null][] | null;
  wh_core?: number | null;
  wl_core?: number | null;
  universe_core?: number | null;
}

type Key = "nifty500" | "brent" | "gold" | "silver" | "wh" | "wl";

const RANGES: { label: string; days: number }[] = [
  { label: "1M", days: 22 },
  { label: "3M", days: 66 },
  { label: "6M", days: 132 },
  { label: "1Y", days: 252 },
  { label: "3Y", days: 756 },
];

const PRICE_SERIES: { key: Key; label: string; unit: string; color: string; digits: number }[] = [
  { key: "nifty500", label: "Nifty 500", unit: "", color: "#6366f1", digits: 0 },
  { key: "brent", label: "Crude Oil (Brent)", unit: "$/bbl", color: "#0891b2", digits: 2 },
  { key: "gold", label: "Gold", unit: "$/oz", color: "#d97706", digits: 0 },
  { key: "silver", label: "Silver", unit: "$/oz", color: "#64748b", digits: 2 },
];

const GREEN = "#16a34a";
const RED = "#dc2626";

const pct = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null || b === 0 ? null : (a / b - 1) * 100;

function Delta({ v, digits = 2, suffix = "", invert = false }: { v: number | null; digits?: number; suffix?: string; invert?: boolean }) {
  if (v == null) return <span className="text-slate-300">—</span>;
  const good = invert ? v <= 0 : v >= 0;
  return <span className={good ? "text-emerald-600" : "text-red-600"}>{fmtSigned(v, digits)}{suffix}</span>;
}

interface LineSeries {
  name: string;
  color: string;
  data: (number | null)[];
}

const W = 640;
const H = 190;
const PAD = { l: 54, r: 10, t: 10, b: 22 };

function LineChart({ dates, series, digits, onHover, onPick }: { dates: string[]; series: LineSeries[]; digits: number; onHover: (i: number | null) => void; onPick?: (i: number) => void }) {
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

function ChartCard({
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
              const d = isCount ? (v != null && p != null ? v - p : null) : pct(v, p);
              return (
                <span key={s.key} className="whitespace-nowrap">
                  <span style={{ color: s.color }}>●</span> {series.length > 1 && <span className="text-slate-500">{s.name} </span>}
                  <b>{fmtNum(v, digits)}</b> <Delta v={d} digits={isCount ? 0 : 2} suffix={isCount ? "" : "%"} invert={invert?.includes(s.key)} />
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

function Tile({ label, unit, value, digits, day, month, dayDigits, dayLabel, invert }: { label: string; unit?: string; value: number | null | undefined; digits: number; day: number | null; month: number | null; dayDigits: number; dayLabel: string; invert?: boolean }) {
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

export default function MarketPulse() {
  const { bundle } = useData();
  const { ready } = useScreeners(["marketPulse"]);
  const entry = bundle.momentum_screeners.marketPulse;
  const [range, setRange] = useState(RANGES[1]);
  // a custom from/to window over everything stored (2026-10-25, "add a date range as well to pull old records")
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [basis, setBasis] = useState<"all" | "core">("all");
  const [pick, setPick] = useState<string | null>(null); // the day whose new-high / new-low stocks are listed (default: the latest)

  const all: PulseRow[] = useMemo(() => {
    const sorted = [...((entry?.rows as PulseRow[]) ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    return basis === "core" ? sorted.map((r) => ({ ...r, wh: r.wh_core, wl: r.wl_core, universe: r.universe_core })) : sorted;
  }, [entry, basis]);
  const rows = useMemo(() => (custom ? all.filter((r) => (!from || r.date >= from) && (!to || r.date <= to)) : all.slice(-range.days)), [all, range, custom, from, to]);
  const hasCore = ((entry?.rows as PulseRow[]) ?? []).some((r) => r.wh_core != null);

  if (!ready) return <ScreenerLoading label="Market Pulse" />;

  const last = all[all.length - 1];
  const prev = all[all.length - 2];
  const monthAgo = all[all.length - 23];
  const pctChg = (k: Key, ref?: PulseRow) => (last && ref ? pct(last[k] as number | null, ref[k] as number | null) : null);
  const cntChg = (k: "wh" | "wl", ref?: PulseRow) => (last && ref && last[k] != null && ref[k] != null ? (last[k] as number) - (ref[k] as number) : null);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <h1 className="text-xl font-semibold">📟 Market Pulse</h1>
        <span className="text-slate-500 text-sm">Day-to-day: crude, gold, silver, Nifty 500 and 52-week highs / lows</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="inline-flex rounded-md border border-slate-200 overflow-hidden text-xs">
            {RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => {
                  setCustom(false);
                  setRange(r);
                }}
                className={`px-2.5 py-1 ${!custom && range.label === r.label ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {r.label}
              </button>
            ))}
            <button
              onClick={() => {
                if (!custom) {
                  setFrom(rows[0]?.date ?? all[0]?.date ?? "");
                  setTo(rows[rows.length - 1]?.date ?? last?.date ?? "");
                }
                setCustom(true);
              }}
              className={`px-2.5 py-1 border-l border-slate-200 ${custom ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              Custom
            </button>
          </span>
          {custom && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
              <input type="date" value={from} min={all[0]?.date} max={to || last?.date} onChange={(e) => setFrom(e.target.value)} className="border border-slate-300 rounded px-1.5 py-0.5 bg-transparent" />
              →
              <input type="date" value={to} min={from || all[0]?.date} max={last?.date} onChange={(e) => setTo(e.target.value)} className="border border-slate-300 rounded px-1.5 py-0.5 bg-transparent" />
            </span>
          )}
          <RunButton screener="marketPulse" />
        </span>
      </div>
      {entry?.as_of && <div className="text-xs text-slate-400 mb-2">as of {entry.as_of}</div>}

      <MethodologyNote>
        One row per Indian trading day. <b>Nifty 500</b> is NSE's own index close. <b>Crude Oil (Brent)</b>, <b>Gold</b> and <b>Silver</b> are the
        front-month futures closes in <b>US dollars</b> (Yahoo: BZ=F, GC=F, SI=F) — the last close on or before each Indian trading day, so an
        Indian holiday never leaves a gap; they are global prices, not MCX rupee prices. <b>52W Highs / Lows</b> count the stocks (price above ₹10, at least a
        year of history; <b>All NSE stocks</b> goes back about a year because the store keeps two years of bars for most stocks, while <b>Core ~750</b> — the
        stocks with five years stored, the same names every day — reaches back three years, but is today's NSE-750 only, so names that delisted along the way are
        missing and older lows are understated) whose high that day was <b>above the highest high of the previous 252 sessions</b>, or whose low
        was below the lowest low — a stock that just matches its old high does not count, and a frozen price never counts. Prices are
        split/bonus-adjusted from our own daily NSE store. <b>Net</b> = highs minus lows; more highs than lows means a healthy market, a
        cluster of lows means selling pressure. Pick a preset range or <b>Custom</b> for an exact from/to window over everything stored.
        Everything refreshes each trading evening once NSE's file lands (~6 PM IST).
      </MethodologyNote>

      {all.length < 2 ? (
        <div className="text-sm text-slate-400 text-center py-16">No Market Pulse data yet — click Run now above, or wait for the next evening run.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            {PRICE_SERIES.map((s) => (
              <Tile key={s.key} label={s.label} unit={s.unit} value={last?.[s.key] as number | null} digits={s.digits} day={pctChg(s.key, prev)} month={pctChg(s.key, monthAgo)} dayDigits={2} dayLabel="%" />
            ))}
            <Tile label="52W Highs" unit="stocks" value={last?.wh} digits={0} day={cntChg("wh", prev)} month={cntChg("wh", monthAgo)} dayDigits={0} dayLabel="" />
            <Tile label="52W Lows" unit="stocks" value={last?.wl} digits={0} day={cntChg("wl", prev)} month={cntChg("wl", monthAgo)} dayDigits={0} dayLabel="" invert />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {PRICE_SERIES.map((s) => (
              <ChartCard key={s.key} title={s.label} unit={s.unit} rows={rows} digits={s.digits} series={[{ key: s.key, name: s.label, color: s.color }]} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-2 text-xs text-slate-500">
            <span>52-week counts for</span>
            <span className="inline-flex rounded-md border border-slate-200 overflow-hidden">
              <button onClick={() => setBasis("all")} className={`px-2.5 py-1 ${basis === "all" ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                All NSE stocks
              </button>
              {hasCore && (
                <button onClick={() => setBasis("core")} className={`px-2.5 py-1 border-l border-slate-200 ${basis === "core" ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                  Core ~750 · 3 years
                </button>
              )}
            </span>
            {rows.some((r) => r.wh == null) && (
              <span className="text-amber-600">
                {hasCore && basis === "all" ? "All-stock counts only go back about a year — switch to Core ~750 for the full range." : "No 52-week counts before this point."}
              </span>
            )}
            {basis === "core" && rows[rows.length - 1]?.universe != null && <span>{rows[rows.length - 1].universe} stocks counted</span>}
          </div>
          <div className="mb-6">
            <ChartCard
              title="Stocks at 52-week highs vs lows"
              unit="count per day"
              rows={rows}
              digits={0}
              invert={["wl"]}
              onPick={setPick}
              series={[
                { key: "wh", name: "Highs", color: GREEN },
                { key: "wl", name: "Lows", color: RED },
              ]}
            />
          </div>

          <StocksPanel row={all.find((r) => r.date === (pick ?? last?.date))} core={basis === "core"} />

          <div className="overflow-auto max-h-[28rem] border border-slate-200 rounded-lg">
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 bg-slate-100 text-slate-600">
                <tr>
                  <th className="text-left px-2 py-2">Date</th>
                  {PRICE_SERIES.map((s) => (
                    <th key={s.key} colSpan={2} className="px-2 py-2 text-center border-l border-slate-200">
                      {s.label}
                    </th>
                  ))}
                  <th colSpan={2} className="px-2 py-2 text-center border-l border-slate-200">
                    52W Highs
                  </th>
                  <th colSpan={2} className="px-2 py-2 text-center border-l border-slate-200">
                    52W Lows
                  </th>
                  <th className="px-2 py-2 text-right border-l border-slate-200">Net</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => {
                  const p = all[all.findIndex((x) => x.date === r.date) - 1];
                  return (
                    <tr key={r.date} onClick={() => setPick(r.date)} className={`border-t border-slate-100 hover:bg-slate-50 cursor-pointer ${r.date === (pick ?? last?.date) ? "bg-slate-100" : ""}`}>
                      <td className="px-2 py-1.5 text-left whitespace-nowrap">{r.date}</td>
                      {PRICE_SERIES.map((s) => (
                        <PriceCells key={s.key} v={r[s.key] as number | null | undefined} p={p?.[s.key] as number | null | undefined} digits={s.digits} />
                      ))}
                      <td className="px-2 py-1.5 text-right border-l border-slate-100">{r.wh ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right">{p && r.wh != null && p.wh != null ? <Delta v={r.wh - p.wh} digits={0} /> : "—"}</td>
                      <td className="px-2 py-1.5 text-right border-l border-slate-100">{r.wl ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right">{p && r.wl != null && p.wl != null ? <Delta v={r.wl - p.wl} digits={0} invert /> : "—"}</td>
                      <td className="px-2 py-1.5 text-right border-l border-slate-100">{r.wh != null && r.wl != null ? <Delta v={r.wh - r.wl} digits={0} /> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function PriceCells({ v, p, digits }: { v: number | null | undefined; p: number | null | undefined; digits: number }) {
  return (
    <>
      <td className="px-2 py-1.5 text-right border-l border-slate-100">{fmtNum(v, digits)}</td>
      <td className="px-2 py-1.5 text-right">
        <Delta v={pct(v, p)} suffix="%" />
      </td>
    </>
  );
}

function StockList({ title, list, color }: { title: string; list: [string, number, number | null][]; color: string }) {
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 text-xs font-semibold bg-slate-100" style={{ color }}>
        {title} · {list.length}
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-xs tabular-nums">
          <tbody>
            {list.map(([sym, close, chg]) => (
              <tr key={sym} className="border-t border-slate-100">
                <td className="px-3 py-1 text-left font-medium">{sym}</td>
                <td className="px-2 py-1 text-right">
                  <PriceLink symbol={sym} value={close} />
                </td>
                <td className="px-3 py-1 text-right">
                  <Signed v={chg} digits={1} />
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-slate-400">None</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// The stocks behind one day's 52-week high / low counts — click a day on the breadth chart, or a row in the table below
function StocksPanel({ row, core }: { row?: PulseRow; core: boolean }) {
  if (!row) return null;
  const has = row.wh_list != null && row.wl_list != null;
  return (
    <div className="mb-6">
      <div className="text-sm font-semibold mb-1">
        Stocks behind the {row.date} counts <span className="text-xs font-normal text-slate-400">click a day on the chart or a row in the table to switch · sorted by the day's move</span>
      </div>
      {core && <div className="text-xs text-amber-600 mb-1">These lists are for all NSE stocks, so they won't match the Core ~750 counts above.</div>}
      {has ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <StockList title="New 52-week highs" list={row.wh_list!} color={GREEN} />
          <StockList title="New 52-week lows" list={row.wl_list!} color={RED} />
        </div>
      ) : (
        <div className="text-xs text-slate-400 border border-slate-200 rounded-lg px-3 py-4">The stock lists are kept for the last 30 trading sessions — pick a more recent day.</div>
      )}
    </div>
  );
}
