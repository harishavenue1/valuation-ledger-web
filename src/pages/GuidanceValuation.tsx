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
interface Co { symbol: string; name: string; weight?: number | null; price: number; price_as_of: string; last_fy: string; last_sales: number; last_opm: number | null; pe_median_5y: number | null; pe_now: number | null; shares_cr?: number | null; pe_stats?: PeStats | null;
  calc?: { oi_pct: number; dep_pct: number; int_pct: number; tax_pct: number; adj: number }; rows: Row[] }
type PeKey = "own" | "min" | "med" | "avg" | "fy" | "max" | "med5" | "cur";
const PE_OPTS: [PeKey, string][] = [["own", "As entered / 5y median"], ["min", "Min (2Y)"], ["med", "Median (2Y)"], ["avg", "Average (2Y)"], ["fy", "FY26 year-end"], ["max", "Max (2Y)"], ["med5", "5-year median"], ["cur", "Current P/E"]];

const fmt = (v: number | null | undefined, d = 0) => (v == null || !isFinite(v) ? "n/a" : v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d }));
const sgn = (v: number | null | undefined, d = 0) => (v == null || !isFinite(v) ? "n/a" : `${v >= 0 ? "+" : ""}${fmt(v, d)}%`);
const col = (v: number | null | undefined) => (v == null ? "text-slate-500" : v >= 0 ? "text-emerald-600" : "text-red-500");

function load(): Record<string, number> { try { return JSON.parse(localStorage.getItem("gv_pe") || "{}"); } catch { return {}; } }
function save(e: Record<string, number>) { try { localStorage.setItem("gv_pe", JSON.stringify(e)); } catch { /* storage unavailable */ } }

// the P/E for one company under the header choice (falls back to the company's own P/E when that statistic does not exist for it)
function peFor(c: Co, r: Row, key: PeKey): { pe: number | null; fallback: boolean } {
  const ps = c.pe_stats;
  const pick = { own: r.pe, min: ps?.min2y, med: ps?.med2y, avg: ps?.avg2y, fy: ps?.fy, max: ps?.max2y, med5: ps?.med5y ?? c.pe_median_5y, cur: c.pe_now }[key];
  return pick != null && pick > 0 ? { pe: pick, fallback: false } : { pe: r.pe, fallback: key !== "own" };
}

function derive(c: Co, r: Row, pe: number | null) {
  const shares = r.shares_cr_row ?? c.shares_cr ?? null;
  // lower limit: low end of the guided range x the stock's own 2-year minimum P/E (the chosen P/E when no history exists)
  const peLow = c.pe_stats?.min2y ?? pe;
  const floor = shares && peLow ? ((r.net_profit_low ?? r.net_profit) / shares) * peLow : null;
  const mos = floor != null && floor > 0 && c.price ? (1 - c.price / floor) * 100 : null;
  const eps = shares ? r.net_profit / shares : null;
  const price = eps != null && pe ? eps * pe : null;
  const end = new Date(Number(r.fy.slice(-4)), 2, 31), days = Math.max(1, Math.round((end.getTime() - Date.now()) / 86400000));
  const up = price != null && c.price ? (price / c.price - 1) * 100 : null;
  const cagr = price != null && price > 0 && c.price ? (Math.pow(price / c.price, 365.25 / days) - 1) * 100 : null;
  return { eps, price, up, mos, floor, cagr, days };
}

