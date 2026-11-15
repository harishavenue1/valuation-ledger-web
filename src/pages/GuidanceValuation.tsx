import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData, useScreeners } from "../App";
import { MethodologyNote, ScreenerLoading } from "../components/ScreenerTable";

// Guidance Valuation (2026-11-15, "one simple table with FY27, FY28 guidance and its upside from the current price ... a tab for companies not held ... scan NIFTY750 for FY27 revenue guidance with a confident tone, and margins").
// Rows: management guidance (sales growth or sales, margin) or the user's own inputs -> net profit -> EPS -> implied price at the 5-year median P/E (or the P/E the user entered) -> upside from today's price.
// Built by the GuidanceValuation skill (key guidanceValuation for holdings, guidanceScan750 for the Nifty 750 scan of companies not held). No model call from the site.

interface Row {
  fy: string; basis: "user" | "guidance" | "scan"; sales: number; sales_cagr: number | null; opm: number; opm_assumed: boolean; net_profit: number; np_given: boolean; pe: number | null; pe_user: boolean; pe_median_5y: number | null; shares_cr_row?: number | null;
  eps: number | null; implied: number | null; implied_at_median: number | null; abs_return: number | null; price_cagr: number | null; assumptions: string[]; note?: string | null; quotes?: string[]; quote_verified?: boolean; call?: string; source?: string; tone?: string;
}
interface PeStats { min2y: number; med2y: number; avg2y: number; max2y: number; med5y: number | null; fy: number | null; fy_label: string }
interface Co { symbol: string; name: string; weight?: number | null; price: number; price_as_of: string; last_fy: string; last_sales: number; last_opm: number | null; pe_median_5y: number | null; pe_now: number | null; shares_cr?: number | null; pe_stats?: PeStats | null;
  calc?: { oi_pct: number; dep_pct: number; int_pct: number; tax_pct: number; adj: number }; rows: Row[] }
type Edit = { sales?: number; opm?: number; np?: number; pe?: number };

