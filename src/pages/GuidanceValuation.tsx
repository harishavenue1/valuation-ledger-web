import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Stock } from "../lib/model";
import { useData, useScreeners } from "../App";
import { MethodologyNote, ScreenerLoading } from "../components/ScreenerTable";

// Guidance Valuation (2026-11-15, "one simple table with FY27, FY28 guidance and its upside from the current price ... a tab for companies not held ... scan NIFTY750 for FY27 revenue guidance with a confident tone, and margins").
// Rows: management guidance (sales growth or sales, margin) or the user's own inputs -> net profit -> EPS -> implied price at the 5-year median P/E (or the P/E the user entered) -> upside from today's price.
// Built by the GuidanceValuation skill (key guidanceValuation for holdings, guidanceScan750 for the Nifty 750 scan of companies not held). No model call from the site.

interface Row {
  fy: string; basis: "user" | "guidance" | "scan"; sales: number; sales_cagr: number | null; opm: number; opm_assumed: boolean; net_profit: number; np_given: boolean; pe: number | null; pe_user: boolean; pe_median_5y: number | null; shares_cr_row?: number | null;
  eps: number | null; source_url?: string | null; ppt_url?: string | null; source_page?: number | null; net_profit_low?: number; implied: number | null; implied_at_median: number | null; abs_return: number | null; price_cagr: number | null; assumptions: string[]; note?: string | null; quotes?: string[]; quote_verified?: boolean; call?: string; source?: string; tone?: string;
}
interface PeStats { min3y: number; med3y: number; max3y: number }
interface Co { symbol: string; name: string; weight?: number | null; price: number; price_as_of: string; last_fy: string; last_sales: number; last_np?: number | null; last_opm: number | null; pe_median_5y: number | null; pe_now: number | null; shares_cr?: number | null; pe_stats?: PeStats | null;
  uid?: string; calc?: { oi_pct: number; dep_pct: number; int_pct: number; tax_pct: number; adj: number }; rows: Row[] }
type PeKey = "peg" | "min" | "med" | "max" | "cur";
const fmt = (v: number | null | undefined, d = 0) => (v == null || !isFinite(v) ? "n/a" : v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d }));
const sgn = (v: number | null | undefined, d = 0) => (v == null || !isFinite(v) ? "n/a" : `${v >= 0 ? "+" : ""}${fmt(v, d)}%`);
const col = (v: number | null | undefined) => (v == null ? "text-slate-500" : v >= 0 ? "text-emerald-600" : "text-red-500");

// the P/E for one company under the header choice (falls back to the company's own P/E when that statistic does not exist for it)
function peFor(c: Co, r: Row, key: PeKey): { pe: number | null; fallback: boolean } {
  const ps = c.pe_stats;
  const pick = { peg: null as number | null, min: ps?.min3y, med: ps?.med3y, max: ps?.max3y, cur: c.pe_now }[key];
  return pick != null && pick > 0 ? { pe: pick, fallback: false } : { pe: r.pe, fallback: true };
}

const COLS: [PeKey, string][] = [["peg", "P/E = EPS growth"], ["min", "Min (3Y)"], ["med", "Median (3Y)"], ["max", "Max (3Y)"], ["cur", "Current"]];