function Tbl({ cos, tab }: { cos: Co[]; tab: "held" | "scan" }) {
  const [key, setKey] = useState<PeKey>("own");
  const [own, setOwn] = useState<Record<string, number>>(load);
  const [sort, setSort] = useState<"weight" | "upside" | "mos">(tab === "held" ? "weight" : "upside");
  const setPe = (sym: string, v: number | null) => setOwn((p) => { const n = { ...p }; if (v == null) delete n[sym]; else n[sym] = v; save(n); return n; });
  const rows = useMemo(() => cos.filter((c) => c.rows.some((x) => x.fy === "Mar 2027")).map((c) => {  // FY27 only for now
    const r = c.rows.find((x) => x.fy === "Mar 2027")!, base = peFor(c, r, key), pe = own[c.symbol] ?? base.pe;
    return { c, r, pe, fallback: base.fallback && own[c.symbol] == null, edited: own[c.symbol] != null, d: derive(c, r, pe) };
  }).sort((a, b) => sort === "weight" ? (b.c.weight ?? 0) - (a.c.weight ?? 0) : sort === "mos" ? (b.d.mos ?? -1e9) - (a.d.mos ?? -1e9) : (b.d.up ?? -1e9) - (a.d.up ?? -1e9)), [cos, key, own, sort]);
  const hidden = cos.filter((c) => !c.rows.some((x) => x.fy === "Mar 2027"));
  const chip = (on: boolean) => `px-2 py-0.5 rounded-full border text-xs ${on ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`;
  const th = "text-right font-semibold px-2 py-2 whitespace-nowrap";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 mb-2 text-xs">
        <span className="text-slate-500">Sort:</span>
        {tab === "held" && <button onClick={() => setSort("weight")} className={chip(sort === "weight")}>Portfolio weight</button>}
        <button onClick={() => setSort("upside")} className={chip(sort === "upside")}>Upside</button>
        <button onClick={() => setSort("mos")} className={chip(sort === "mos")}>Margin of safety</button>
        {Object.keys(own).length > 0 && <button onClick={() => { setOwn({}); save({}); }} className="ml-2 underline text-slate-500">Clear my P/E edits ({Object.keys(own).length})</button>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm min-w-[60rem]">
          <thead className="text-xs text-slate-500 bg-slate-50"><tr>
            <th className="text-left font-semibold px-3 py-2">Company</th><th className={th}>Year</th><th className={th}>Sales ₹ Cr</th><th className={th}>OPM</th><th className={th}>Net profit</th><th className={th}>EPS ₹</th>
            <th className="px-2 py-1.5 bg-amber-50 text-right" title="Choose the P/E for every row. Type in a cell to override one company.">
              <div className="font-semibold text-amber-800 mb-0.5">P/E for all rows</div>
              <select value={key} onChange={(e) => setKey(e.target.value as PeKey)} className="border border-amber-300 rounded px-1 py-0.5 text-xs bg-white text-slate-700 font-normal">{PE_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </th>
            <th className={th}>Implied price</th><th className={th}>Upside</th><th className={th} title="1 − today's price ÷ the lower-limit value: low end of management's guided range (or the single figure) × the stock's own 2-year minimum P/E. Positive means today's price is below even that conservative value.">Margin of safety (lower limit)</th><th className={th} title="Annualised over the days to the end of that financial year">CAGR</th><th className="text-left font-semibold px-3">Basis</th></tr></thead>
          <tbody>
            {rows.map(({ c, r, pe, fallback, edited, d }) => (
              <tr key={c.symbol} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-1.5"><Link to={`/company/${c.symbol}`} className="font-medium text-indigo-700 hover:underline">{c.name}</Link><div className="text-[11px] text-slate-400">{c.symbol}{c.weight != null ? ` · ${c.weight.toFixed(1)}%` : ""} · ₹{fmt(c.price)} · P/E now {fmt(c.pe_now, 0)}</div></td>
                <td className="text-right px-2 whitespace-nowrap">FY{r.fy.slice(-4)}</td>
                <td className="text-right px-2 tabular-nums">{fmt(r.sales)}</td>
                <td className="text-right px-2 tabular-nums">{fmt(r.opm, 0)}%{r.opm_assumed && <span className="text-amber-600" title="Margin not guided: last year's held"> *</span>}</td>
                <td className="text-right px-2 tabular-nums">{fmt(r.net_profit)}</td>
                <td className="text-right px-2 tabular-nums">{fmt(d.eps, 1)}</td>
                <td className="text-right px-2 bg-amber-50/60 whitespace-nowrap">
                  <input type="number" step={0.5} value={Number((pe ?? 0).toFixed(1)) || ""} onChange={(e) => { const n = parseFloat(e.target.value); setPe(c.symbol, isNaN(n) ? null : n); }} className={`w-16 text-right tabular-nums border rounded px-1 py-0.5 text-sm bg-white ${edited ? "border-indigo-400" : "border-slate-300"}`} />
                  {fallback && <span className="text-[10px] text-slate-400 ml-1" title="This statistic is not available for the company, so its own P/E is used">n/a→own</span>}
                </td>
                <td className="text-right px-2 tabular-nums font-semibold">₹{fmt(d.price)}</td>
                <td className={`text-right px-2 tabular-nums ${col(d.up)}`}>{sgn(d.up)}</td>
                <td className={`text-right px-2 tabular-nums font-medium ${col(d.mos)}`}>{sgn(d.mos)}<div className="text-[10px] text-slate-400 font-normal">floor ₹{fmt(d.floor)}</div></td>
                <td className={`text-right px-2 tabular-nums ${col(d.cagr)}`}>{sgn(d.cagr)}<span className="text-[10px] text-slate-400 ml-1">{d.days}d</span></td>
                <td className="px-3 text-[11px] whitespace-nowrap">{r.basis === "user" ? <span className="px-1.5 py-0.5 rounded-full border border-slate-300 bg-slate-50 text-slate-600">your input</span> : <span className="px-1.5 py-0.5 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700" title={(r.quotes ?? []).join("  |  ")}>mgmt guidance{r.quote_verified ? " ✓" : ""}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden.length > 0 && <div className="text-[11px] text-slate-500 mt-2">FY27 only for now. Not shown (no FY27 row): {hidden.map((c) => `${c.name} (${c.rows.map((x) => "FY" + x.fy.slice(-4)).join(", ")})`).join(", ")}.</div>}
      <div className="text-[11px] text-slate-400 mt-2">* operating margin not guided, last year's held · Margin of safety = 1 − today's price ÷ lower-limit value, where the lower limit is the low end of management's guided range (or the single figure given) at the stock's own 2-year minimum P/E; upside, by contrast, uses the P/E chosen in the header · "n/a→own" = that P/E statistic does not exist for the company, so its own P/E is used. P/E edits are saved in this browser.</div>
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
        <p className="mb-2"><b>How a row is built.</b> Sales come from what management guided for the year (a sales figure, or a growth rate applied to the last full year; a range uses its midpoint). Operating margin is the guided one when management gave it, otherwise last year's is held and marked “held”. Net profit is guided operating profit less depreciation, interest, other income and tax held at last year's share of sales (or your own net profit where you entered it). EPS uses today's share count, and implied price is EPS × the company's 5-year median P/E (or the P/E you entered).</p>
        <p className="mb-2"><b>CAGR</b> is annualised over the real number of days to the end of that financial year (the Duration column), so a short horizon gives a large CAGR from a small upside. A ✓ means the guidance quote was found word for word in the concall transcript; click a row to read it.</p>
        <p><b>Limits.</b> A median P/E can be far from today's multiple (high-growth names look expensive against their own history), so the “upside” is as much a statement about P/E as about guidance. Guidance is management's, often optimistic; this is a reading aid, not a recommendation.</p>
      </MethodologyNote>
      <div className="flex gap-1 border-b border-slate-200 mb-3">{tabBtn("held", `Held (${held.length})`)}{tabBtn("scan", `Not held · Nifty 750 scan (${scan.length})`)}</div>
      {!ready ? <ScreenerLoading label="Guidance Valuation" /> : tab === "held" ? (held.length ? <Tbl cos={held} tab="held" /> : <div className="text-sm text-slate-500">No rows yet.</div>) : scan.length ? <Tbl cos={scan} tab="scan" /> : (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-700">The Nifty 750 scan has not been run yet. It reads the latest concall of each Nifty 750 company you do not hold, keeps those where management gave a FY27 revenue figure with a confident tone (and any margin), and adds them here. Ask Claude Code: “run the Guidance scan on Nifty 750”.</div>
      )}
    </div>
  );
}
