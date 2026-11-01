import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useData, useScreeners } from "../App";
import { ScreenerLoading } from "../components/ScreenerTable";
import { ConvictionBar, DeltaBars, Guard, GrowthBars, MarginLine, MiniFromHigh, RsiMeter, RuleDots, RuleTiles, StatTile, TrendBars, VIZ_CSS, fmtSigned, type Num } from "../components/DebateViz";
import { MgmtTab, kept, keptColor, type Mgmt } from "../components/DebateMgmt";

// Research Debate — added 2026-11-01 ("lets build ai agents or agent workflows for our app"). Redesigned the same day twice: first as charts instead of words, then (after "totally cluttered")
// from a stack of 29 tall cards into a list + detail layout: the list on the left to pick a stock, and on the right the answer first (verdict, headline, key numbers) with the evidence in four
// tabs — Debate, Business, Price, Management — so only one kind of evidence is on screen at a time.
//
// The StockDebate skill (~/.claude/skills/StockDebate) builds an evidence pack for each stock from this app's own data, has a bull, a bear and a fact-checker argue
// from it, and pushes the verdict here as the `stockDebate` key. Each verdict carries a `metrics` snapshot computed by CODE from that same pack (growth series,
// margin series, distance from the moving averages, RSI, P/E, ROCE...), which is what the charts draw — so a picture can never disagree with what the agents read,
// and the rule checks shown are the code's, not the model's. `mgmt` (management and capital allocation) is built by code too (scripts/mgmt_block.py). Nothing is generated
// in the browser and no model key lives in this app. An AI reading of stored numbers, never advice or an order.

type Point = { tag?: string; point: string; evidence: string };
interface Metrics {
  partial?: boolean;
  quarters?: { labels: string[]; sales: Num[]; op: Num[]; np: Num[]; opm: Num[] } | null;
  latest?: { sales: Num; np: Num; eps: Num } | null;
  margin_latest?: { quarter?: string; opm?: number | null; opm_qoq?: number | null; opm_yoy?: number | null; gpm?: number | null; gpm_qoq?: number | null; gpm_yoy?: number | null; source?: string } | null;
  tech?: Record<string, number | null> | null;
  val?: { mcap_cr: number | null; pe: number | null; roce: number | null; roce_chg_1y: number | null; roe: number | null; borrowings_cr: number | null; wc_days: number | null };
  pos?: { weight: number | null; pnl_pct: number | null; hold_days: number | null };
}
type Verdict = {
  symbol: string;
  name?: string;
  as_of: string;
  verdict: "Strong candidate" | "Watch" | "Avoid";
  conviction: number;
  headline?: string;
  summary: string;
  bull: Point[];
  bear: Point[];
  risks: string[];
  rule_check?: Record<string, boolean | null>;
  change_my_mind?: string;
  data_gaps?: string[];
  fact_check_dropped?: string[];
  held?: boolean;
  metrics?: Metrics;
  mgmt?: Mgmt;
};

const BADGE: Record<string, string> = { "Strong candidate": "bg-emerald-100 text-emerald-700", Watch: "bg-amber-100 text-amber-700", Avoid: "bg-red-100 text-red-700" };
const VCOLOR: Record<string, string> = { "Strong candidate": "var(--good)", Watch: "var(--warn)", Avoid: "var(--crit)" };
const ORDER: Record<string, number> = { "Strong candidate": 0, Watch: 1, Avoid: 2 };
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const firstSentence = (s: string) => (s.match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim();
const short = (s: string, n = 54) => (s.length <= n ? s : s.slice(0, s.lastIndexOf(" ", n) > 20 ? s.lastIndexOf(" ", n) : n) + "…");
const cr = (v: number | null | undefined) => (!isNum(v) ? "—" : v >= 1000 ? `₹${(v / 1000).toFixed(1)}k Cr` : `₹${Math.round(v)} Cr`);
const pct = (v: Num, d = 1) => (v === "T" ? "T" : isNum(v) ? `${fmtSigned(v, d)}%` : "—");
/** a series may be missing (financial companies publish no operating margin) — always hand the charts real arrays of the right length */
const arr = (x: unknown, n: number): Num[] => (Array.isArray(x) ? (x as Num[]) : Array(n).fill(null));
type Quarters = { labels: string[]; sales: Num[]; op: Num[]; np: Num[]; opm: Num[] };
const normQuarters = (q: Metrics["quarters"]): Quarters | null => {
  const n = Array.isArray(q?.labels) ? q!.labels.length : 0;
  return q && n ? { labels: q.labels, sales: arr(q.sales, n), op: arr(q.op, n), np: arr(q.np, n), opm: arr(q.opm, n) } : null;
};
const headlineOf = (v: Verdict) => v.headline || short(firstSentence(v.summary), 120);

const Muted = ({ children }: { children: ReactNode }) => <div style={{ fontSize: 12, color: "var(--muted)" }}>{children}</div>;
function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="dbv-panel">
      <div className="dbv-panel-h"><h3>{title}</h3>{hint && <span>{hint}</span>}</div>
      {children}
    </section>
  );
}