function Tbl({ cos, tab, onRemove }: { cos: Co[]; tab: "held" | "scan" | "mine"; onRemove?: (uid: string) => void }) {
  const [lowGuide, setLowGuide] = useState(false);
  const fys = useMemo(() => Array.from(new Set(cos.flatMap((c) => c.rows.map((x) => x.fy)))).sort(), [cos]);
  const [fy, setFy] = useState<string>(fys.includes("Mar 2027") ? "Mar 2027" : fys[0] ?? "Mar 2027");
  const [sort, setSort] = useState<string>(tab === "held" ? "weight" : "min");
  const rows = useMemo(() => cos.filter((c) => c.rows.some((x) => x.fy === fy)).map((c) => {
    const r = c.rows.find((x) => x.fy === fy)!;
    const shares = r.shares_cr_row ?? c.shares_cr ?? null;
    const np = lowGuide ? (r.net_profit_low ?? r.net_profit) : r.net_profit;
    const eps = shares ? np / shares : null;
    const epsGrowth = c.last_np && c.last_np > 0 ? (np / c.last_np - 1) * 100 : null;  // shares held constant, so EPS growth = net profit growth
    const cells = COLS.map(([k]) => {
      let pe: number | null; let missing = false;
      if (k === "peg") { pe = epsGrowth != null && epsGrowth > 0 ? (epsGrowth > 100 ? 66 : epsGrowth) : null; missing = pe == null; }  // EPS growth above 100%: P/E capped at 66
      else { const x = peFor(c, r, k); pe = x.fallback ? null : x.pe; missing = pe == null; }
      const price = eps != null && pe ? eps * pe : null;
      return { k, pe, missing, price, up: price != null && c.price ? (price / c.price - 1) * 100 : null };
    });
    return { c, r, cells, epsGrowth, eps };
  }).sort((a, b) => sort === "weight" ? (b.c.weight ?? 0) - (a.c.weight ?? 0) : (b.cells.find((x) => x.k === sort)?.up ?? -1e9) - (a.cells.find((x) => x.k === sort)?.up ?? -1e9)), [cos, sort, lowGuide, fy]);
  const hidden = cos.filter((c) => !c.rows.some((x) => x.fy === fy));
  const chip = (on: boolean) => `px-2 py-0.5 rounded-full border text-xs ${on ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`;
  const th = "text-center font-semibold px-2 py-2 leading-tight align-bottom";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
        <span className="text-slate-500">Year:</span>
        {fys.map((f) => <button key={f} onClick={() => setFy(f)} className={chip(fy === f)}>FY{f.slice(-2)}</button>)}
        <span className="text-slate-500 ml-2">Sort by:</span>
        {tab === "held" && <button onClick={() => setSort("weight")} className={chip(sort === "weight")}>Portfolio weight</button>}
        <select value={sort === "weight" ? "" : sort} onChange={(e) => e.target.value && setSort(e.target.value)} className="border border-slate-300 rounded px-1.5 py-0.5 bg-white">
          <option value="">Upside at…</option>{COLS.map(([k, l]) => <option key={k} value={k}>Upside at {l}</option>)}</select>
        <label className="text-slate-600 ml-2"><input type="checkbox" checked={lowGuide} onChange={(e) => setLowGuide(e.target.checked)} className="mr-1 align-middle" />Use the low end of guidance (every column)</label>
              </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-[13px] table-fixed min-w-[105rem]">
          <colgroup>{Array.from({ length: 6 + COLS.length }).map((_, k) => <col key={k} style={{ width: `${100 / (6 + COLS.length)}%` }} />)}</colgroup>
          <thead className="text-xs text-slate-500 bg-slate-50"><tr>
            <th className="text-left font-semibold px-3 py-2 sticky left-0 bg-slate-50 z-10">Company</th><th className={th}>Price</th><th className={th} title="Sales for the selected year in ₹ Cr, and growth against the last full year">Revenue ₹ Cr | growth</th><th className={th}>OPM</th><th className={th} title="EPS in ₹ for the selected year, and growth against last year's at today's share count (so equal to net-profit growth)">EPS ₹ | growth</th>
            {COLS.map(([k, l]) => <th key={k} className={`${th} ${k === "min" ? "bg-sky-50 text-sky-800" : k === "peg" ? "bg-violet-50 text-violet-800" : k === "cur" ? "bg-slate-100" : ""}`} title={k === "peg" ? "Upside if the stock is priced at a P/E equal to its EPS growth % (PEG = 1): 50% EPS growth means a P/E of 50. If EPS growth is above 100% the P/E is capped at 66. Not available when EPS growth is zero or negative." : k === "min" ? "Price and upside if the multiple falls to the stock's own 2-year minimum. Positive means upside remains even then." : undefined}>{l}</th>)}
            <th className="text-left font-semibold px-3">Basis</th></tr></thead>
          <tbody>
            {rows.map(({ c, r, cells, epsGrowth, eps }) => {
              return (
                <tr key={c.symbol} className="h-9 border-t border-slate-100 hover:bg-slate-50 align-middle">
                  <td className="px-3 py-0 sticky left-0 bg-white z-10 whitespace-nowrap"><Link to={`/company/${c.symbol}`} className="font-medium text-indigo-700 hover:underline">{c.name}</Link>{onRemove && c.uid && <button onClick={() => onRemove(c.uid!)} className="ml-2 text-slate-300 hover:text-red-500" title="Remove this row">✕</button>}</td>
                  <td className="text-center px-2 py-0 tabular-nums whitespace-nowrap"><a href={`https://www.tradingview.com/chart/?symbol=NSE%3A${encodeURIComponent(c.symbol)}`} target="_blank" rel="noreferrer" className="text-slate-700 hover:text-indigo-700 hover:underline" title="Open the chart on TradingView">₹{fmt(c.price)} ↗</a></td>
                  <td className="text-center px-2 py-0 tabular-nums whitespace-nowrap">{fmt(r.sales)} <span className={col(r.sales_cagr)}>{sgn(r.sales_cagr)}</span></td>
                  <td className="text-center px-2 py-0 tabular-nums">{fmt(r.opm, 0)}%{r.opm_assumed && <span className="text-amber-600" title="Margin not guided: last year's held"> *</span>}</td>
                  <td className="text-center px-2 py-0 tabular-nums whitespace-nowrap">{eps != null ? `₹${fmt(eps, 1)}` : "n/a"} <span className={col(epsGrowth)}>{sgn(epsGrowth)}</span></td>
                  {cells.map((x) => (
                    <td key={x.k} className={`text-center px-2 py-0 tabular-nums ${x.k === "min" ? "bg-sky-50/50" : x.k === "peg" ? "bg-violet-50/50" : ""}`}>
                      {x.missing ? <span className="text-slate-300">n/a</span> : (
                        <span className={`font-medium ${col(x.up)}`} title={`₹${fmt(x.price)} at ${fmt(x.pe, 1)}x P/E`}>{sgn(x.up)}</span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-0 text-[12px] leading-none whitespace-nowrap">
                    {r.basis === "user" ? (
                      <a href={r.source_url ?? "#"} target="_blank" rel="noreferrer" className="px-2 py-[3px] rounded-full border border-slate-300 bg-slate-50 text-slate-600 hover:border-slate-400" title="Your own inputs; the link opens the company's Screener page">your input ↗</a>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 leading-none">
                        <a href={r.source_url ? (r.source_page ? `${r.source_url}#page=${r.source_page}` : r.source_url) : "#"} target="_blank" rel="noreferrer" className="px-2 py-[3px] rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" title={`${r.call ?? ""} concall transcript${r.source_page ? `, page ${r.source_page}` : ""}. ${(r.quotes ?? []).join("  |  ")}`}>concall{r.call ? ` ${r.call.replace("-", " ")}` : ""}{r.quote_verified ? " ✓" : ""} ↗</a>
                        {r.ppt_url && <a href={r.ppt_url} target="_blank" rel="noreferrer" className="text-slate-500 underline" title="Investor presentation for that call">PPT</a>}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hidden.length > 0 && <div className="text-[11px] text-slate-500 mt-2">Not shown (no row for this year): {hidden.map((c) => `${c.name} (${c.rows.map((x) => "FY" + x.fy.slice(-4)).join(", ")})`).join(", ")}.</div>}
      <div className="text-[11px] text-slate-400 mt-2">Each P/E column is the upside against today's price if the guided FY27 EPS is priced at that P/E (hover a figure for the price and the P/E; "n/a" = no history for that statistic). The violet column prices the stock at a P/E equal to its EPS growth % (PEG = 1), capped at 66 when EPS growth is above 100%. The blue Min column is the downside case: positive there means upside remains even at the lowest recent multiple. Click a company for its quarterly, annual and CAGR-estimator page. * operating margin not guided, last year's held. Guidance is management's, often optimistic; a reading aid, not a recommendation.</div>
    </div>
  );
}

// "My inputs": the user picks a company already in the app, a year and a sales / margin / profit view; the P/E history, price, share count and last-year cost ratios come from the app's own stock record
interface Entry { id: string; ticker: string; fy: number; mode: "cr" | "growth"; sales?: number; opm?: number; np?: number }
function loadMine(): Entry[] { try { return JSON.parse(localStorage.getItem("gv_mine") || "[]"); } catch { return []; } }
function saveMine(e: Entry[]) { try { localStorage.setItem("gv_mine", JSON.stringify(e)); } catch { /* storage unavailable */ } }

function coFromStock(st: Stock, e: Entry): Co | null {
  const yrs = st.years ?? [];
  let li = -1;
  for (let i = yrs.length - 1; i >= 0; i--) if (/^Mar \d{4}$/.test(yrs[i]) && st.revenue[i] != null) { li = i; break; }
  if (li < 0 || st.current_price == null || e.sales == null) return null;
  const lastFy = Number(yrs[li].slice(-4)), n = e.fy - lastFy, ls = st.revenue[li] as number;
  if (n <= 0 || !ls) return null;
  const sales = e.mode === "cr" ? e.sales : ls * Math.pow(1 + e.sales / 100, n);
  const pctOf = (a: (number | null)[]) => (a[li] != null ? ((a[li] as number) / ls) * 100 : 0);
  const opm = e.opm ?? (st.opm_pct[li] ?? 0);
  const tx = st.tax_pct[li] != null && (st.tax_pct[li] as number) >= 10 && (st.tax_pct[li] as number) <= 40 ? (st.tax_pct[li] as number) : 25.2;
  const np = e.np ?? ((sales * (opm + pctOf(st.other_income) - pctOf(st.depreciation) - pctOf(st.interest))) / 100) * (1 - tx / 100);
  const npLast = st.net_profit[li] as number | null;
  const shares = st.shares_cr?.[li] ?? (npLast && st.eps[li] ? npLast / (st.eps[li] as number) : null);
  const ph = st.pe_history;
  return {
    uid: e.id, symbol: st.ticker, name: st.name, weight: null, price: st.current_price, price_as_of: new Date().toISOString().slice(0, 10), last_fy: yrs[li], last_sales: ls, last_np: npLast, last_opm: st.opm_pct[li] ?? null,
    pe_median_5y: null, pe_now: st.pe_ratio, shares_cr: shares,
    pe_stats: ph ? { min3y: ph.min, med3y: ph.median, max3y: ph.max } : null,
    rows: [{ fy: `Mar ${e.fy}`, basis: "user", sales, sales_cagr: (Math.pow(sales / ls, 1 / n) - 1) * 100, opm, opm_assumed: e.opm == null, net_profit: np, np_given: e.np != null, pe: ph?.median ?? st.pe_ratio, pe_user: false, pe_median_5y: null, shares_cr_row: shares, eps: null, implied: null, implied_at_median: null, abs_return: null, price_cagr: null,
      assumptions: [], source_url: st.base_url ?? `https://www.screener.in/company/${st.ticker}/` }],
  };
}

function MyTab({ stocks }: { stocks: Record<string, Stock> }) {
  const [list, setList] = useState<Entry[]>(loadMine);
  const [q, setQ] = useState(""); const [fy, setFy] = useState(2027); const [mode, setMode] = useState<"cr" | "growth">("growth");
  const [sales, setSales] = useState(""); const [opm, setOpm] = useState(""); const [np, setNp] = useState("");
  const names = useMemo(() => Object.values(stocks).sort((a, b) => a.name.localeCompare(b.name)), [stocks]);
  const hit = useMemo(() => { const t = q.trim().toLowerCase(); return t ? names.find((x) => x.ticker.toLowerCase() === t || x.name.toLowerCase() === t) ?? null : null; }, [q, names]);
  const ph = hit?.pe_history;
  const num = (v: string) => (v.trim() === "" || isNaN(Number(v)) ? undefined : Number(v));
  const add = () => {
    if (!hit || num(sales) == null) return;
    const e: Entry = { id: `${hit.ticker}-${fy}-${Date.now()}`, ticker: hit.ticker, fy, mode, sales: num(sales), opm: num(opm), np: num(np) };
    const n = [...list, e]; setList(n); saveMine(n); setSales(""); setOpm(""); setNp("");
  };
  const remove = (id: string) => { const n = list.filter((x) => x.id !== id); setList(n); saveMine(n); };
  const cos = useMemo(() => list.map((e) => (stocks[e.ticker] ? coFromStock(stocks[e.ticker], e) : null)).filter((c): c is Co => c != null), [list, stocks]);
  const inp = "border border-slate-300 rounded px-2 py-0 text-sm bg-white";
  return (
    <div>
      <div className="rounded-lg border border-slate-200 bg-white p-3 mb-3">
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="text-slate-500">Company<input list="gv-co" value={q} onChange={(e) => setQ(e.target.value)} placeholder="name or ticker" className={`${inp} block w-56 mt-0.5`} /></label>
          <datalist id="gv-co">{names.map((x) => <option key={x.ticker} value={x.ticker}>{x.name}</option>)}</datalist>
          <label className="text-slate-500">FY<select value={fy} onChange={(e) => setFy(Number(e.target.value))} className={`${inp} block mt-0.5`}>{[2027, 2028, 2029, 2030].map((y) => <option key={y} value={y}>FY{String(y).slice(-2)}</option>)}</select></label>
          <label className="text-slate-500"><select value={mode} onChange={(e) => setMode(e.target.value as "cr" | "growth")} className="border-0 bg-transparent text-xs text-slate-500 p-0"><option value="growth">Sales growth %</option><option value="cr">Sales ₹ Cr</option></select>
            <input value={sales} onChange={(e) => setSales(e.target.value)} placeholder={mode === "growth" ? "e.g. 25" : "e.g. 1800"} className={`${inp} block w-28 mt-0.5`} /></label>
          <label className="text-slate-500">OPM % <span className="text-slate-300">(optional)</span><input value={opm} onChange={(e) => setOpm(e.target.value)} placeholder="last year's" className={`${inp} block w-24 mt-0.5`} /></label>
          <label className="text-slate-500">Net profit ₹ Cr <span className="text-slate-300">(optional)</span><input value={np} onChange={(e) => setNp(e.target.value)} placeholder="estimated" className={`${inp} block w-28 mt-0.5`} /></label>
          <button onClick={add} disabled={!hit || num(sales) == null} className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-40">Add row</button>
        </div>
        {q.trim() && !hit && <div className="text-xs text-amber-700 mt-2">No company called “{q.trim()}” in this app yet. Add it from the Companies page first, and it will appear in this list.</div>}
        {hit && (
          <div className="text-xs text-slate-500 mt-2 flex flex-wrap gap-x-4 gap-y-0.5">
            <span><b className="text-slate-700">{hit.name}</b> · ₹{fmt(hit.current_price)} · P/E now {fmt(hit.pe_ratio, 1)}</span>
            {ph ? <span>P/E history ({(ph as { window_years?: number }).window_years ?? 2}Y{(ph as { window_years?: number }).window_years === 3 ? "" : ", old window until this company is next refreshed"}): min {fmt(ph.min, 1)} · median {fmt(ph.median, 1)} · max {fmt(ph.max, 1)}</span> : <span>No P/E history stored for this company.</span>}
          </div>
        )}
        <div className="text-[11px] text-slate-400 mt-2">Sales growth is applied to the last full year; leave OPM and net profit blank to hold last year's margin and rebuild profit from last year's depreciation, interest, other income and tax. Rows are saved in this browser.</div>
      </div>
      {cos.length ? <Tbl cos={cos} tab="mine" onRemove={remove} /> : <div className="text-sm text-slate-500">No rows yet. Pick a company above, choose the year, enter the sales view and press Add row.</div>}
    </div>
  );
}


export default function GuidanceValuation() {
  const { bundle } = useData();
  const { ready } = useScreeners(["guidanceValuation", "guidanceScan750"]);
  const held = ((bundle.momentum_screeners.guidanceValuation?.rows ?? []) as Co[]);
  const scan = ((bundle.momentum_screeners.guidanceScan750?.rows ?? []) as Co[]);
  const [tab, setTab] = useState<"held" | "scan" | "mine">("held");
  const tabBtn = (t: "held" | "scan" | "mine", label: string) => <button onClick={() => setTab(t)} className={`px-3 py-0 rounded-t border-b-2 text-sm ${tab === t ? "border-indigo-600 text-indigo-700 font-medium" : "border-transparent text-slate-500 hover:text-slate-700"}`}>{label}</button>;
  return (
    <div>
      <div className="flex items-center gap-2 mb-1"><h1 className="text-xl font-semibold">🎯 Guidance Valuation</h1><span className="text-slate-500 text-sm">management guidance → earnings → implied price → upside from today's price</span></div>
      <div className="flex items-center gap-2 mb-3">{bundle.momentum_screeners.guidanceValuation?.as_of && <span className="text-xs text-slate-400">guidance read {bundle.momentum_screeners.guidanceValuation.as_of}{(bundle.momentum_screeners.guidanceValuation as any).prices_as_of ? ` · prices as of ${(bundle.momentum_screeners.guidanceValuation as any).prices_as_of} (NSE close)` : ""}</span>}</div>
      <MethodologyNote>
        <p className="mb-2"><b>How a row is built.</b> Sales come from what management guided for FY27 (a sales figure, or a growth rate applied to the last full year; a range uses its midpoint). Operating margin is the guided one when management gave it, otherwise last year's is held (marked *). Net profit is guided operating profit less depreciation, interest, other income and tax held at last year's share of sales (or your own net profit where you entered it). EPS uses today's share count.</p>
        <p className="mb-2"><b>One column per P/E.</b> Each column prices that EPS at a P/E from the company's own history (3-year min, median, max and today's) and shows the upside against today's price. The Min column is the downside case: positive there means upside remains even at the lowest recent multiple. A ✓ on the basis means the guidance quote was found word for word in the concall transcript; hover for it.</p>
        <p><b>Limits.</b> The P/E moves the answer more than the guidance does, which is why every option is shown. Guidance is management's, often optimistic, and most margins here are last year's held; this is a reading aid, not a recommendation.</p>
      </MethodologyNote>
      <div className="flex gap-1 border-b border-slate-200 mb-3">{tabBtn("held", `Held (${held.length})`)}{tabBtn("scan", `Not held · Nifty 750 scan (${scan.length})`)}{tabBtn("mine", "My inputs")}</div>
      {tab === "mine" ? <MyTab stocks={bundle.stocks} /> : !ready ? <ScreenerLoading label="Guidance Valuation" /> : tab === "held" ? (held.length ? <Tbl cos={held} tab="held" /> : <div className="text-sm text-slate-500">No rows yet.</div>) : scan.length ? <Tbl cos={scan} tab="scan" /> : (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-700">The Nifty 750 scan has not been run yet. It reads the latest concall of each Nifty 750 company you do not hold, keeps those where management gave a FY27 revenue figure with a confident tone (and any margin), and adds them here. Ask Claude Code: “run the Guidance scan on Nifty 750”.</div>
      )}
    </div>
  );
}
