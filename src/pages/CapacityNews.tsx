import { useMemo, useState, type ReactNode } from "react";
import { useData, useScreeners } from "../App";
import { ScreenerLoading } from "../components/ScreenerTable";
import { DeltaBars, Guard, Key, VIZ_CSS, fmtSigned } from "../components/DebateViz";
import { MoveBar, TYPES, TYPE_META, WeeklyStack, type EvType } from "../components/CapacityViz";

// Capacity & Technology — added 2026-11-01 ("one more page for new technology / new capacity expansion / capacity live commissioned / and very important announcements").
//
// The CapacityTracker skill (~/.claude/skills/CapacityTracker) reads NSE's corporate-announcements feed (capacity additions, commercial production started, product launches, technology tie-ups, order wins,
// acquisitions, licences, mergers, disruptions, plus board outcomes / press releases that talk about capex or technology), reads each filing's PDF for the size, capacity and timeline, sets the size against the
// company's market cap and annual sales (the app's own nse750Fundamentals), marks the stocks you hold (portfolioAllocation), and measures the price move since. It pushes the `capacityNews` and
// `capacityStudy` keys. No model writes any of it: classification and extraction are regex and arithmetic, so the page tells the reader to check the document.

interface Ev {
  id: string; symbol: string; name: string; date: string; type: EvType; subtype: string; tone: "positive" | "negative" | "neutral"; headline: string;
  value_cr?: number | null; capacity?: string | null; timeline?: string | null; mcap_cr?: number | null; size_vs_mcap?: number | null; size_vs_sales?: number | null;
  cwip_cr?: number | null; fixed_assets_cr?: number | null; big: boolean; held: boolean; weight?: number | null; url?: string; docs?: { url: string; date: string }[];
  perf?: { since_rel?: number | null; since?: number | null; days?: number; "1m_rel"?: number | null; "3m_rel"?: number | null; "6m_rel"?: number | null } | null;
}
type Stat = { n: number; mean?: number; median?: number; share_below?: number };
interface Study { as_of: string; bench: string; types: Record<string, { events_found: number; events_priced: number; rel: Record<string, Stat>; pre3m_rel: Stat }> }

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const cr = (v: number) => (v >= 100000 ? `₹${(v / 100000).toFixed(1)}L Cr` : v >= 1000 ? `₹${(v / 1000).toFixed(1)}k Cr` : v >= 10 ? `₹${Math.round(v)} Cr` : `₹${v.toFixed(1)} Cr`);
const day = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
const daysAgo = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 864e5);

const CAP_CSS = `
.cap-row{display:grid;gap:8px 20px;grid-template-columns:minmax(0,1fr);padding:14px 16px 14px 20px;border-top:1px solid var(--grid);position:relative}
.cap-row:first-child{border-top:0}
.cap-bar{position:absolute;left:0;top:0;bottom:0;width:4px}
@media(min-width:900px){.cap-row{grid-template-columns:168px minmax(0,1fr) 150px 170px}}
@media(min-width:560px) and (max-width:899px){.cap-row{grid-template-columns:150px minmax(0,1fr)}.cap-row>.c3,.cap-row>.c4{grid-column:2}}
.cap-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--ring);border-radius:6px;padding:1px 8px;font-size:11.5px;color:var(--ink);background:var(--surface);white-space:nowrap}
.cap-chip b{font-weight:600}
.cap-tile{all:unset;box-sizing:border-box;cursor:pointer;display:block;border:1px solid var(--ring);border-radius:12px;padding:12px 14px;background:var(--surface);min-width:0}
.cap-tile:hover{background:var(--wash)}.cap-tile:focus-visible{outline:2px solid var(--pos)}
.cap-tile[aria-pressed="true"]{box-shadow:inset 0 0 0 2px var(--ink)}
.cap-seg{display:inline-flex;border:1px solid var(--ring);border-radius:8px;overflow:hidden}
.cap-seg button{font-size:12px;padding:5px 12px;background:var(--surface);color:var(--ink2);border-left:1px solid var(--ring)}
.cap-seg button:first-child{border-left:0}
.cap-seg button[aria-pressed="true"]{background:var(--ink);color:var(--surface)}
.cap-toggle{font-size:12px;padding:5px 12px;border:1px solid var(--ring);border-radius:8px;background:var(--surface);color:var(--ink2)}
.cap-toggle[aria-pressed="true"]{background:var(--ink);color:var(--surface);border-color:var(--ink)}
`;

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="dbv-panel">
      <div className="dbv-panel-h"><h3>{title}</h3>{hint && <span>{hint}</span>}</div>
      {children}
    </section>
  );
}