/** every number behind the charts, as a table (the text alternative to the pictures) */
function NumbersTable({ q }: { q: Quarters }) {
  const cell = { padding: "4px 10px", textAlign: "right" as const, fontSize: 11.5, whiteSpace: "nowrap" as const };
  return (
    <div className="overflow-x-auto">
      <table style={{ borderCollapse: "collapse", color: "var(--ink)" }}>
        <thead>
          <tr style={{ color: "var(--ink2)" }}>
            <th style={{ ...cell, textAlign: "left" }}>Quarter</th>
            {q.labels.map((l) => <th key={l} style={cell}>{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {([["Sales growth (YoY)", q.sales, true], ["Operating profit growth (YoY)", q.op, true], ["Net profit growth (YoY)", q.np, true], ["Operating margin", q.opm, false]] as [string, Num[], boolean][]).map(([name, row, signed]) => (
            <tr key={name} style={{ borderTop: "1px solid var(--grid)" }}>
              <td style={{ ...cell, textAlign: "left", color: "var(--ink2)" }}>{name}</td>
              {row.map((v, i) => <td key={i} style={cell}>{signed ? pct(v) : isNum(v) ? `${v.toFixed(1)}%` : "—"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// the tabs

function Case({ title, items, kind }: { title: string; items: Point[]; kind: "bull" | "bear" }) {
  const color = kind === "bull" ? "var(--pos)" : "var(--neg)";
  return (
    <section className="dbv-case" style={{ borderTop: `3px solid ${color}` }}>
      <h3 style={{ color: "var(--ink)" }}><span style={{ color }}>{kind === "bull" ? "▲" : "▼"}</span>{title}<span style={{ fontWeight: 400, color: "var(--muted)" }}>{items.length}</span></h3>
      <ul>
        {items.map((p, i) => (
          <li key={i}>
            {p.tag && <span className="dbv-tag">{p.tag}</span>}
            <div className="dbv-pt">{p.point}</div>
            <div className="dbv-ev">↳ {p.evidence}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DebateTab({ v }: { v: Verdict }) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--ink)", maxWidth: "72ch" }}>{v.summary}</p>
      <div className="dbv-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <Case title="Bull case" items={v.bull} kind="bull" />
        <Case title="Bear case" items={v.bear} kind="bear" />
      </div>
      {v.risks?.length > 0 && (
        <Panel title="Biggest risks">
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)" }}>{v.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </Panel>
      )}
      {v.change_my_mind && (
        <div style={{ borderLeft: "3px solid var(--pos)", background: "var(--wash)", borderRadius: "0 8px 8px 0", padding: "10px 14px", fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)" }}>
          <b style={{ display: "block", fontSize: 11.5, color: "var(--ink2)", marginBottom: 2 }}>What would change this</b>{v.change_my_mind}
        </div>
      )}
      {((v.data_gaps?.length ?? 0) > 0 || (v.fact_check_dropped?.length ?? 0) > 0) && (
        <details>
          <summary>What the data did not cover, and what the fact-check removed</summary>
          <div style={{ marginTop: 8, display: "grid", gap: 6, fontSize: 12, lineHeight: 1.5, color: "var(--ink2)" }}>
            {v.data_gaps && v.data_gaps.length > 0 && <div><b>Not covered by the data: </b>{v.data_gaps.join("; ")}</div>}
            {v.fact_check_dropped && v.fact_check_dropped.length > 0 && <div><b>Removed or softened by the fact-check: </b>{v.fact_check_dropped.join("; ")}</div>}
          </div>
        </details>
      )}
    </div>
  );
}

function BusinessTab({ m, q }: { m: Metrics; q: Quarters | null }) {
  const ml = m.margin_latest;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="dbv-grid">
        <Panel title="Growth vs a year ago" hint="last quarters">
          {q ? <GrowthBars labels={q.labels} sales={q.sales} op={q.op} np={q.np} /> : m.latest ? (
            <div className="flex flex-wrap gap-2">
              <StatTile label="Sales growth" value={pct(m.latest.sales)} sub="latest quarter" />
              <StatTile label="Net profit growth" value={pct(m.latest.np)} sub="latest quarter" />
              <StatTile label="EPS growth" value={pct(m.latest.eps)} sub="latest quarter" />
            </div>
          ) : <Muted>No growth data.</Muted>}
        </Panel>
        <Panel title="Operating margin" hint="quarterly">
          {q && q.opm.some(isNum) ? <MarginLine labels={q.labels} opm={q.opm} /> : ml && isNum(ml.opm) ? (
            <div>
              <div className="flex flex-wrap gap-2">
                <StatTile label="Operating margin" value={`${ml.opm.toFixed(1)}%`} sub={isNum(ml.opm_qoq) || isNum(ml.opm_yoy) ? `${isNum(ml.opm_qoq) ? `${fmtSigned(ml.opm_qoq)} vs last quarter` : ""}${isNum(ml.opm_qoq) && isNum(ml.opm_yoy) ? " · " : ""}${isNum(ml.opm_yoy) ? `${fmtSigned(ml.opm_yoy)} vs a year ago` : ""}` : undefined} subGood={isNum(ml.opm_yoy) ? ml.opm_yoy >= 0 : null} />
                {isNum(ml.gpm) && <StatTile label="Gross margin" value={`${ml.gpm.toFixed(1)}%`} sub={isNum(ml.gpm_yoy) ? `${fmtSigned(ml.gpm_yoy)} vs a year ago` : undefined} subGood={isNum(ml.gpm_yoy) ? ml.gpm_yoy >= 0 : null} />}
              </div>
              <p className="dbv-note">Latest quarter only{ml.quarter ? ` (${ml.quarter})` : ""}: this company has no six-quarter margin series in the data.</p>
            </div>
          ) : <Muted>No operating-margin series for this stock (financial companies, such as banks and exchanges, do not report one).</Muted>}
        </Panel>
      </div>
      {q && (
        <details>
          <summary>The numbers behind the charts</summary>
          <div style={{ marginTop: 8 }}><NumbersTable q={q} /></div>
        </details>
      )}
    </div>
  );
}

const MOVES: [string, string][] = [["1 week", "w_pct_1w"], ["1 month", "w_pct_1m"], ["3 months", "w_pct_3m"], ["6 months", "w_pct_6m"], ["1 year", "yearly_pct"]];
function PriceTab({ m }: { m: Metrics }) {
  const t = m.tech;
  if (!t) return <Muted>No price data for this stock.</Muted>;
  return (
    <div className="dbv-grid">
      <Panel title="Weekly RSI" hint="the tick is your 66 bar"><RsiMeter rsi={t.rsi_w} /></Panel>
      <Panel title="Against its moving averages" hint="above or below"><TrendBars tech={t} /></Panel>
      <Panel title="Price change" hint="over each period"><DeltaBars rows={MOVES.map(([label, k]) => ({ label, value: t[k] }))} /></Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// the detail pane

type Tab = "debate" | "business" | "price" | "mgmt";
const TABS: Tab[] = ["debate", "business", "price", "mgmt"];

function Kpi({ label, value, sub, subGood, onClick, title }: { label: string; value: ReactNode; sub?: ReactNode; subGood?: boolean | null; onClick?: () => void; title?: string }) {
  const body = (
    <>
      <div style={{ fontSize: 11, color: "var(--ink2)" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: "var(--ink)", lineHeight: 1.3 }}>{value}</div>
      <div style={{ fontSize: 11, minHeight: 15, color: subGood === true ? "var(--good-text)" : subGood === false ? "var(--crit)" : "var(--muted)" }}>{sub ?? ""}</div>
    </>
  );
  return onClick ? <button className="dbv-kpi" onClick={onClick} title={title}>{body}</button> : <div className="dbv-kpi" title={title}>{body}</div>;
}

function Detail({ v, tab, setTab }: { v: Verdict; tab: Tab; setTab: (t: Tab) => void }) {
  const m = v.metrics ?? {};
  const q = normQuarters(m.quarters);
  const { val, pos } = m;
  const k = kept(v.mgmt);
  const labels: Record<Tab, ReactNode> = {
    debate: <>Debate<span className="n">{v.bull.length} for · {v.bear.length} against</span></>,
    business: "Business",
    price: "Price",
    mgmt: <>Management{k && <span className="n" style={{ color: keptColor(k.passed, k.scored), fontWeight: 600 }}>{k.passed}/{k.scored}</span>}</>,
  };
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const next = e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length] : null;
    if (next) { e.preventDefault(); setTab(next); document.getElementById(`dbv-tab-${next}`)?.focus(); }
  };
  return (
    <article id="dbv-detail" className="dbv-detail" aria-label={`${v.symbol} research debate`}>
      <header className="dbv-dhead">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--ink)", lineHeight: 1.2 }}>{v.symbol}</h2>
          {v.name && <span style={{ fontSize: 13, color: "var(--ink2)" }}>{v.name}</span>}
          <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ marginLeft: "auto", color: "var(--muted)" }}>{v.as_of}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${BADGE[v.verdict] ?? ""}`}>{v.verdict}</span>
          <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--ink2)" }}>Conviction <ConvictionBar n={v.conviction} /> {v.conviction} of 5</span>
          {v.held && <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">held{isNum(pos?.weight) ? ` · ${pos!.weight!.toFixed(1)}% of portfolio` : ""}{isNum(pos?.pnl_pct) ? ` · ${fmtSigned(pos!.pnl_pct!, 0)}% P&L` : ""}</span>}
          {m.partial && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--wash)", color: "var(--ink2)" }} title="Outside the NSE 750 data: no quarterly series, so some charts are replaced by the latest figures only">partial data</span>}
        </div>
        <p style={{ margin: "14px 0 0", fontSize: 17, lineHeight: 1.45, fontWeight: 500, color: "var(--ink)", maxWidth: "60ch" }}>{headlineOf(v)}</p>
        <div className="mt-3"><RuleTiles rules={v.rule_check} /></div>
      </header>

      <div className="dbv-kpis">
        <Kpi label="P/E (trailing)" value={isNum(val?.pe) ? val!.pe!.toFixed(0) : "—"} sub={isNum(val?.pe) ? undefined : "no trailing profit"} />
        <Kpi label="ROCE" value={isNum(val?.roce) ? `${val!.roce!.toFixed(0)}%` : "—"} sub={isNum(val?.roce_chg_1y) ? `${fmtSigned(val!.roce_chg_1y!)} pts in a year` : undefined} subGood={isNum(val?.roce_chg_1y) ? val!.roce_chg_1y! >= 0 : null} />
        <Kpi label="Borrowings" value={cr(val?.borrowings_cr)} />
        <Kpi label="Market cap" value={cr(val?.mcap_cr)} />
        <Kpi label="1-year price" value={isNum(m.tech?.yearly_pct) ? `${fmtSigned(m.tech!.yearly_pct!, 0)}%` : "—"} subGood={isNum(m.tech?.yearly_pct) ? m.tech!.yearly_pct! >= 0 : null} />
        <Kpi label="Management" value={k ? <span style={{ color: keptColor(k.passed, k.scored) }}>{k.passed} of {k.scored}</span> : "—"} sub={k ? "checks kept" : "not scored"} onClick={v.mgmt ? () => setTab("mgmt") : undefined} title="Open the management tab" />
      </div>

      <div role="tablist" aria-label="Evidence" className="dbv-tabs" onKeyDown={onKey}>
        {TABS.map((t) => (
          <button key={t} role="tab" id={`dbv-tab-${t}`} aria-selected={tab === t} aria-controls="dbv-panel" tabIndex={tab === t ? 0 : -1} className="dbv-tab" onClick={() => setTab(t)}>{labels[t]}</button>
        ))}
      </div>
      <div role="tabpanel" id="dbv-panel" aria-labelledby={`dbv-tab-${tab}`} className="dbv-body">
        <Guard label={`the ${tab} tab`}>
          {tab === "debate" && <DebateTab v={v} />}
          {tab === "business" && <BusinessTab m={m} q={q} />}
          {tab === "price" && <PriceTab m={m} />}
          {tab === "mgmt" && (v.mgmt ? <MgmtTab mgmt={v.mgmt} /> : <Muted>No management data for this stock yet. Run the management block (StockDebate scripts/mgmt_block.py) and push.</Muted>)}
        </Guard>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// the page

type SortKey = "conviction" | "weight" | "symbol" | "verdict" | "mgmt";
const FILTERS = ["all", "Strong candidate", "Watch", "Avoid"] as const;

export default function ResearchDebate() {
  const { bundle } = useData();
  const { ready } = useScreeners(["stockDebate"]);
  const [filter, setFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("conviction");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string>(() => (typeof window !== "undefined" ? decodeURIComponent(window.location.hash.slice(1)).toUpperCase() : ""));
  const [tab, setTab] = useState<Tab>("debate");
  const rows: Verdict[] = (bundle.momentum_screeners as any)?.stockDebate?.rows ?? [];
  const w = (v: Verdict) => v.metrics?.pos?.weight ?? 0;
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f, f === "all" ? rows.length : rows.filter((v) => v.verdict === f).length])), [rows]);
  const shown = useMemo(() => {
    const list = rows.filter((v) => (filter === "all" || v.verdict === filter) && (!q || v.symbol.includes(q.toUpperCase())));
    const ratio = (v: Verdict) => { const k = kept(v.mgmt); return k ? k.passed / k.scored : -1; };
    const by: Record<SortKey, (a: Verdict, b: Verdict) => number> = {
      conviction: (a, b) => b.conviction - a.conviction || w(b) - w(a),
      weight: (a, b) => w(b) - w(a),
      mgmt: (a, b) => ratio(b) - ratio(a) || w(b) - w(a),
      symbol: (a, b) => a.symbol.localeCompare(b.symbol),
      verdict: (a, b) => ORDER[a.verdict] - ORDER[b.verdict] || b.conviction - a.conviction,
    };
    return [...list].sort(by[sort]);
  }, [rows, filter, q, sort]);
  const current = shown.find((v) => v.symbol === sel) ?? shown[0];
  useEffect(() => {
    const onHash = () => setSel(decodeURIComponent(window.location.hash.slice(1)).toUpperCase());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (!current || typeof window === "undefined") return;
    window.history.replaceState(null, "", `#${current.symbol}`);
    document.getElementById(`dbvr-${current.symbol}`)?.scrollIntoView({ block: "nearest" }); // keep the picked row in view in the list
  }, [current?.symbol]);
  if (!ready) return <ScreenerLoading label="research debates" />;

  const pick = (sym: string, focus = false) => {
    setSel(sym);
    if (focus) document.getElementById(`dbvr-${sym}`)?.focus();
    else if (typeof window !== "undefined" && window.innerWidth < 1024) setTimeout(() => document.getElementById("dbv-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const onListKey = (e: KeyboardEvent) => {
    if (!current || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    const i = shown.findIndex((v) => v.symbol === current.symbol);
    const n = shown[Math.min(shown.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (n) { e.preventDefault(); pick(n.symbol, true); }
  };

  return (
    <div className="dbv">
      <style>{VIZ_CSS}</style>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold">🗣️ Research Debate</h1>
        <span className="text-xs text-slate-500">{rows.length} stock{rows.length === 1 ? "" : "s"} · a bull, a bear and a fact-checker arguing only from this app's own data</span>
      </div>
      <details className="my-2">
        <summary>How to read this page</summary>
        <p className="text-xs text-slate-500 mt-2" style={{ maxWidth: "80ch", lineHeight: 1.6 }}>
          A second opinion on stocks you already hold or shortlisted: an AI reading of stored numbers, <b>not advice and never an order</b>. The charts, the four rule checks and the management checks are computed by code
          from the same data the agents read; the headline and the reasoning are the agents'. Pick a stock on the left; the tabs hold the evidence. Hover a chart for exact values. To add one, ask Claude: <i>run StockDebate on SYMBOL</i>.
        </p>
      </details>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div role="group" aria-label="Filter by verdict" className="inline-flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--ring)" }}>
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className="text-xs px-3 py-1.5"
              style={{ background: filter === f ? "var(--ink)" : "var(--surface)", color: filter === f ? "var(--surface)" : "var(--ink2)", borderLeft: f === "all" ? 0 : "1px solid var(--ring)" }}>
              {f === "all" ? "All" : f} <span style={{ opacity: 0.65 }}>{counts[f]}</span>
            </button>
          ))}
        </div>
        <label className="text-xs text-slate-500">Sort{" "}
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="border border-slate-300 rounded px-1.5 py-1 text-xs text-slate-700">
            <option value="conviction">Conviction</option><option value="weight">Portfolio weight</option><option value="mgmt">Management checks</option><option value="verdict">Verdict</option><option value="symbol">Symbol</option>
          </select>
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a symbol" aria-label="Find a symbol" className="ml-auto px-2 py-1 border border-slate-300 rounded text-sm w-36" />
      </div>

      {!current ? (
        <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg p-6 text-center">
          {rows.length === 0 ? "No debates yet. Ask Claude to run StockDebate on a stock and it will show up here." : "Nothing matches that filter."}
        </div>
      ) : (
        <div className="dbv-layout">
          <Guard label="the list">
            <nav aria-label="Stocks" className="dbv-list" onKeyDown={onListKey}>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {shown.map((v) => {
                  const kp = kept(v.mgmt);
                  return (
                    <li key={v.symbol}>
                      <button id={`dbvr-${v.symbol}`} className="dbv-row" aria-current={v.symbol === current.symbol} onClick={() => pick(v.symbol)}>
                        <span className="dbv-vbar" style={{ background: VCOLOR[v.verdict] ?? "var(--muted)" }} aria-hidden />
                        <span className="dbv-r1">
                          <b style={{ fontWeight: 600 }}>{v.symbol}</b>
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>{isNum(v.metrics?.pos?.weight) ? `${v.metrics!.pos!.weight!.toFixed(1)}%` : ""}</span>
                          <span className="sp" />
                          <span style={{ fontSize: 11, color: v.verdict === "Avoid" ? "var(--crit)" : "var(--ink2)", fontWeight: 600 }}>{v.verdict === "Strong candidate" ? "Strong" : v.verdict}</span>
                        </span>
                        <span className="dbv-r2">
                          <ConvictionBar n={v.conviction} />
                          <RuleDots rules={v.rule_check} />
                          <MiniFromHigh v={v.metrics?.tech?.pct_from_ath} />
                          <span className="sp" style={{ flex: 1 }} />
                          <span title="management and capital-allocation checks kept" style={{ color: kp ? keptColor(kp.passed, kp.scored) : "var(--muted)", fontWeight: 600 }}>{kp ? `${kp.passed}/${kp.scored}` : "—"}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </Guard>
          <Guard label={`the ${current.symbol} detail`}><Detail key={current.symbol} v={current} tab={tab} setTab={setTab} /></Guard>
        </div>
      )}
    </div>
  );
}
