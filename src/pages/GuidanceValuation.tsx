import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData, useScreeners } from "../App";
import { MethodologyNote, ScreenerLoading } from "../components/ScreenerTable";

// Guidance Valuation (2026-11-15, "one simple table with FY27, FY28 guidance and its upside from the current price ... a tab for companies not held ... scan NIFTY750 for FY27 revenue guidance with a confident tone, and margins").
// Rows: management guidance (sales growth or sales, margin) or the user's own inputs -> net profit -> EPS -> implied price at the 5-year median P/E (or the P/E the user entered) -> upside from today's price.
// Built by the GuidanceValuation skill (key guidanceValuation for holdings, guidanceScan750 for the Nifty 750 scan of companies not held). No model call from the site.

interface Row {
  fy: string; basis: "user" | "guidance" | "scan"; sales: number; sales_cagr: number | null; opm: number; opm_assumed: boolean; net_profit: number; np_given: boolean; pe: number | null; pe_user: boolean; pe_median_5y: number | null; shares_cr_row?: number | null;
  eps: number | null; net_profit_low?: number; implied: number | null; implied_at_median: number | null; abs_return: number | null; price_cagr: number | null; assumptions: string[]; note?: string | null; quotes?: string[]; quote_verified?: boolean; call?: string; source?: string; tone?: string;
}
interface PeStats { min2y: number; med2y: number; avg2y: number; max2y: number; med5y: number | null; fy: number | null; fy_label: string }
interface Co { symbol: string; name: string; weight?: number | null; price: number; price_as_of: string; last_fy: string; last_sales: number; last_np?: number | null; last_opm: number | null; pe_median_5y: number | null; pe_now: number | null; shares_cr?: number | null; pe_stats?: PeStats | null;
  calc?: { oi_pct: number; dep_pct: number; int_pct: number; tax_pct: number; adj: number }; rows: Row[] }
type PeKey = "peg" | "own" | "min" | "med" | "avg" | "fy" | "max" | "med5" | "cur";
const PE_OPTS: [PeKey, string][] = [["own", "As entered / 5y median"], ["min", "Min (2Y)"], ["med", "Median (2Y)"], ["avg", "Average (2Y)"], ["fy", "FY26 year-end"], ["max", "Max (2Y)"], ["med5", "5-year median"], ["cur", "Current P/E"]];

const fmt = (v: number | null | undefined, d = 0) => (v == null || !isFinite(v) ? "n/a" : v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d }));
const sgn = (v: number | null | undefined, d = 0) => (v == null || !isFinite(v) ? "n/a" : `${v >= 0 ? "+" : ""}${fmt(v, d)}%`);
const col = (v: number | null | undefined) => (v == null ? "text-slate-500" : v >= 0 ? "text-emerald-600" : "text-red-500");

// the P/E for one company under the header choice (falls back to the company's own P/E when that statistic does not exist for it)
function peFor(c: Co, r: Row, key: PeKey): { pe: number | null; fallback: boolean } {
  const ps = c.pe_stats;
  const pick = { peg: null as number | null, own: r.pe, min: ps?.min2y, med: ps?.med2y, avg: ps?.avg2y, fy: ps?.fy, max: ps?.max2y, med5: ps?.med5y ?? c.pe_median_5y, cur: c.pe_now }[key];
  return pick != null && pick > 0 ? { pe: pick, fallback: false } : { pe: r.pe, fallback: key !== "own" };
}

const COLS: [PeKey, string][] = [["peg", "P/E = EPS growth"], ["min", "Min (2Y)"], ["med", "Median (2Y)"], ["avg", "Avg (2Y)"], ["fy", "FY26 year-end"], ["max", "Max (2Y)"], ["med5", "5-yr median"], ["cur", "Current"], ["own", "Your P/E"]];