const SORTS = { new: "Newest", size: "Biggest against the company", rs: "Biggest move since", value: "Biggest in ₹" } as const;
type SortKey = keyof typeof SORTS;
const RANGES = [["7", "7 days"], ["30", "30 days"], ["90", "90 days"]] as const;

function Row({ e }: { e: Ev }) {
  const m = TYPE_META[e.type] ?? TYPE_META.Important;
  const wip = (e.type === "Expansion" || e.type === "Commissioned") && isNum(e.cwip_cr) && isNum(e.fixed_assets_cr) && e.fixed_assets_cr > 0 ? { cwip: e.cwip_cr, pct: (e.cwip_cr / e.fixed_assets_cr) * 100 } : null;
  const p = e.perf;
  return (
    <li className="cap-row">
      <span className="cap-bar" style={{ background: m.color }} aria-hidden />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "2px 8px" }}>
          <b style={{ fontSize: 14, color: "var(--ink)" }}>{e.symbol}</b>
          {e.held && <span className="text-[11px] px-1.5 py-px rounded-full bg-indigo-100 text-indigo-700" title="you hold this stock">held{isNum(e.weight) ? ` ${e.weight.toFixed(1)}%` : ""}</span>}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.name}>{e.name}</div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{day(e.date)}{daysAgo(e.date) <= 1 ? " · new" : ""}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px", marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink)", border: `1px solid ${m.color}`, borderRadius: 999, padding: "0 8px" }}>{m.icon} {e.subtype}</span>
          {e.tone === "negative" && <span style={{ fontSize: 11, fontWeight: 600, color: "var(--crit)" }}>▼ negative</span>}
          {e.url && <a href={e.url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "var(--pos)" }}>filing ↗</a>}
        </div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)" }}>{e.headline || "See the filing."}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {e.capacity && <span className="cap-chip" title="capacity read from the filing">⚙ <b>{e.capacity}</b></span>}
          {e.timeline && <span className="cap-chip" title="timeline read from the filing">🗓 {e.timeline}</span>}
          {wip && <span className="cap-chip" title="capital work in progress on the latest balance sheet, against fixed assets">work in progress {cr(wip.cwip)} · {wip.pct.toFixed(0)}% of assets</span>}
        </div>
      </div>
      <div className="c3">
        {isNum(e.value_cr) ? (
          <>
            <div style={{ fontSize: 11, color: "var(--ink2)" }}>{e.type === "Important" && e.subtype === "Order win" ? "Order value" : e.type === "Important" && e.subtype === "Acquisition" ? "Deal value" : e.type === "Important" ? "Value" : "Investment"}</div>
            <div style={{ fontSize: 17, fontWeight: 600, color: "var(--ink)", lineHeight: 1.3 }}>{cr(e.value_cr)}</div>
            <div style={{ fontSize: 11, color: e.big ? "var(--good-text)" : "var(--muted)", fontWeight: e.big ? 600 : 400 }}>
              {isNum(e.size_vs_mcap) ? `${e.size_vs_mcap.toFixed(e.size_vs_mcap < 10 ? 1 : 0)}% of market cap` : "market cap not known"}
              {isNum(e.size_vs_sales) ? ` · ${e.size_vs_sales.toFixed(0)}% of sales` : ""}
            </div>
          </>
        ) : <div style={{ fontSize: 11.5, color: "var(--muted)" }}>No amount found in the filing</div>}
      </div>
      <div className="c4">
        <div style={{ fontSize: 11, color: "var(--ink2)", marginBottom: 2 }}>vs index since{isNum(p?.days) ? ` (${p!.days}d)` : ""}</div>
        {daysAgo(e.date) <= 3 && !isNum(p?.since_rel) ? <span style={{ fontSize: 11, color: "var(--muted)" }}>too new to measure</span> : <MoveBar v={p?.since_rel} />}
        {isNum(p?.["3m_rel"]) && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>after 3 months {fmtSigned(p!["3m_rel"]! * 100, 0)}%</div>}
      </div>
    </li>
  );
}

