import { useMemo, useRef, useState } from "react";
import { useData, useScreeners } from "../App";
import RunButton from "../components/RunButton";
import { MethodologyNote, ScreenerInLink, ScreenerLoading, Signed, fmtNum, fmtSigned } from "../components/ScreenerTable";
import { ChartCard, Delta, GREEN, RED, Tile, pct } from "../components/PulseCharts";
import type { Key, ListRow, PulseRow } from "../components/PulseCharts";
import { CorrelationSection, FlowSection, MacroSection, withMacroDerived } from "../components/PulseMacro";

// 2026-10-25 ("a dashboard page which shows the day to day changes progress on Crude OIL, GOLD, SILVER,
// NIFTY500, # of Stocks in 52WH, # of Stocks in 52WLow") — one row per Indian trading day, built by
// api/momentum_screeners.py's marketPulse runner. Day-to-day changes are worked out here from
// consecutive rows, so a different range never needs a refetch.

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

  // the month-end FII / DII rows (mrow) are a separate long history, not trading days
  const months: PulseRow[] = useMemo(() => ((entry?.rows as PulseRow[]) ?? []).filter((r) => r.mrow).sort((a, b) => a.date.localeCompare(b.date)), [entry]);
  const all: PulseRow[] = useMemo(() => {
    const sorted = withMacroDerived([...((entry?.rows as PulseRow[]) ?? [])].filter((r) => !r.mrow).sort((a, b) => a.date.localeCompare(b.date)));
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
        <span className="text-slate-500 text-sm">Day-to-day: crude, gold, silver, Nifty 500, macro drivers (rupee, yields, VIX), FII / DII flows and 52-week highs / lows</span>
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
        Everything refreshes each trading evening once NSE's file lands (~6 PM IST). <b>Macro drivers</b> (Yahoo): USD/INR, Dollar Index, the US 10-year yield and 3-month bill (curve), India VIX, US VIX and the S&amp;P 500;
        the <b>India 10-year yield</b> is CNBC's reading, stored daily, with the stretch before the first reading rebuilt from NSE's 10-yr benchmark G-Sec index. <b>FII / DII</b> are the cash-segment net buying figures (Trendlyne, NSE + BSE).
        The <b>Correlations</b> grid uses daily changes only.
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
          <MacroSection all={all} rows={rows} />
          <FlowSection all={all} rows={rows} months={months} />
          <CorrelationSection all={all} />

          <h2 className="text-base font-semibold mt-6 mb-2">📈 52-week highs &amp; lows</h2>
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

function StockList({ title, list, color }: { title: string; list: ListRow[]; color: string }) {
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 text-xs font-semibold bg-slate-100" style={{ color }}>
        {title} · {list.length}
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-xs tabular-nums">
          <tbody>
            {list.map(([sym, close, chg, name]) => (
              <tr key={sym} className="border-t border-slate-100">
                <td className="px-3 py-1 text-left font-medium whitespace-nowrap">
                  {sym}
                  <ScreenerInLink symbol={sym} />
                </td>
                <td className="px-2 py-1 text-left text-slate-500 truncate max-w-[14rem]" title={name}>
                  {name || "—"}
                </td>
                <td className="px-2 py-1 text-center">
                  <a
                    href={`https://www.tradingview.com/chart/?symbol=NSE:${encodeURIComponent(sym)}&interval=D`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-500 hover:underline whitespace-nowrap"
                    title={`Open ${sym} on TradingView`}
                  >
                    TV ↗
                  </a>
                </td>
                <td className="px-2 py-1 text-right">{fmtNum(close)}</td>
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
