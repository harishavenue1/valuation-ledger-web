import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData, useScreeners } from "../App";
import { useWatchlist } from "../lib/useWatchlist";
import { DeltaBars, Guard, StatTile, StripPlot, VIZ_CSS, fmtSigned } from "../components/DebateViz";
import { ScreenerLoading, WatchlistStar } from "../components/ScreenerTable";

// Fund Raising — added 2026-11-01 ("a page where company goes for QIP or fund raising and its reason, with a reference to the doc or a link to read more";
// "whenever a company goes for QIP it usually underperforms").
//
// Data: the FundRaiseTracker skill (~/.claude/skills/FundRaiseTracker) reads NSE's corporate-announcements feed (BSE's API now refuses scripted requests), groups the
// filings of one raise into an EVENT (type, stage, size and stated purpose read from the filing PDF, a link to each document) and measures how the stock has done since.
// It also tests the underperformance claim on two years of QIP filings (`fundRaiseStudy`). Nothing is generated in the browser. Not advice.

interface Doc { date: string; label: string; stage: string; url: string; text?: string }
interface Perf { since?: number | null; since_rel?: number | null; days?: number | null; [k: string]: number | null | undefined }
interface Raise {
  symbol: string; name?: string; type: string; kind?: "new" | "followup"; stage: string; first_date: string; last_date: string;
  amount_cr?: number | null; purposes?: string[]; reason?: string; url?: string; docs?: Doc[]; perf?: Perf | null; filings_page?: string;
}
interface Horizon { n: number; mean: number; median: number; share_below: number }
interface Study {
  as_of: string; events_found: number; events_priced: number; window?: string; entry?: string; benchmark?: string;
  rel?: Record<string, Horizon | null>; pre3m_rel?: Horizon | null; events?: { symbol: string; date: string; "3m_rel"?: number | null }[];
}

const TYPE_BADGE: Record<string, string> = {
  QIP: "bg-violet-100 text-violet-700", "Preferential / warrants": "bg-sky-100 text-sky-700", "Rights issue": "bg-emerald-100 text-emerald-700",
  FPO: "bg-amber-100 text-amber-700", "Debt (NCD / bonds)": "bg-slate-100 text-slate-600", "Borrowing (ECB / loan)": "bg-slate-100 text-slate-600", "Other fund raise": "bg-orange-100 text-orange-700",
};
const EQUITY_TYPES = ["QIP", "Preferential / warrants", "Rights issue", "FPO", "Other fund raise"];
const STAGES = ["Board meeting planned", "Increase in capital", "Board approved", "Issue announced", "Issue open", "Issue closed", "Allotted", "Fund use report"];
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const dShort = (iso: string) => { const d = new Date(iso + "T00:00:00"); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }); };
const crFmt = (v: number) => (v >= 1000 ? `₹${(v / 1000).toFixed(1)}k Cr` : `₹${Math.round(v).toLocaleString("en-IN")} Cr`);
const pct = (v: number | null | undefined, d = 1) => (isNum(v) ? `${fmtSigned(v * 100, d)}%` : "—");

function Ret({ v, label }: { v: number | null | undefined; label?: string }) {
  if (!isNum(v)) return <span style={{ color: "var(--muted)" }}>—</span>;
  return <span title={label} style={{ color: v >= 0 ? "var(--good-text)" : "var(--crit)", fontWeight: 600 }}>{v >= 0 ? "▲" : "▼"} {pct(v)}</span>;
}

