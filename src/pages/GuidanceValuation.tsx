import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData, useScreeners } from "../App";
import { MethodologyNote, ScreenerLoading } from "../components/ScreenerTable";

// Guidance Valuation (2026-11-15, "one simple table with FY27, FY28 guidance and its upside from the current price ... a tab for companies not held ... scan NIFTY750 for FY27 revenue guidance with a confident tone, and margins").
// Rows: management guidance (sales growth or sales, margin) or the user's own inputs -> net profit -> EPS -> implied price at the 5-year median P/E (or the P/E the user entered) -> upside from today's price.
// Built by the GuidanceValuation skill (key guidanceValuation for holdings, guidanceScan750 for the Nifty 750 scan of companies not held). No model call from the site.

interface Row {
  fy: string; basis: "user" | "guidance" | "scan"; sales: number; sales_cagr: number | null; opm: number; opm_assumed: boolean; net_profit: number; np_given: boolean; pe: number | null; pe_user: boolean; pe_median_5y: number | null;
  eps: number | null; implied: number | null; implied_at_median: number | null; abs_return: number | null; price_cagr: number | null; assumptions: string[]; note?: string | null; quotes?: string[]; quote_verified?: boolean; call?: string; source?: string; tone?: string;
}
interface Co { symbol: string; name: string; weight?: number | null; price: number; price_as_of: string; last_fy: string; last_sales: number; last_opm: number | null; pe_median_5y: number | null; pe_now: number | null; rows: Row[] }

const fmt = (v: number | null | undefined, d = 0) => (v == null ? "n/a" : v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d }));
const pc = (v: number | null | undefined) => (v == null ? "n/a" : `${v > 0 ? "" : ""}${fmt(v, 0)}%`);
const col = (v: number | null | undefined) => (v == null ? "" : v >= 0 ? "text-emerald-600" : "text-red-500");