function StudyPanel({ study }: { study: Study }) {
  const names = ["Expansion", "Commissioned", "Product launch", "Tech tie-up"];
  const label: Record<string, string> = { Expansion: "New capacity", Commissioned: "Now live", "Product launch": "Product launch", "Tech tie-up": "Tech tie-up" };
  const t = study.types ?? {};
  const rows = (h: string) => names.filter((n) => t[n]).map((n) => ({ label: `${label[n]} (${t[n].rel?.[h]?.n ?? 0})`, value: isNum(t[n].rel?.[h]?.median) ? t[n].rel[h].median! * 100 : null, note: `${Math.round((t[n].rel?.[h]?.share_below ?? 0) * 100)}% trailed the index` }));
  const best = names.filter((n) => isNum(t[n]?.rel?.["3m"]?.median)).sort((a, b) => t[b].rel["3m"].median! - t[a].rel["3m"].median!)[0];
  const worst = names.filter((n) => isNum(t[n]?.rel?.["3m"]?.median)).sort((a, b) => t[a].rel["3m"].median! - t[b].rel["3m"].median!)[0];
  const pre = names.map((n) => t[n]?.pre3m_rel?.median).filter(isNum);
  return (
    <Panel title="Did the market reward it?" hint={`median move vs the Nifty Midcap 150 after the announcement · a year of filings · (events)`}>
      <div className="dbv-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <div><div style={{ fontSize: 11, color: "var(--ink2)", marginBottom: 2 }}>After 3 months</div><DeltaBars rows={rows("3m")} /></div>
        <div><div style={{ fontSize: 11, color: "var(--ink2)", marginBottom: 2 }}>After 6 months</div><DeltaBars rows={rows("6m")} /></div>
      </div>
      <p className="dbv-note">
        {best && worst ? <>Over three months the best group was <b>{label[best]}</b> ({fmtSigned(t[best].rel["3m"].median! * 100, 1)}) and the weakest <b>{label[worst]}</b> ({fmtSigned(t[worst].rel["3m"].median! * 100, 1)}). </> : null}
        {pre.length ? <>Before the filing these stocks had typically moved {fmtSigned(Math.max(...pre) * 100, 0)}% to {fmtSigned(Math.min(...pre) * 100, 0)}% against the index over three months, so some of the news may already have been in the price. </> : null}
        Medians, not forecasts: a few events per group, an ETF as the yardstick, and no allowance for what else happened to each company. Test date {study.as_of}.
      </p>
    </Panel>
  );
}