/** the claim "companies that raise through a QIP underperform", tested on the stored two-year sample — worded from the numbers, never assumed */
function StudyCard({ study }: { study: Study }) {
  const h = (k: string) => study.rel?.[k] ?? null;
  const m3 = h("3m");
  const lead = !m3 ? "Not enough priced QIPs to test the claim yet."
    : m3.median < 0 ? `On this sample the claim holds so far: the median QIP stock trailed the Nifty Midcap 150 by ${Math.abs(m3.median * 100).toFixed(1)}% over the 3 months after the filing, and ${(m3.share_below * 100).toFixed(0)}% of them trailed it.`
    : `On this sample the claim does not show: the median QIP stock was ${(m3.median * 100).toFixed(1)}% ahead of the Nifty Midcap 150 over the 3 months after the filing, and ${(m3.share_below * 100).toFixed(0)}% trailed it.`;
  const pts = (study.events ?? []).filter((e) => isNum(e["3m_rel"])).map((e) => ({ x: (e["3m_rel"] as number) * 100, tip: `${e.symbol} · filed ${e.date} · ${fmtSigned((e["3m_rel"] as number) * 100)}% vs the index after 3 months` }));
  return (
    <div className="rounded-xl p-4 mb-4" style={{ border: "1px solid var(--ring)", background: "var(--surface)" }}>
      <div className="flex flex-wrap items-baseline gap-2">
        <b style={{ color: "var(--ink)" }}>Do QIP stocks underperform?</b>
        <span className="text-xs" style={{ color: "var(--muted)" }}>tested on {study.events_priced} QIPs of the last two years</span>
      </div>
      <p className="text-sm mt-1" style={{ color: "var(--ink)" }}>{lead}</p>
      <div className="grid gap-6 mt-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink2)", marginBottom: 4 }}>Median return vs the Nifty Midcap 150</div>
          <DeltaBars rows={[
            { label: "3 months before", value: isNum(study.pre3m_rel?.median) ? study.pre3m_rel!.median * 100 : null, note: `${study.pre3m_rel?.n ?? 0} events — the run-up into the filing` },
            { label: "1 month after", value: isNum(h("1m")?.median) ? h("1m")!.median * 100 : null, note: `${h("1m")?.n ?? 0} events` },
            { label: "3 months after", value: isNum(m3?.median) ? m3!.median * 100 : null, note: `${m3?.n ?? 0} events` },
            { label: "6 months after", value: isNum(h("6m")?.median) ? h("6m")!.median * 100 : null, note: `${h("6m")?.n ?? 0} events` },
          ]} />
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink2)", marginBottom: 4 }}>Each QIP, 3 months after (vs the index)</div>
          <StripPlot points={pts} median={isNum(m3?.median) ? m3!.median * 100 : null} />
          <div style={{ fontSize: 10.5, color: "var(--muted)" }}>One dot per QIP: blue ahead of the index, red behind.</div>
        </div>
      </div>
      <p className="text-[11px] mt-3" style={{ color: "var(--muted)" }}>
        Read with care: a small sample ({study.events_priced} events), one market period, entered at the first close after the company's first QIP filing (usually the issue opening, not the earlier board approval),
        measured against the Nifty Midcap 150 (most QIP issuers are small and mid caps). It describes the past; it is not a forecast or advice. Date of the test: {study.as_of}.
      </p>
    </div>
  );
}