const fmt = (v: number | null | undefined, d = 0) => (v == null || !isFinite(v) ? "n/a" : v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d }));
const sgn = (v: number | null | undefined, d = 1) => (v == null || !isFinite(v) ? "n/a" : `${v >= 0 ? "+" : ""}${fmt(v, d)}%`);
const col = (v: number | null | undefined) => (v == null ? "text-slate-500" : v >= 0 ? "text-emerald-600" : "text-red-500");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dstr = (d: Date) => `${d.getDate()} ${MON[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;

function load(): Record<string, Edit> { try { return JSON.parse(localStorage.getItem("gv_edits") || "{}"); } catch { return {}; } }
function save(e: Record<string, Edit>) { try { localStorage.setItem("gv_edits", JSON.stringify(e)); } catch { /* storage unavailable */ } }

// the row after the user's edits: sales / margin edits rebuild net profit from last year's cost ratios, a net-profit edit overrides, P/E is its own input
function derive(c: Co, r: Row, e: Edit) {
  const sales = e.sales ?? r.sales, opm = e.opm ?? r.opm, k = c.calc;
  let np = r.net_profit;
  if (e.np != null) np = e.np;
  else if ((e.sales != null || e.opm != null) && k) np = (sales * (opm + k.oi_pct - k.dep_pct - k.int_pct) / 100) * (1 - k.tax_pct / 100) * k.adj;
  const shares = r.shares_cr_row ?? c.shares_cr ?? null;
  const pe = e.pe ?? r.pe;
  const eps = shares ? np / shares : null;
  const price = eps != null && pe ? eps * pe : null;
  const fyYear = Number(r.fy.slice(-4));
  const end = new Date(fyYear, 2, 31), now = new Date();
  const days = Math.max(1, Math.round((end.getTime() - now.getTime()) / 86400000));
  const up = price != null && c.price ? (price / c.price - 1) * 100 : null;
  const cagr = price != null && price > 0 && c.price ? (Math.pow(price / c.price, 365.25 / days) - 1) * 100 : null;
  return { sales, opm, np, pe, eps, price, up, cagr, days, end, edited: e.sales != null || e.opm != null || e.np != null || e.pe != null };
}

function Num({ v, on, w = "w-20", step = 1, dec = 0 }: { v: number | null; on: (n: number | null) => void; w?: string; step?: number; dec?: number }) {
  const [t, setT] = useState<string | null>(null);
  return <input type="number" step={step} value={t ?? (v == null ? "" : String(Number(v.toFixed(dec))))} onChange={(e) => { setT(e.target.value); const n = parseFloat(e.target.value); if (!isNaN(n)) on(n); }} onBlur={() => setT(null)}
    className={`${w} text-right tabular-nums border border-slate-300 rounded px-1.5 py-1 text-sm bg-white focus:outline-none focus:border-indigo-500`} />;
}

// P/E scenarios for one year: what the same earnings are worth at the stock's own min / median / average / max P/E and at today's P/E, with the margin of safety at each
function Scenarios({ c, rows }: { c: Co; rows: { r: Row; d: ReturnType<typeof derive> }[] }) {
  const [yi, setYi] = useState(0);
  const x = rows[Math.min(yi, rows.length - 1)];
  const ps = c.pe_stats;
  const eps = x.d.eps;
  if (eps == null || eps <= 0) return null;
  const sc: [string, number | null | undefined][] = [["Min (2Y)", ps?.min2y], ["Median (2Y)", ps?.med2y], ["Average (2Y)", ps?.avg2y], [`FY${ps?.fy_label ?? ""} year-end`, ps?.fy], ["Max (2Y)", ps?.max2y], ["5-year median", ps?.med5y ?? c.pe_median_5y], ["Current P/E", c.pe_now], ["P/E used above", x.d.pe]];
  const list = sc.filter(([, v]) => v != null && v > 0).map(([l, v]) => { const price = eps * (v as number); return { l, pe: v as number, price, up: (price / c.price - 1) * 100, mos: (1 - c.price / price) * 100 }; });
  const by = (l: string) => list.find((z) => z.l === l);
  const med = by("Median (2Y)") ?? by("5-year median"), mn = by("Min (2Y)"), cur = by("Current P/E");
  const rr = med && mn && mn.up < 0 && med.up > 0 ? med.up / -mn.up : null;
  return (
    <div className="mx-3 mb-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">P/E scenarios and margin of safety</span>
        {rows.length > 1 && rows.map((y, i) => <button key={y.r.fy} onClick={() => setYi(i)} className={`px-2 py-0.5 rounded-full border text-xs ${i === yi ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600"}`}>FY{y.r.fy.slice(-4)}</button>)}
        <span className="text-[11px] text-slate-400">EPS ₹{fmt(eps, 1)} for FY{x.r.fy.slice(-4)} (uses your edits)</span>
      </div>
      <div className="flex flex-wrap gap-2 mb-2 text-xs">
        {med && <span className={`px-2 py-1 rounded border ${med.mos >= 0 ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-700"}`}>Margin of safety at median P/E: <b>{sgn(med.mos, 0)}</b></span>}
        {mn && <span className={`px-2 py-1 rounded border ${mn.up >= 0 ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}>If P/E falls to the 2Y min: <b>{sgn(mn.up, 0)}</b></span>}
        {cur && <span className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700">If P/E stays at today's {fmt(cur.pe, 1)}: <b>{sgn(cur.up, 0)}</b> (earnings growth alone)</span>}
        {rr != null && <span className="px-2 py-1 rounded border border-indigo-300 bg-indigo-50 text-indigo-800">Reward : risk (median upside ÷ min-P/E fall): <b>{fmt(rr, 1)} : 1</b></span>}
      </div>
      <table className="w-full text-sm min-w-[34rem]">
        <thead className="text-xs text-slate-500"><tr><th className="text-left font-semibold py-1">Scenario</th><th className="text-right font-semibold">P/E</th><th className="text-right font-semibold">Price (₹)</th><th className="text-right font-semibold">Upside vs ₹{fmt(c.price)}</th><th className="text-right font-semibold" title="1 − today's price ÷ value at that P/E. Positive: the price is below what these earnings are worth at that multiple; the larger, the more room for being wrong.">Margin of safety</th></tr></thead>
        <tbody>{list.map((z) => (
          <tr key={z.l} className={`border-t border-slate-200 ${z.l === "Current P/E" ? "bg-white" : ""}`}>
            <td className="py-1">{z.l}</td><td className="text-right tabular-nums">{fmt(z.pe, 1)}x</td><td className="text-right tabular-nums">₹{fmt(z.price)}</td>
            <td className={`text-right tabular-nums ${col(z.up)}`}>{sgn(z.up)}</td><td className={`text-right tabular-nums font-medium ${col(z.mos)}`}>{sgn(z.mos, 0)}</td></tr>))}</tbody>
      </table>
      <div className="text-[11px] text-slate-400 mt-1.5">Margin of safety = 1 − today's price ÷ the value at that P/E. It judges the price against the earnings, not the guidance itself: if management misses, EPS falls and every row falls with it. A reading aid, not a trade signal.</div>
    </div>
  );
}

function Card({ c, edits, setEdits }: { c: Co; edits: Record<string, Edit>; setEdits: (f: (p: Record<string, Edit>) => Record<string, Edit>) => void }) {
  const [src, setSrc] = useState(false);
  const rows = c.rows.map((r) => ({ r, d: derive(c, r, edits[`${c.symbol}|${r.fy}`] ?? {}) }));
  const head = rows[0];
  const set = (fy: string, patch: Edit) => setEdits((p) => ({ ...p, [`${c.symbol}|${fy}`]: { ...(p[`${c.symbol}|${fy}`] ?? {}), ...patch } }));
  const reset = () => setEdits((p) => { const n = { ...p }; c.rows.forEach((r) => delete n[`${c.symbol}|${r.fy}`]); return n; });
  const applyPe = (v: number) => c.rows.forEach((r) => set(r.fy, { pe: v }));
  const ps = c.pe_stats;
  const chips: [string, number | null | undefined][] = ps ? [["Min", ps.min2y], ["Median", ps.med2y], ["Avg", ps.avg2y], [`FY${ps.fy_label}`, ps.fy], ["Max", ps.max2y], ["5y median", ps.med5y]] : [["5y median", c.pe_median_5y]];
  const anyEdit = rows.some((x) => x.d.edited);
  const tone = head.d.up == null ? "bg-slate-500" : head.d.up >= 0 ? "bg-emerald-600" : "bg-red-500";
  return (
    <div className="rounded-xl overflow-hidden border border-slate-200 bg-white shadow-sm mb-5">
      <div className={`${tone} text-white px-4 py-1.5 text-[11px] font-semibold tracking-wider uppercase flex items-center justify-between`}>
        <span>{head.r.basis === "user" ? "Your inputs" : "Management guidance"}{head.r.quote_verified ? " · quote verified ✓" : ""}</span>
        {anyEdit && <button onClick={reset} className="underline text-white/90 normal-case tracking-normal font-normal">Reset my edits</button>}
      </div>
      <div className="px-4 pt-3 pb-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-slate-900">CAGR estimator</div>
          <Link to={`/company/${c.symbol}`} className="text-sm text-slate-500 hover:underline">{c.name} <span className="text-slate-400">· {c.symbol}{c.weight != null ? ` · ${c.weight.toFixed(1)}% of portfolio` : ""}</span></Link>
        </div>
        <div className="flex gap-8 text-right">
          <div><div className="text-[10px] tracking-wider text-slate-400 uppercase">Current price</div><div className="text-xl font-semibold tabular-nums">₹{fmt(c.price)}</div></div>
          <div><div className="text-[10px] tracking-wider text-slate-400 uppercase">Current P/E</div><div className="text-xl font-semibold tabular-nums text-emerald-600">{fmt(c.pe_now, 1)}</div></div>
        </div>
      </div>
      <div className="px-4 pb-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-slate-400">PE history{ps ? " · 2Y" : ""}</span>
        {chips.map(([l, v]) => v != null && <button key={l} onClick={() => applyPe(v)} className="px-2 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"><span className="text-amber-700">{l}</span> <b>{fmt(v, 1)}x</b></button>)}
        <span className="text-slate-300">click to apply to all years</span>
      </div>
      <div className="overflow-x-auto px-3 pb-3">
        <table className="w-full text-sm min-w-[52rem]">
          <thead className="text-xs text-slate-500 bg-slate-50"><tr>
            <th className="text-left font-semibold px-3 py-2 rounded-l">Year</th><th className="text-right font-semibold px-2">Sales ₹ Cr</th><th className="text-right font-semibold px-2">OPM %</th><th className="text-right font-semibold px-2">Net profit</th><th className="text-right font-semibold px-2">EPS (₹)</th>
            <th className="text-right font-semibold px-2 bg-amber-50">PE multiple</th><th className="text-right font-semibold px-2">Share price (₹)</th><th className="text-right font-semibold px-2">Upside</th><th className="text-right font-semibold px-2">CAGR</th><th className="text-right font-semibold px-3 rounded-r">Duration</th></tr></thead>
          <tbody>
            {rows.map(({ r, d }, i) => {
              const k = `${c.symbol}|${r.fy}`, e = edits[k] ?? {};
              return (
                <tr key={r.fy} className={`border-t border-slate-100 ${i === 0 ? "bg-emerald-50/50" : ""}`}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">FY{r.fy.slice(-4)}{d.edited && <span className="ml-1.5 text-[10px] text-indigo-600">edited</span>}</td>
                  <td className="text-right px-2"><Num v={d.sales} w="w-24" on={(n) => set(r.fy, { sales: n ?? undefined })} /><div className="text-[10px] text-slate-400">{r.sales_cagr != null && e.sales == null ? `${fmt(r.sales_cagr, 1)}% CAGR` : "\u00a0"}</div></td>
                  <td className="text-right px-2"><Num v={d.opm} w="w-16" dec={1} step={0.5} on={(n) => set(r.fy, { opm: n ?? undefined })} /><div className="text-[10px] text-amber-600">{r.opm_assumed && e.opm == null ? "not guided, held" : "\u00a0"}</div></td>
                  <td className="text-right px-2"><Num v={d.np} w="w-20" dec={0} on={(n) => set(r.fy, { np: n ?? undefined })} /><div className="text-[10px] text-slate-400">{e.np != null ? "your figure" : e.sales != null || e.opm != null ? "re-estimated" : r.np_given ? "as entered" : "estimated"}</div></td>
                  <td className="text-right px-2 tabular-nums">{fmt(d.eps, 1)}</td>
                  <td className="text-right px-2 bg-amber-50/60"><Num v={d.pe} w="w-20" dec={1} step={0.5} on={(n) => set(r.fy, { pe: n ?? undefined })} /></td>
                  <td className="text-right px-2 tabular-nums font-semibold">₹{fmt(d.price)}</td>
                  <td className={`text-right px-2 tabular-nums ${col(d.up)}`}>{sgn(d.up)}</td>
                  <td className={`text-right px-2 tabular-nums font-semibold ${col(d.cagr)}`}>{sgn(d.cagr)}</td>
                  <td className="text-right px-3 text-[11px] text-slate-500 whitespace-nowrap">{dstr(new Date())} – {dstr(d.end)} <span className="ml-1 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">{d.days}d</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Scenarios c={c} rows={rows} />
      <div className="px-4 pb-3 text-xs">
        <button onClick={() => setSrc(!src)} className="text-slate-500 underline">{src ? "Hide" : "Show"} source and assumptions</button>
        {src && (
          <div className="mt-2 space-y-1.5 text-slate-600">
            <div>Last actual ({c.last_fy}): sales ₹{fmt(c.last_sales)} Cr at {fmt(c.last_opm, 1)}% operating margin · price as of {c.price_as_of}. Editing sales or margin rebuilds net profit from last year's cost ratios; editing net profit overrides it. Edits are saved in this browser only.</div>
            {c.rows.map((r) => (
              <div key={r.fy} className="border-l-2 border-slate-300 pl-2.5">
                <div><b>FY{r.fy.slice(-4)}</b>{r.note ? ` · ${r.note}` : ""}{r.assumptions?.length ? ` · assumptions: ${r.assumptions.join("; ")}` : ""}</div>
                {r.quotes?.map((q, i) => <div key={i} className="bg-slate-50 rounded px-2 py-1 mt-1">“{q}” <span className="text-slate-400">{r.call}{r.quote_verified ? " · ✓ found in the transcript" : ""}</span></div>)}
                {r.source && !r.quotes?.length && <div className="text-slate-400">Source: {r.source}</div>}
                {r.implied_at_median != null && r.pe_user && <div className="text-amber-700">At the 5-year median P/E ({fmt(r.pe_median_5y, 1)}) the price would be ₹{fmt(r.implied_at_median)}.</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Tbl({ cos, tab }: { cos: Co[]; tab: "held" | "scan" }) {
  const [sort, setSort] = useState<"weight" | "upside">(tab === "held" ? "weight" : "upside");
  const [edits, setEditsS] = useState<Record<string, Edit>>(load);
  const setEdits = (f: (p: Record<string, Edit>) => Record<string, Edit>) => setEditsS((p) => { const n = f(p); save(n); return n; });
  const sorted = useMemo(() => [...cos].sort((a, b) => sort === "upside" ? (derive(b, b.rows[0], edits[`${b.symbol}|${b.rows[0].fy}`] ?? {}).up ?? -1e9) - (derive(a, a.rows[0], edits[`${a.symbol}|${a.rows[0].fy}`] ?? {}).up ?? -1e9) : (b.weight ?? 0) - (a.weight ?? 0)), [cos, sort, edits]);
  const chip = (on: boolean) => `px-2 py-0.5 rounded-full border text-xs ${on ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3 text-xs"><span className="text-slate-500">Sort:</span>
        {tab === "held" && <button onClick={() => setSort("weight")} className={chip(sort === "weight")}>Portfolio weight</button>}
        <button onClick={() => setSort("upside")} className={chip(sort === "upside")}>Upside</button></div>
      {sorted.map((c) => <Card key={c.symbol} c={c} edits={edits} setEdits={setEdits} />)}
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