function Tbl({ cos, tab }: { cos: Co[]; tab: "held" | "scan" }) {
  const [lowGuide, setLowGuide] = useState(false);
  const [sort, setSort] = useState<string>(tab === "held" ? "weight" : "min");
  const rows = useMemo(() => cos.filter((c) => c.rows.some((x) => x.fy === "Mar 2027")).map((c) => {  // FY27 only for now
    const r = c.rows.find((x) => x.fy === "Mar 2027")!;
    const shares = r.shares_cr_row ?? c.shares_cr ?? null;
    const np = lowGuide ? (r.net_profit_low ?? r.net_profit) : r.net_profit;
    const eps = shares ? np / shares : null;
    const epsGrowth = c.last_np && c.last_np > 0 ? (np / c.last_np - 1) * 100 : null;  // shares held constant, so EPS growth = net profit growth
    const cells = COLS.map(([k]) => {
      let pe: number | null; let missing = false;
      if (k === "peg") { pe = epsGrowth != null && epsGrowth > 0 ? epsGrowth : null; missing = pe == null; }
      else { const x = peFor(c, r, k); pe = x.fallback ? null : x.pe; missing = pe == null; }
      const price = eps != null && pe ? eps * pe : null;
      return { k, pe, missing, price, up: price != null && c.price ? (price / c.price - 1) * 100 : null };
    });
    return { c, r, cells, epsGrowth };
  }).sort((a, b) => sort === "weight" ? (b.c.weight ?? 0) - (a.c.weight ?? 0) : (b.cells.find((x) => x.k === sort)?.up ?? -1e9) - (a.cells.find((x) => x.k === sort)?.up ?? -1e9)), [cos, sort, lowGuide]);
  const hidden = cos.filter((c) => !c.rows.some((x) => x.fy === "Mar 2027"));
  const chip = (on: boolean) => `px-2 py-0.5 rounded-full border text-xs ${on ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`;
  const th = "text-right font-semibold px-2 py-2 whitespace-nowrap";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
        <span className="text-slate-500">Sort by:</span>
        {tab === "held" && <button onClick={() => setSort("weight")} className={chip(sort === "weight")}>Portfolio weight</button>}
        <select value={sort === "weight" ? "" : sort} onChange={(e) => e.target.value && setSort(e.target.value)} className="border border-slate-300 rounded px-1.5 py-0.5 bg-white">
          <option value="">Upside at…</option>{COLS.map(([k, l]) => <option key={k} value={k}>Upside at {l}</option>)}</select>
        <label className="text-slate-600 ml-2"><input type="checkbox" checked={lowGuide} onChange={(e) => setLowGuide(e.target.checked)} className="mr-1 align-middle" />Use the low end of guidance (every column)</label>
              </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm min-w-[64rem]">
          <thead className="text-xs text-slate-500 bg-slate-50"><tr>
            <th className="text-left font-semibold px-3 py-2 sticky left-0 bg-slate-50 z-10">Company</th><th className={th}>Year</th><th className={th}>Sales ₹ Cr</th><th className={th} title="Guided FY27 sales against the last full year">Rev growth</th><th className={th}>OPM</th><th className={th}>Net profit</th><th className={th} title="FY27 EPS against last year's, at today's share count (so equal to net-profit growth)">EPS growth</th>
            {COLS.map(([k, l]) => <th key={k} className={`${th} ${k === "min" ? "bg-sky-50 text-sky-800" : k === "peg" ? "bg-violet-50 text-violet-800" : k === "cur" ? "bg-slate-100" : k === "own" ? "bg-amber-50 text-amber-800" : ""}`} title={k === "peg" ? "Upside if the stock is priced at a P/E equal to its EPS growth % (PEG = 1): 50% EPS growth means a P/E of 50. Not available when EPS growth is zero or negative." : k === "min" ? "Price and upside if the multiple falls to the stock's own 2-year minimum. Positive means upside remains even then." : undefined}>{l}</th>)}
            <th className="text-left font-semibold px-3">Basis</th></tr></thead>
          <tbody>
            {rows.map(({ c, r, cells, epsGrowth }) => {
              return (
                <tr key={c.symbol} className="border-t border-slate-100 hover:bg-slate-50 align-top">
                  <td className="px-3 py-1.5 sticky left-0 bg-white z-10"><Link to={`/company/${c.symbol}`} className="font-medium text-indigo-700 hover:underline">{c.name}</Link><div className="text-[11px] text-slate-400">{c.symbol}{c.weight != null ? ` · ${c.weight.toFixed(1)}%` : ""} · ₹{fmt(c.price)}</div></td>
                  <td className="text-right px-2 py-1.5 whitespace-nowrap">FY{r.fy.slice(-4)}</td>
                  <td className="text-right px-2 py-1.5 tabular-nums">{fmt(r.sales)}</td>
                  <td className={`text-right px-2 py-1.5 tabular-nums ${col(r.sales_cagr)}`}>{sgn(r.sales_cagr)}</td>
                  <td className="text-right px-2 py-1.5 tabular-nums">{fmt(r.opm, 0)}%{r.opm_assumed && <span className="text-amber-600" title="Margin not guided: last year's held"> *</span>}</td>
                  <td className="text-right px-2 py-1.5 tabular-nums">{fmt(lowGuide ? r.net_profit_low ?? r.net_profit : r.net_profit)}</td>
                  <td className={`text-right px-2 py-1.5 tabular-nums ${col(epsGrowth)}`}>{sgn(epsGrowth)}</td>
                  {cells.map((x) => (
                    <td key={x.k} className={`text-right px-2 py-1.5 tabular-nums ${x.k === "min" ? "bg-sky-50/50" : x.k === "peg" ? "bg-violet-50/50" : x.k === "own" ? "bg-amber-50/50" : ""}`}>
                      {x.missing ? <span className="text-slate-300">n/a</span> : (
                        <span className={`font-medium ${col(x.up)}`} title={`₹${fmt(x.price)} at ${fmt(x.pe, 1)}x P/E`}>{sgn(x.up)}</span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-[11px] whitespace-nowrap">{r.basis === "user" ? <span className="px-1.5 py-0.5 rounded-full border border-slate-300 bg-slate-50 text-slate-600">your input</span> : <span className="px-1.5 py-0.5 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700" title={(r.quotes ?? []).join("  |  ")}>mgmt guidance{r.quote_verified ? " ✓" : ""}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hidden.length > 0 && <div className="text-[11px] text-slate-500 mt-2">FY27 only for now. Not shown (no FY27 row): {hidden.map((c) => `${c.name} (${c.rows.map((x) => "FY" + x.fy.slice(-4)).join(", ")})`).join(", ")}.</div>}
      <div className="text-[11px] text-slate-400 mt-2">Each P/E column is the upside against today's price if the guided FY27 EPS is priced at that P/E (hover a figure for the price and the P/E; "n/a" = no history for that statistic). The violet column prices the stock at a P/E equal to its EPS growth % (PEG = 1). The blue Min column is the downside case: positive there means upside remains even at the lowest recent multiple. Click a company for its quarterly, annual and CAGR-estimator page. * operating margin not guided, last year's held. Guidance is management's, often optimistic; a reading aid, not a recommendation.</div>
    </div>
  );
}

export default function GuidanceValuation() {
  const { bundle } = useData();
  const { ready } = useScreeners(["guidanceValuation", "guidanceScan750"]);
  const held = ((bundle.momentum_screeners.guidanceValuation?.rows ?? []) as Co[]);
  const scan = ((bundle.momentum_screeners.guidanceScan750?.rows ?? []) as Co[]);
  const [tab, setTab] = useState<"held" | "scan">("held");
  const tabBtn = (t: "held" | "scan", label: string) => <button onClick={() => setTab(t)} className={`px-3 py-1 rounded-t border-b-2 text-sm ${tab === t ? "border-indigo-600 text-indigo-700 font-medium" : "border-transparent text-slate-500 hover:text-slate-700"}`}>{label}</button>;
  return (
    <div>
      <div className="flex items-center gap-2 mb-1"><h1 className="text-xl font-semibold">🎯 Guidance Valuation</h1><span className="text-slate-500 text-sm">management guidance → earnings → implied price → upside from today's price</span></div>
      <div className="flex items-center gap-2 mb-3">{bundle.momentum_screeners.guidanceValuation?.as_of && <span className="text-xs text-slate-400">updated {bundle.momentum_screeners.guidanceValuation.as_of}</span>}</div>
      <MethodologyNote>
        <p className="mb-2"><b>How a row is built.</b> Sales come from what management guided for FY27 (a sales figure, or a growth rate applied to the last full year; a range uses its midpoint). Operating margin is the guided one when management gave it, otherwise last year's is held (marked *). Net profit is guided operating profit less depreciation, interest, other income and tax held at last year's share of sales (or your own net profit where you entered it). EPS uses today's share count.</p>
        <p className="mb-2"><b>One column per P/E.</b> Each column prices that EPS at a P/E from the company's own history (2-year min, median, average, max, its FY26 year-end level, the 5-year median, today's) and shows the upside against today's price. The Min column is the downside case: positive there means upside remains even at the lowest recent multiple. A ✓ on the basis means the guidance quote was found word for word in the concall transcript; hover for it.</p>
        <p><b>Limits.</b> The P/E moves the answer more than the guidance does, which is why every option is shown. Guidance is management's, often optimistic, and most margins here are last year's held; this is a reading aid, not a recommendation.</p>
      </MethodologyNote>
      <div className="flex gap-1 border-b border-slate-200 mb-3">{tabBtn("held", `Held (${held.length})`)}{tabBtn("scan", `Not held · Nifty 750 scan (${scan.length})`)}</div>
      {!ready ? <ScreenerLoading label="Guidance Valuation" /> : tab === "held" ? (held.length ? <Tbl cos={held} tab="held" /> : <div className="text-sm text-slate-500">No rows yet.</div>) : scan.length ? <Tbl cos={scan} tab="scan" /> : (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-700">The Nifty 750 scan has not been run yet. It reads the latest concall of each Nifty 750 company you do not hold, keeps those where management gave a FY27 revenue figure with a confident tone (and any margin), and adds them here. Ask Claude Code: “run the Guidance scan on Nifty 750”.</div>
      )}
    </div>
  );
}