function Row({ r, mcap, watchlist }: { r: Raise; mcap?: number | null; watchlist: ReturnType<typeof useWatchlist> }) {
  const [open, setOpen] = useState(false);
  const docs = r.docs ?? [];
  const share = isNum(r.amount_cr) && isNum(mcap) && mcap > 0 ? (r.amount_cr / mcap) * 100 : null;
  const p = r.perf ?? null;
  return (
    <>
      <tr style={{ borderTop: "1px solid var(--grid)" }}>
        <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
          <WatchlistStar active={watchlist.set.has(r.symbol)} onToggle={watchlist.toggle} symbol={r.symbol} held={watchlist.held?.has(r.symbol)} />
          <Link to={`/company/${r.symbol}`} className="font-semibold hover:underline" style={{ color: "var(--ink)" }}>{r.symbol}</Link>
          <div className="text-[11px]" style={{ color: "var(--muted)", maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis" }} title={r.name}>{r.name}</div>
        </td>
        <td style={{ padding: "8px 10px" }}><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${TYPE_BADGE[r.type] ?? "bg-slate-100 text-slate-600"}`}>{r.type}</span></td>
        <td style={{ padding: "8px 10px", fontSize: 12, color: "var(--ink)", whiteSpace: "nowrap" }}>{r.stage}</td>
        <td style={{ padding: "8px 10px", fontSize: 12, color: "var(--ink2)", whiteSpace: "nowrap" }}>{dShort(r.first_date)}{r.last_date !== r.first_date ? <span style={{ color: "var(--muted)" }}> → {dShort(r.last_date)}</span> : null}</td>
        <td style={{ padding: "8px 10px", whiteSpace: "nowrap", textAlign: "right" }}>
          {isNum(r.amount_cr) ? <span title="read from the filing — check the document"><b style={{ color: "var(--ink)" }}>{crFmt(r.amount_cr)}</b>{share !== null && <div className="text-[11px]" style={{ color: share >= 10 ? "var(--crit)" : "var(--muted)" }} title="amount as a share of the current market cap (a dilution gauge)">{share.toFixed(share < 10 ? 1 : 0)}% of mcap</div>}</span> : <span style={{ color: "var(--muted)" }} title="not stated in the filing text, see the document">—</span>}
        </td>
        <td style={{ padding: "8px 10px", maxWidth: 230 }}>
          <div className="flex flex-wrap gap-1">
            {(r.purposes ?? []).slice(0, 3).map((t) => <span key={t} className="text-[11px] rounded px-1.5 py-0.5" style={{ border: "1px solid var(--ring)", color: "var(--ink)" }}>{t}</span>)}
            {!(r.purposes ?? []).length && <span className="text-[11px]" style={{ color: "var(--muted)" }}>see document</span>}
          </div>
        </td>
        <td style={{ padding: "8px 10px", fontSize: 12, whiteSpace: "nowrap" }} title={p ? `since the first close after the filing${isNum(p.days) ? ` (${p.days} days)` : ""}` : "no price history"}>
          <Ret v={p?.since} />{isNum(p?.since_rel) && <div className="text-[11px]" style={{ color: "var(--muted)" }}>vs index {pct(p!.since_rel)}</div>}
        </td>
        <td style={{ padding: "8px 10px", whiteSpace: "nowrap", fontSize: 12 }}>
          {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--pos)" }} title="the filing as published on NSE">Read ↗</a> : <span style={{ color: "var(--muted)" }}>—</span>}
          <button onClick={() => setOpen(!open)} className="ml-2 text-[11px] hover:underline" style={{ color: "var(--ink2)" }}>{open ? "hide" : `all ${docs.length || 1}`}</button>
        </td>
      </tr>
      {open && (
        <tr style={{ background: "var(--wash)" }}>
          <td colSpan={8} style={{ padding: "8px 14px" }}>
            {r.reason ? <p className="text-[12.5px] mb-2" style={{ color: "var(--ink)" }}><b style={{ color: "var(--ink2)" }}>What the filing says about its purpose: </b>{r.reason}</p> : null}
            <ul className="text-[12px] space-y-1" style={{ color: "var(--ink)" }}>
              {docs.map((d, i) => (
                <li key={i}><span style={{ color: "var(--muted)" }}>{dShort(d.date)} · {d.stage}</span> — {d.label}{d.url ? <> <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--pos)" }}>open ↗</a></> : null}{d.text ? <div className="text-[11px]" style={{ color: "var(--muted)" }}>{d.text}</div> : null}</li>
              ))}
            </ul>
            {r.filings_page ? <a href={r.filings_page} target="_blank" rel="noopener noreferrer" className="text-[11.5px] hover:underline" style={{ color: "var(--pos)" }}>All NSE filings for {r.symbol} ↗</a> : null}
          </td>
        </tr>
      )}
    </>
  );
}

type SortKey = "date" | "amount" | "since";

export default function FundRaising() {
  const { bundle } = useData();
  const { ready } = useScreeners(["fundRaises", "fundRaiseStudy", "nse750Fundamentals"]);
  const watchlist = useWatchlist();
  const [types, setTypes] = useState<string[]>(["QIP", "Preferential / warrants", "Rights issue", "FPO", "Other fund raise"]);
  const [stage, setStage] = useState("all");
  const [days, setDays] = useState(90);
  const [mine, setMine] = useState(false);
  const [followups, setFollowups] = useState(false);
  const [sort, setSort] = useState<SortKey>("date");
  const [q, setQ] = useState("");
  const ms = bundle.momentum_screeners as any;
  const rows: Raise[] = ms?.fundRaises?.rows ?? [];
  const study: Study | null = ms?.fundRaiseStudy?.rows?.[0] ?? null;
  const mcapBy = useMemo(() => new Map<string, number>((ms?.nse750Fundamentals?.rows ?? []).filter((r: any) => isNum(r.marketcap)).map((r: any) => [r.symbol, r.marketcap as number])), [ms?.nse750Fundamentals]);

  const shown = useMemo(() => {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const list = rows.filter((r) => types.includes(r.type) && (followups || r.kind !== "followup") && (stage === "all" || r.stage === stage) && (r.last_date ?? "") >= cutoff
      && (!q || r.symbol.includes(q.toUpperCase()) || (r.name ?? "").toLowerCase().includes(q.toLowerCase())) && (!mine || watchlist.held?.has(r.symbol) || watchlist.set.has(r.symbol)));
    const by: Record<SortKey, (a: Raise, b: Raise) => number> = {
      date: (a, b) => (b.last_date ?? "").localeCompare(a.last_date ?? ""),
      amount: (a, b) => (b.amount_cr ?? -1) - (a.amount_cr ?? -1),
      since: (a, b) => (b.perf?.since ?? -9) - (a.perf?.since ?? -9),
    };
    return [...list].sort(by[sort]);
  }, [rows, types, followups, stage, days, q, mine, sort, watchlist.held, watchlist.set]);
  if (!ready) return <ScreenerLoading label="fund-raising filings" />;

  const counts = (t: string) => rows.filter((r) => r.type === t && (followups || r.kind !== "followup")).length;
  const toggle = (t: string) => setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const total = shown.reduce((a, r) => a + (isNum(r.amount_cr) ? r.amount_cr : 0), 0);
  const th = { padding: "6px 10px", textAlign: "left" as const, fontSize: 11, fontWeight: 600, color: "var(--ink2)", whiteSpace: "nowrap" as const };
  return (
    <div className="dbv">
      <style>{VIZ_CSS}</style>
      <div className="flex flex-wrap items-baseline gap-3 mb-1">
        <h1 className="text-lg font-semibold">💰 Fund Raising</h1>
        <span className="text-xs text-slate-500">QIPs, preferential issues, rights issues and debt, from NSE filings · {rows.length} events stored{ms?.fundRaises?.as_of ? ` · as of ${ms.fundRaises.as_of}` : ""}</span>
      </div>
      <div className="text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-2 my-3 bg-slate-50">
        Each row is one raise: what kind, how far it has got, the size and stated purpose <i>read from the company's own filing</i>, and a link to that document. Sizes and purposes are picked out of the PDF by a program: check the document before relying on them.
        "Since" is the stock's return from the first close after the announcement. Not advice.
      </div>
      {study && <Guard label="the QIP study"><StudyCard study={study} /></Guard>}

      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {[...EQUITY_TYPES, "Debt (NCD / bonds)", "Borrowing (ECB / loan)"].map((t) => (
          <button key={t} onClick={() => toggle(t)} className={`text-xs px-2.5 py-1 rounded border ${types.includes(t) ? "bg-slate-800 text-white border-slate-800" : "border-slate-300 text-slate-600"}`}>{t} <span className="opacity-70">{counts(t)}</span></button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-3 text-xs text-slate-600">
        <label>Stage <select value={stage} onChange={(e) => setStage(e.target.value)} className="border border-slate-300 rounded px-1.5 py-1"><option value="all">All</option>{STAGES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Period <select value={days} onChange={(e) => setDays(+e.target.value)} className="border border-slate-300 rounded px-1.5 py-1"><option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option></select></label>
        <label>Sort <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="border border-slate-300 rounded px-1.5 py-1"><option value="date">Latest filing</option><option value="amount">Size</option><option value="since">Return since</option></select></label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> my holdings &amp; watchlist</label>
        <label className="flex items-center gap-1" title="reports on how an EARLIER raise's money was used"><input type="checkbox" checked={followups} onChange={(e) => setFollowups(e.target.checked)} /> include fund-use reports on older raises</label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company" className="ml-auto px-2 py-1 border border-slate-300 rounded text-sm w-36" />
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        <StatTile label="Events shown" value={shown.length} />
        <StatTile label="Size stated in total" value={total ? crFmt(total) : "—"} sub={`${shown.filter((r) => isNum(r.amount_cr)).length} with a size`} />
        <StatTile label="In your holdings" value={shown.filter((r) => watchlist.held?.has(r.symbol)).length} />
      </div>

      {shown.length === 0 ? (
        <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg p-6 text-center">{rows.length === 0 ? "No data yet. Ask Claude to run FundRaiseTracker." : "Nothing matches these filters."}</div>
      ) : (
        <Guard label="the table">
          <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid var(--ring)", background: "var(--surface)" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr style={{ borderBottom: "1px solid var(--grid)" }}>
                <th style={th}>Company</th><th style={th}>Type</th><th style={th}>Stage</th><th style={th}>Dates</th><th style={{ ...th, textAlign: "right" }}>Size</th><th style={th}>Purpose (from the filing)</th><th style={th}>Since announcement</th><th style={th}>Document</th>
              </tr></thead>
              <tbody>{shown.map((r) => <Guard key={`${r.symbol}-${r.type}-${r.first_date}`} label={`the ${r.symbol} row`}><Row r={r} mcap={mcapBy.get(r.symbol)} watchlist={watchlist} /></Guard>)}</tbody>
            </table>
          </div>
        </Guard>
      )}
    </div>
  );
}
