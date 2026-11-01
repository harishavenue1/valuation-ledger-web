import { useMemo, useState } from "react";
import { useData, useScreeners } from "../App";
import { ScreenerLoading } from "../components/ScreenerTable";
import { ConvictionBar, GrowthBars, MarginLine, MiniFromHigh, MiniRsi, MiniSpark, Num, RsiMeter, RuleDots, RuleTiles, StatTile, TrendBars, VIZ_CSS, fmtSigned } from "../components/DebateViz";

// Research Debate — added 2026-11-01 ("lets build ai agents or agent workflows for our app"); redesigned the same day as a visual page
// ("too many words can be translated better by figures / bar charts / graphs").
//
// The StockDebate skill (~/.claude/skills/StockDebate) builds an evidence pack for each stock from this app's own data, has a bull, a bear and a fact-checker argue
// from it, and pushes the verdict here as the `stockDebate` key. Each verdict carries a `metrics` snapshot computed by CODE from that same pack (growth series,
// margin series, distance from the moving averages, RSI, P/E, ROCE...), which is what the charts draw — so a picture can never disagree with what the agents read,
// and the rule checks shown are the code's, not the model's. Nothing is generated in the browser and no model key lives in this app.
// An AI reading of stored numbers, never advice or an order.

type Point = { tag?: string; point: string; evidence: string };
interface Metrics {
  partial?: boolean;
  quarters?: { labels: string[]; sales: Num[]; op: Num[]; np: Num[]; opm: Num[] } | null;
  latest?: { sales: Num; np: Num; eps: Num } | null;
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
};