function Tbl({ cos, tab }: { cos: Co[]; tab: "held" | "scan" }) {
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<"weight" | "upside">(tab === "held" ? "weight" : "upside");
  const flat = useMemo(() => {
    const f = cos.flatMap((c) => c.rows.map((r) => ({ c, r })));
    return f.sort((a, b) => (sort === "upside" ? (b.r.abs_return ?? -1e9) - (a.r.abs_return ?? -1e9) : (b.c.weight ?? 0) - (a.c.weight ?? 0)));
  }, [cos, sort]);
  const chip = (on: boolean) => `px-2 py-0.5 rounded-full border text-xs ${on ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2 text-xs"><span className="text-slate-500">Sort:</span>
        {tab === "held" && <button onClick={() => setSort("weight")} className={chip(sort === "weight")}>Portfolio weight</button>}
        <button onClick={() => setSort("upside")} className={chip(sort === "upside")}>Upside</button></div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm min-w-[56rem]">
          <thead className="text-xs text-slate-500 bg-slate-50"><tr>
            <th className="text-left font-medium px-3 py-2">Company</th><th className="text-right font-medium px-2">Year</th><th className="text-right font-medium px-2">Sales ₹ Cr</th><th className="text-right font-medium px-2">OPM</th><th className="text-right font-medium px-2">Net profit</th>
            <th className="text-right font-medium px-2" title="P/E used. 5-year median unless you entered one; the median and today's P/E are shown under it">P/E</th><th className="text-right font-medium px-2">Implied price</th><th className="text-right font-medium px-2" title="Years counted as at least one, like your Screener table">Price CAGR</th><th className="text-right font-medium px-3">Absolute return</th><th className="px-2">Basis</th></tr></thead>
          <tbody>
            {flat.map(({ c, r }) => {
              const id = `${c.symbol}-${r.fy}`;
              return (
                <Fragment key={id}>
                  <tr onClick={() => setOpen(open === id ? null : id)} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer align-top">
                    <td className="px-3 py-2"><Link to={`/company/${c.symbol}`} onClick={(e) => e.stopPropagation()} className="font-medium text-indigo-700 hover:underline">{c.name}</Link><div className="text-[11px] text-slate-400">{c.symbol}{c.weight != null ? ` · ${c.weight.toFixed(1)}% of portfolio` : ""}</div></td>
                    <td className="text-right px-2 py-2 whitespace-nowrap">{r.fy}</td>
                    <td className="text-right px-2 py-2 tabular-nums">{fmt(r.sales)}<div className="text-[11px] text-slate-400">{r.sales_cagr != null ? `${fmt(r.sales_cagr, 1)}% CAGR` : ""}</div></td>
                    <td className="text-right px-2 py-2 tabular-nums">{fmt(r.opm, 0)}%{r.opm_assumed && <div className="text-[11px] text-amber-600" title="Not guided: last year's margin held">held</div>}</td>
                    <td className="text-right px-2 py-2 tabular-nums">{fmt(r.net_profit, 0)}<div className="text-[11px] text-slate-400">{r.np_given ? "as entered" : "estimated"}</div></td>
                    <td className="text-right px-2 py-2 tabular-nums">{fmt(r.pe, 0)}<div className="text-[11px] text-slate-400">median {fmt(r.pe_median_5y, 0)} · now {fmt(c.pe_now, 0)}</div></td>
                    <td className="text-right px-2 py-2 tabular-nums font-medium">{fmt(r.implied)}<div className="text-[11px] text-slate-400 font-normal">₹{fmt(c.price)} today</div></td>
                    <td className={`text-right px-2 py-2 tabular-nums ${col(r.price_cagr)}`}>{pc(r.price_cagr)}</td>
                    <td className={`text-right px-3 py-2 tabular-nums font-medium ${col(r.abs_return)}`}>{pc(r.abs_return)}</td>
                    <td className="px-2 py-2 text-[11px] whitespace-nowrap">{r.basis === "user" ? <span className="px-1.5 py-0.5 rounded-full border border-slate-300 bg-slate-50 text-slate-600">your input</span> : <span className="px-1.5 py-0.5 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700">mgmt guidance{r.quote_verified ? " ✓" : ""}</span>}</td>
                  </tr>
                  {open === id && (
                    <tr className="bg-slate-50/70"><td colSpan={10} className="px-4 py-3 text-xs text-slate-600 space-y-1.5">
                      <div>Last actual ({c.last_fy}): sales ₹{fmt(c.last_sales)} Cr at {fmt(c.last_opm, 1)}% operating margin · EPS this row ₹{fmt(r.eps, 1)} · price as of {c.price_as_of}</div>
                      {r.implied_at_median != null && r.pe_user && <div className="text-amber-700">At the 5-year median P/E ({fmt(r.pe_median_5y, 1)}) the implied price would be ₹{fmt(r.implied_at_median)} instead of ₹{fmt(r.implied)} ({pc((r.implied_at_median / c.price - 1) * 100)}), because you used P/E {fmt(r.pe, 0)}.</div>}
                      {r.note && <div>{r.note}</div>}
                      {!!r.assumptions?.length && <div>Assumptions: {r.assumptions.join("; ")}</div>}
                      {r.quotes?.map((q, i) => <div key={i} className="border-l-2 border-slate-300 bg-white pl-2.5 py-1 rounded-r">“{q}” <span className="text-slate-400">{r.call}{r.quote_verified ? " · ✓ found in the transcript" : ""}</span></div>)}
                      {r.source && !r.quotes?.length && <div>Source: {r.source}</div>}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
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
        <p className="mb-2"><b>Price CAGR</b> counts at least one year, like your Screener table, so FY27 shows the same number as the absolute return. A ✓ means the guidance quote was found word for word in the concall transcript; click a row to read it.</p>
        <p><b>Limits.</b> A median P/E can be far from today's multiple (high-growth names look expensive against their own history), so the “upside” is as much a statement about P/E as about guidance. Guidance is management's, often optimistic; this is a reading aid, not a recommendation.</p>
      </MethodologyNote>
      <div className="flex gap-1 border-b border-slate-200 mb-3">{tabBtn("held", `Held (${held.length})`)}{tabBtn("scan", `Not held · Nifty 750 scan (${scan.length})`)}</div>
      {!ready ? <ScreenerLoading label="Guidance Valuation" /> : tab === "held" ? (held.length ? <Tbl cos={held} tab="held" /> : <div className="text-sm text-slate-500">No rows yet.</div>) : scan.length ? <Tbl cos={scan} tab="scan" /> : (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-700">The Nifty 750 scan has not been run yet. It reads the latest concall of each Nifty 750 company you do not hold, keeps those where management gave a FY27 revenue figure with a confident tone (and any margin), and adds them here. Ask Claude Code: “run the Guidance scan on Nifty 750”.</div>
      )}
    </div>
  );
}