export default function CapacityNews() {
  const { bundle } = useData();
  const { ready } = useScreeners(["capacityNews", "capacityStudy"]);
  const [type, setType] = useState<EvType | "all">("all");
  const [range, setRange] = useState<string>("30");
  const [sort, setSort] = useState<SortKey>("new");
  const [heldOnly, setHeldOnly] = useState(false);
  const [mattersOnly, setMattersOnly] = useState(false);
  const [sub, setSub] = useState("all");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(40);
  const ms = bundle.momentum_screeners as any;
  const all: Ev[] = ms?.capacityNews?.rows ?? [];
  const study: Study | undefined = ms?.capacityStudy?.rows?.[0];

  const inRange = useMemo(() => all.filter((e) => daysAgo(e.date) <= Number(range)), [all, range]);
  const counts = useMemo(() => Object.fromEntries(TYPES.map((t) => [t, { n: inRange.filter((e) => e.type === t).length, held: inRange.filter((e) => e.type === t && e.held).length }])) as Record<EvType, { n: number; held: number }>, [inRange]);
  const subs = useMemo(() => [...new Set(inRange.filter((e) => type === "all" || e.type === type).map((e) => e.subtype))].sort(), [inRange, type]);
  const list = useMemo(() => {
    const qq = q.trim().toUpperCase();
    const f = inRange.filter((e) => (type === "all" || e.type === type) && (sub === "all" || e.subtype === sub) && (!heldOnly || e.held) && (!mattersOnly || e.big || e.held) && (!qq || e.symbol.includes(qq) || e.name.toUpperCase().includes(qq)));
    const by: Record<SortKey, (a: Ev, b: Ev) => number> = {
      new: (a, b) => b.date.localeCompare(a.date) || (b.held ? 1 : 0) - (a.held ? 1 : 0),
      size: (a, b) => (b.size_vs_mcap ?? -1) - (a.size_vs_mcap ?? -1),
      rs: (a, b) => (b.perf?.since_rel ?? -9) - (a.perf?.since_rel ?? -9),
      value: (a, b) => (b.value_cr ?? -1) - (a.value_cr ?? -1),
    };
    return [...f].sort(by[sort]);
  }, [inRange, type, sub, heldOnly, mattersOnly, q, sort]);

  if (!ready) return <ScreenerLoading label="capacity and technology announcements" />;
  const total = inRange.length;
  return (
    <div className="dbv">
      <style>{VIZ_CSS + CAP_CSS}</style>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold">🏭 Capacity & Technology</h1>
        <span className="text-xs text-slate-500">new capacity, plants going live, new technology and the announcements that matter · from NSE filings{ms?.capacityNews?.as_of ? ` · as of ${ms.capacityNews.as_of}` : ""} · {all.length} stored</span>
      </div>
      <details className="my-2">
        <summary>How to read this page</summary>
        <p className="text-xs text-slate-500 mt-2" style={{ maxWidth: "80ch", lineHeight: 1.6 }}>
          Every row is a filing a company made to the exchange. The category comes from the exchange's own label (capacity addition, commercial production started, product launch, technology tie-up, order, acquisition...)
          plus board outcomes and press releases that talk about capex or technology. The size, capacity and timeline are picked out of the filing by a program: <b>check the document</b>. "Against the company" sets the size next
          to its market cap and annual sales, because ₹200 Cr is a footnote to a large company and a different business to a small one: a row is marked as mattering when it is at least 8% of market cap or 25% of sales.
          The move since is against the Nifty Midcap 150. Not advice and not a forecast.
        </p>
      </details>

      {all.length === 0 ? (
        <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg p-6 text-center">No announcements stored yet. Ask Claude to run the CapacityTracker skill.</div>
      ) : (
        <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="cap-seg" role="group" aria-label="Time range">
              {RANGES.map(([k, l]) => <button key={k} aria-pressed={range === k} onClick={() => { setRange(k); setShown(40); }}>{l}</button>)}
            </div>
            <span className="text-xs text-slate-500">{total} announcements in this window</span>
          </div>

          <div role="group" aria-label="Filter by kind" style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
            {TYPES.map((t) => {
              const m = TYPE_META[t];
              return (
                <button key={t} className="cap-tile" aria-pressed={type === t} onClick={() => { setType(type === t ? "all" : t); setSub("all"); setShown(40); }} style={{ borderTop: `4px solid ${m.color}` }}>
                  <div style={{ fontSize: 12, color: "var(--ink2)" }}>{m.icon} {m.label}</div>
                  <div style={{ fontSize: 26, fontWeight: 600, color: "var(--ink)", lineHeight: 1.2 }}>{counts[t].n}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{counts[t].held ? <b style={{ color: "var(--ink)" }}>{counts[t].held} in your holdings</b> : "none in your holdings"} · {m.blurb}</div>
                </button>
              );
            })}
          </div>

          <div className="dbv-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
            <Panel title="Filings per week" hint="last 13 weeks, by kind">
              <Guard label="the weekly chart"><WeeklyStack events={all} /></Guard>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 11, color: "var(--ink2)", marginTop: 4 }}>
                {TYPES.map((t) => <span key={t}><Key color={TYPE_META[t].color} />{TYPE_META[t].label}</span>)}
              </div>
            </Panel>
            {study && <Guard label="the study"><StudyPanel study={study} /></Guard>}
          </div>

          <section className="dbv-detail" style={{ overflow: "hidden" }}>
            <div className="flex flex-wrap items-center gap-2" style={{ padding: "12px 16px", borderBottom: "1px solid var(--grid)" }}>
              <input value={q} onChange={(e) => { setQ(e.target.value); setShown(40); }} placeholder="Find a company" aria-label="Find a company" className="px-2 py-1 border border-slate-300 rounded text-sm w-44" />
              <select value={sub} onChange={(e) => { setSub(e.target.value); setShown(40); }} aria-label="Kind of announcement" className="border border-slate-300 rounded px-1.5 py-1 text-xs text-slate-700">
                <option value="all">Every kind{type === "all" ? "" : ` of ${TYPE_META[type].label.toLowerCase()}`}</option>
                {subs.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button className="cap-toggle" aria-pressed={heldOnly} onClick={() => { setHeldOnly(!heldOnly); setShown(40); }}>My holdings</button>
              <button className="cap-toggle" aria-pressed={mattersOnly} onClick={() => { setMattersOnly(!mattersOnly); setShown(40); }} title="at least 8% of market cap or 25% of sales, or a stock you hold">Matters most</button>
              <label className="text-xs text-slate-500 ml-auto">Sort{" "}
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="border border-slate-300 rounded px-1.5 py-1 text-xs text-slate-700">
                  {(Object.keys(SORTS) as SortKey[]).map((k) => <option key={k} value={k}>{SORTS[k]}</option>)}
                </select>
              </label>
            </div>
            {list.length === 0 ? (
              <div className="text-sm text-slate-500 p-6 text-center">Nothing matches those filters.</div>
            ) : (
              <>
                <div style={{ fontSize: 11.5, color: "var(--muted)", padding: "8px 16px" }}>{list.length} shown</div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {list.slice(0, shown).map((e) => <Guard key={e.id} label={`the ${e.symbol} row`}><Row e={e} /></Guard>)}
                </ul>
                {list.length > shown && (
                  <div style={{ padding: 16, textAlign: "center", borderTop: "1px solid var(--grid)" }}>
                    <button className="cap-toggle" onClick={() => setShown(shown + 40)}>Show 40 more ({list.length - shown} left)</button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