const BADGE: Record<string, string> = { "Strong candidate": "bg-emerald-100 text-emerald-700", Watch: "bg-amber-100 text-amber-700", Avoid: "bg-red-100 text-red-700" };
const ORDER: Record<string, number> = { "Strong candidate": 0, Watch: 1, Avoid: 2 };
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const firstSentence = (s: string) => (s.match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim();
const short = (s: string, n = 54) => (s.length <= n ? s : s.slice(0, s.lastIndexOf(" ", n) > 20 ? s.lastIndexOf(" ", n) : n) + "…");
const cr = (v: number | null | undefined) => (!isNum(v) ? "—" : v >= 1000 ? `₹${(v / 1000).toFixed(1)}k Cr` : `₹${Math.round(v)} Cr`);
const pct = (v: Num, d = 1) => (v === "T" ? "T" : isNum(v) ? `${fmtSigned(v, d)}%` : "—");
const headlineOf = (v: Verdict) => v.headline || short(firstSentence(v.summary), 120);

function Chip({ kind, text, title }: { kind: "bull" | "bear"; text: string; title: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 text-[11.5px] rounded-md px-2 py-0.5" style={{ border: "1px solid var(--ring)", color: "var(--ink)" }}>
      <b style={{ color: kind === "bull" ? "var(--pos)" : "var(--neg)" }}>{kind === "bull" ? "▲" : "▼"}</b>
      {text}
    </span>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink2)", marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

function Points({ title, items, kind }: { title: string; items: Point[]; kind: "bull" | "bear" }) {
  return (
    <div className="flex-1 min-w-[260px]">
      <div className="text-xs font-semibold mb-1" style={{ color: kind === "bull" ? "var(--pos)" : "var(--neg)" }}>{title}</div>
      <ul className="space-y-2">
        {items.map((p, i) => (
          <li key={i} className="text-sm" style={{ color: "var(--ink)" }}>
            {p.point}
            <div className="text-[11px]" style={{ color: "var(--muted)" }}>↳ {p.evidence}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** every number behind the charts, as a table (the text alternative to the pictures) */
function NumbersTable({ m }: { m: Metrics }) {
  const q = m.quarters;
  const cell = { padding: "2px 8px", textAlign: "right" as const, fontSize: 11 };
  return (
    <div className="space-y-3 overflow-x-auto">
      {q && (
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
      )}
      {m.tech && (
        <div style={{ fontSize: 11, color: "var(--ink2)" }}>
          {[["vs 20-day EMA", "pct_20d_ema"], ["vs 50-day EMA", "pct_50d_ema"], ["vs 200-day EMA", "pct_200d_ema"], ["vs 33-week EMA", "pct_33w_ema"], ["from high", "pct_from_ath"], ["1 week", "w_pct_1w"], ["1 month", "w_pct_1m"], ["3 months", "w_pct_3m"], ["6 months", "w_pct_6m"], ["1 year", "yearly_pct"]]
            .filter(([, k]) => isNum(m.tech![k]))
            .map(([l, k]) => `${l} ${fmtSigned(m.tech![k] as number)}%`)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}

function Card({ v, id }: { v: Verdict; id: string }) {
  const [open, setOpen] = useState(false);
  const m = v.metrics ?? {};
  const q = m.quarters;
  const val = m.val;
  const pos = m.pos;
  return (
    <div id={id} className="rounded-xl p-4" style={{ border: "1px solid var(--ring)", background: "var(--surface)", scrollMarginTop: 80 }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-base" style={{ color: "var(--ink)" }}>{v.symbol}</span>
        {v.name && <span className="text-xs" style={{ color: "var(--ink2)" }}>{v.name}</span>}
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${BADGE[v.verdict] ?? ""}`}>{v.verdict}</span>
        <ConvictionBar n={v.conviction} />
        {v.held && <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">held{isNum(pos?.weight) ? ` · ${pos!.weight!.toFixed(1)}% of portfolio` : ""}{isNum(pos?.pnl_pct) ? ` · ${fmtSigned(pos!.pnl_pct!)}% P&L` : ""}</span>}
        {m.partial && <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "var(--wash)", color: "var(--ink2)" }} title="Outside the NSE 750 data: no quarterly series, so some charts are replaced by the latest quarter only">partial data</span>}
        <span className="ml-auto text-[11px]" style={{ color: "var(--muted)" }}>{v.as_of}</span>
      </div>
      <div className="mt-1.5 text-[15px]" style={{ color: "var(--ink)" }}>{headlineOf(v)}</div>
      <div className="mt-2"><RuleTiles rules={v.rule_check} /></div>

      <div className="grid gap-5 mt-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))" }}>
        <Panel title="Growth vs a year ago">
          {q ? <GrowthBars labels={q.labels} sales={q.sales} op={q.op} np={q.np} /> : m.latest ? (
            <div className="flex flex-wrap gap-2">
              <StatTile label="Sales growth" value={pct(m.latest.sales)} sub="latest quarter" />
              <StatTile label="Net profit growth" value={pct(m.latest.np)} sub="latest quarter" />
              <StatTile label="EPS growth" value={pct(m.latest.eps)} sub="latest quarter" />
            </div>
          ) : <div style={{ fontSize: 11, color: "var(--muted)" }}>No growth data.</div>}
        </Panel>
        <Panel title="Operating margin">
          {q && q.opm.some(isNum) ? <MarginLine labels={q.labels} opm={q.opm} /> : <div style={{ fontSize: 11, color: "var(--muted)" }}>No quarterly margin series for this stock.</div>}
        </Panel>
        <Panel title="Where the price sits">
          {m.tech ? (
            <div className="space-y-2">
              <RsiMeter rsi={m.tech.rsi_w} />
              <TrendBars tech={m.tech} />
            </div>
          ) : <div style={{ fontSize: 11, color: "var(--muted)" }}>No price data.</div>}
        </Panel>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <StatTile label="P/E (trailing)" value={isNum(val?.pe) ? val!.pe!.toFixed(0) : "—"} sub={isNum(val?.pe) ? undefined : "not meaningful (no trailing profit)"} />
        <StatTile label="ROCE" value={isNum(val?.roce) ? `${val!.roce!.toFixed(0)}%` : "—"} sub={isNum(val?.roce_chg_1y) ? `${fmtSigned(val!.roce_chg_1y!)} pts in a year` : undefined} subGood={isNum(val?.roce_chg_1y) ? val!.roce_chg_1y! >= 0 : null} />
        <StatTile label="Borrowings" value={cr(val?.borrowings_cr)} />
        <StatTile label="Market cap" value={cr(val?.mcap_cr)} />
        {isNum(m.tech?.yearly_pct) && <StatTile label="1-year price" value={`${fmtSigned(m.tech!.yearly_pct!, 0)}%`} />}
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3">
        {v.bull.slice(0, 3).map((p, i) => <Chip key={`b${i}`} kind="bull" text={p.tag || short(p.point)} title={p.point} />)}
        {v.bear.slice(0, 3).map((p, i) => <Chip key={`r${i}`} kind="bear" text={p.tag || short(p.point)} title={p.point} />)}
      </div>

      <button onClick={() => setOpen(!open)} className="text-xs mt-3 hover:underline" style={{ color: "var(--pos)" }}>{open ? "Hide the details" : "Details: the reasoning, the numbers and what is missing"}</button>
      {open && (
        <div className="mt-3 space-y-4">
          <p className="text-sm" style={{ color: "var(--ink)" }}>{v.summary}</p>
          <div className="flex flex-wrap gap-5">
            <Points title="Bull case" items={v.bull} kind="bull" />
            <Points title="Bear case" items={v.bear} kind="bear" />
          </div>
          {v.risks?.length > 0 && <div><div className="text-xs font-semibold mb-1" style={{ color: "var(--ink2)" }}>Biggest risks</div><ul className="list-disc ml-5 text-sm" style={{ color: "var(--ink)" }}>{v.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
          {v.change_my_mind && <div className="text-sm" style={{ color: "var(--ink)" }}><b className="text-xs" style={{ color: "var(--ink2)" }}>What would change this: </b>{v.change_my_mind}</div>}
          {m.quarters || m.tech ? <div><div className="text-xs font-semibold mb-1" style={{ color: "var(--ink2)" }}>The numbers behind the charts</div><NumbersTable m={m} /></div> : null}
          {v.data_gaps && v.data_gaps.length > 0 && <div className="text-xs" style={{ color: "var(--muted)" }}><b>Not covered by the data: </b>{v.data_gaps.join("; ")}</div>}
          {v.fact_check_dropped && v.fact_check_dropped.length > 0 && <div className="text-xs" style={{ color: "var(--muted)" }}><b>Removed or softened by the fact-check: </b>{v.fact_check_dropped.join("; ")}</div>}
        </div>
      )}
    </div>
  );
}

type SortKey = "conviction" | "weight" | "symbol" | "verdict";

export default function ResearchDebate() {
  const { bundle } = useData();
  const { ready } = useScreeners(["stockDebate"]);
  const [filter, setFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("conviction");
  const [q, setQ] = useState("");
  const rows: Verdict[] = (bundle.momentum_screeners as any)?.stockDebate?.rows ?? [];
  const w = (v: Verdict) => v.metrics?.pos?.weight ?? 0;
  const shown = useMemo(() => {
    const list = rows.filter((v) => (filter === "all" || v.verdict === filter) && (!q || v.symbol.includes(q.toUpperCase())));
    const by: Record<SortKey, (a: Verdict, b: Verdict) => number> = {
      conviction: (a, b) => b.conviction - a.conviction || w(b) - w(a),
      weight: (a, b) => w(b) - w(a),
      symbol: (a, b) => a.symbol.localeCompare(b.symbol),
      verdict: (a, b) => ORDER[a.verdict] - ORDER[b.verdict] || b.conviction - a.conviction,
    };
    return [...list].sort(by[sort]);
  }, [rows, filter, q, sort]);
  if (!ready) return <ScreenerLoading label="research debates" />;

  const go = (sym: string) => document.getElementById(`dbv-${sym}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const th = { padding: "6px 10px", textAlign: "left" as const, fontSize: 11, fontWeight: 600, color: "var(--ink2)", whiteSpace: "nowrap" as const };
  const td = { padding: "6px 10px", fontSize: 12, color: "var(--ink)", whiteSpace: "nowrap" as const };
  return (
    <div className="dbv">
      <style>{VIZ_CSS}</style>
      <div className="flex flex-wrap items-baseline gap-3 mb-1">
        <h1 className="text-lg font-semibold">🗣️ Research Debate</h1>
        <span className="text-xs text-slate-500">{rows.length} stock{rows.length === 1 ? "" : "s"} debated · bull, bear and a fact-checker, arguing only from this app's own data</span>
      </div>
      <div className="text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-2 my-3 bg-slate-50">
        A second opinion on stocks you already hold or shortlisted: an AI reading of stored numbers, <b>not advice and never an order</b>. Charts and the four rule checks are computed by code from the same data the agents read;
        the headline and reasoning are the agents'. Hover a chart for exact values; open <i>Details</i> for the words and the numbers.
        To add one, ask Claude: <i>run StockDebate on SYMBOL</i>.
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {["all", "Strong candidate", "Watch", "Avoid"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`text-xs px-2.5 py-1 rounded border ${filter === f ? "bg-slate-800 text-white border-slate-800" : "border-slate-300 text-slate-600"}`}>
            {f === "all" ? "All" : f}
          </button>
        ))}
        <label className="text-xs text-slate-500 ml-2">Sort by{" "}
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="border border-slate-300 rounded px-1.5 py-1 text-xs text-slate-700">
            <option value="conviction">Conviction</option><option value="weight">Portfolio weight</option><option value="verdict">Verdict</option><option value="symbol">Symbol</option>
          </select>
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Symbol" className="ml-auto px-2 py-1 border border-slate-300 rounded text-sm w-32" />
      </div>

      {shown.length === 0 ? (
        <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg p-6 text-center">
          {rows.length === 0 ? "No debates yet. Ask Claude to run StockDebate on a stock and it will show up here." : "Nothing matches that filter."}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl mb-5" style={{ border: "1px solid var(--ring)", background: "var(--surface)" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--grid)" }}>
                  <th style={th}>Stock</th><th style={th}>Verdict</th><th style={th}>Conviction</th><th style={th} title="RSI > 66 · above 33W EMA · margins held · Stage 2">Rules</th>
                  <th style={{ ...th, textAlign: "right" }}>Weight</th><th style={th}>From the high</th><th style={th} title="weekly RSI; the tick marks your 66 bar">Weekly RSI</th><th style={th}>Op. margin</th><th style={{ ...th, textAlign: "right" }}>P/E</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((v) => (
                  <tr key={v.symbol} onClick={() => go(v.symbol)} className="cursor-pointer hover:bg-slate-50" style={{ borderTop: "1px solid var(--grid)" }}>
                    <td style={{ ...td, fontWeight: 600 }}>{v.symbol}</td>
                    <td style={td}><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${BADGE[v.verdict] ?? ""}`}>{v.verdict}</span></td>
                    <td style={td}><ConvictionBar n={v.conviction} /></td>
                    <td style={td}><RuleDots rules={v.rule_check} /></td>
                    <td style={{ ...td, textAlign: "right" }}>{isNum(v.metrics?.pos?.weight) ? `${v.metrics!.pos!.weight!.toFixed(1)}%` : "—"}</td>
                    <td style={td}><MiniFromHigh v={v.metrics?.tech?.pct_from_ath} /></td>
                    <td style={td}><MiniRsi v={v.metrics?.tech?.rsi_w} /></td>
                    <td style={td}><MiniSpark vals={v.metrics?.quarters?.opm} /></td>
                    <td style={{ ...td, textAlign: "right" }}>{isNum(v.metrics?.val?.pe) ? v.metrics!.val!.pe!.toFixed(0) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-4">{shown.map((v) => <Card key={v.symbol} v={v} id={`dbv-${v.symbol}`} />)}</div>
        </>
      )}
    </div>
  );
}
