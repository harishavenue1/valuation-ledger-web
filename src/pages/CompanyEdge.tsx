import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useData, useScreeners } from "../App";
import { ScreenerLoading } from "../components/ScreenerTable";
import { DeltaBars, Guard, VIZ_CSS } from "../components/DebateViz";
import { PeerBars, StatedBars, YearCounts } from "../components/EdgeViz";

// Company Edge — added 2026-11-01 ("a specific page, highlighting speciality of a company, IP owned, market share ... what is capability, capacity, total addressable market ... include reference to concall
// highlight of specific line over many years ... also highlight the sector it is into, like cybersecurity, engineering").
//
// The CompanyEdge skill (~/.claude/skills/CompanyEdge) reads, for each holding of 1% or more, every concall transcript Screener lists (as far back as it goes) and keeps the management sentences that talk about
// capability / speciality, capacity, market size, market share and IP / technology — VERBATIM, with the call date, the page and a link to the transcript — plus the numbers stated in them, the listed peer
// group and the stock's sector themes. No model writes any of it: the lines are picked by pattern and ranked by plain rules, so the page says to read them in context. An analyst's question is dropped, a
// management claim is not verified: a company saying "we hold 40% of the market" is the company saying it.

type Q = { date: string; year: number; page: number; speaker?: string | null; text: string; url: string; score: number; numbers?: { share_pct?: number; utilisation_pct?: number; rd_pct_sales?: number; tam?: string; capacity?: string } };
type Theme = "capability" | "capacity" | "market" | "share" | "ip";
interface Edge {
  symbol: string; name: string; as_of: string; about?: string | null; key_points?: string | null; classification?: string[] | null; website?: string | null; weight?: number | null;
  mcap_cr?: number | null; sales_cr?: number | null; cwip_cr?: number | null; fixed_assets_cr?: number | null; fixed_assets_chg?: Record<string, number | null>; revenue_hist?: number[] | null;
  sectors?: { tag: string; score: number; words: string[] }[];
  peers?: { chain?: string[]; rows: { symbol: string; name: string; sales_q: number | null; mcap_cr: number | null; pe?: number | null; roce?: number | null; sales_var?: number | null }[]; share_of_sales_pct?: number | null; rank_by_mcap?: number | null } | null;
  quotes: Record<Theme, Q[]>;
  calls: { date: string; year: number; transcript: string; ppt?: string | null }[];
  coverage: { calls_listed: number; with_transcript: number; transcripts_read: number; from_year: number; oldest?: string | null };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const cr = (v: number | null | undefined) => (!isNum(v) ? "—" : v >= 100000 ? `₹${(v / 100000).toFixed(1)}L Cr` : v >= 1000 ? `₹${(v / 1000).toFixed(1)}k Cr` : `₹${Math.round(v)} Cr`);
const t = (d: string) => Date.parse(`1 ${d}`);
const fmt = (v: number, d = 0) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`;

const EDGE_CSS = `
.edge-q{margin:0;padding:10px 14px;border-left:3px solid var(--ring);background:var(--wash);border-radius:0 8px 8px 0;font-size:13.5px;line-height:1.55;color:var(--ink);quotes:none}
.edge-q b{font-weight:600;background:var(--surface);border-radius:3px;padding:0 3px}
.edge-meta{display:flex;flex-wrap:wrap;gap:2px 10px;font-size:11.5px;color:var(--muted);margin-bottom:4px;align-items:center}
.edge-meta a{color:var(--pos)}
.edge-year{position:sticky;top:64px;z-index:1;background:var(--surface);font-size:12px;font-weight:600;color:var(--ink);padding:6px 0;border-bottom:1px solid var(--grid);margin:14px 0 10px;display:flex;gap:8px;align-items:baseline}
.edge-year span{font-weight:400;color:var(--muted)}
.edge-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--ring);border-radius:999px;padding:1px 9px;font-size:11.5px;color:var(--ink);background:var(--surface)}
.edge-sector{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 12px;font-size:12.5px;font-weight:600;color:var(--ink);border:1px solid var(--ink)}
.edge-sector.first{background:var(--ink);color:var(--surface)}
.edge-numchip{display:inline-block;font-size:11px;font-weight:600;border-radius:4px;padding:0 6px;margin-right:6px;background:var(--surface);border:1px solid var(--s1);color:var(--ink)}
`;

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="dbv-panel">
      <div className="dbv-panel-h"><h3>{title}</h3>{hint && <span>{hint}</span>}</div>
      {children}
    </section>
  );
}
const Muted = ({ children }: { children: ReactNode }) => <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>{children}</div>;

/** numbers in a sentence in bold, so the eye finds the figure first */
function Quote({ text }: { text: string }) {
  return <>{text.split(/(\d[\d,.]*\s?(?:%|crores?|billion|million|trillion|MW|GW|MTPA|TPA|lakh)?)/gi).map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p))}</>;
}

const STATED_LABEL: Record<string, string> = { share_pct: "stated share", utilisation_pct: "stated utilisation", rd_pct_sales: "R&D of sales", tam: "market size", capacity: "capacity" };
function NumChips({ n }: { n?: Q["numbers"] }) {
  if (!n) return null;
  return <>{Object.entries(n).map(([k, v]) => <span key={k} className="edge-numchip" title="figure read from this sentence by a program">{STATED_LABEL[k] ?? k}: {typeof v === "number" ? `${v}${k.endsWith("pct") || k === "rd_pct_sales" ? "%" : ""}` : v}</span>)}</>;
}

/** every line management said on a theme, newest year first, each with its call date, page and a link to the transcript */
function Timeline({ quotes, empty }: { quotes: Q[]; empty: string }) {
  const [all, setAll] = useState(false);
  if (!quotes.length) return <Muted>{empty}</Muted>;
  const years = [...new Set(quotes.map((q) => q.year))].sort((a, b) => b - a);
  const shownYears = all ? years : years.slice(0, 3);
  return (
    <div>
      {shownYears.map((y) => {
        const qs = quotes.filter((q) => q.year === y).sort((a, b) => t(b.date) - t(a.date));
        return (
          <div key={y}>
            <div className="edge-year">{y}<span>{qs.length} line{qs.length === 1 ? "" : "s"}</span></div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
              {qs.map((q, i) => (
                <li key={`${q.date}-${q.page}-${i}`}>
                  <div className="edge-meta">
                    <b style={{ color: "var(--ink2)" }}>{q.date}</b>
                    <a href={`${q.url}#page=${q.page}`} target="_blank" rel="noreferrer" title="opens the transcript at this page">transcript p.{q.page} ↗</a>
                    {q.speaker && <span>{q.speaker}</span>}
                  </div>
                  <blockquote className="edge-q"><Quote text={q.text} /></blockquote>
                  {q.numbers && <div style={{ marginTop: 4 }}><NumChips n={q.numbers} /></div>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {years.length > 3 && (
        <button className="text-xs mt-3 hover:underline" style={{ color: "var(--pos)" }} onClick={() => setAll(!all)}>{all ? "Show only the latest three years" : `Show the earlier ${years.length - 3} year${years.length - 3 === 1 ? "" : "s"} (${quotes.filter((q) => !years.slice(0, 3).includes(q.year)).length} lines)`}</button>
      )}
    </div>
  );
}

/** a stated number across the calls, in date order, from the quotes that carried it */
function stated(quotes: Q[], key: "share_pct" | "utilisation_pct" | "rd_pct_sales") {
  const byDate = new Map<string, Q>();
  for (const q of quotes) if (isNum(q.numbers?.[key]) && !byDate.has(q.date)) byDate.set(q.date, q);
  return [...byDate.values()].sort((a, b) => t(a.date) - t(b.date)).map((q) => ({ label: q.date, v: q.numbers![key] as number, tip: <><b>{q.numbers![key]}%</b> <span className="sub">{q.date} · p.{q.page}</span><div className="sub" style={{ whiteSpace: "normal", maxWidth: 280 }}>{q.text.slice(0, 160)}…</div></> }));
}

function figures(quotes: Q[], key: "tam" | "capacity") {
  const seen = new Set<string>(), out: { date: string; v: string; q: Q }[] = [];
  for (const q of [...quotes].sort((a, b) => t(b.date) - t(a.date))) {
    const v = q.numbers?.[key];
    if (v && !seen.has(`${q.date}|${v}`)) { seen.add(`${q.date}|${v}`); out.push({ date: q.date, v, q }); }
  }
  return out;
}
function FigureList({ items, empty }: { items: { date: string; v: string; q: Q }[]; empty: string }) {
  if (!items.length) return <Muted>{empty}</Muted>;
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{items.slice(0, 10).map((f, i) => <a key={i} className="edge-chip" href={`${f.q.url}#page=${f.q.page}`} target="_blank" rel="noreferrer" title={f.q.text}><b>{f.v}</b><span style={{ color: "var(--muted)" }}>{f.date} ↗</span></a>)}</div>;
}

const IP_WORDS: [string, RegExp][] = [["patents", /patent/i], ["proprietary", /proprietary/i], ["accreditations", /accreditation/i], ["USFDA / DMF / ANDA", /USFDA|\bDMF|\bANDA/], ["R&D", /R&D|research and development/i], ["in-house", /in-house/i], ["licences", /licen[cs]/i], ["know-how", /know[- ]how/i]];

// ---------------------------------------------------------------------------------------------------------------------------------------------------
type Tab = "speciality" | "capacity" | "market" | "ip";
const TABS: [Tab, string][] = [["speciality", "Speciality"], ["capacity", "Capacity"], ["market", "Market & share"], ["ip", "IP & technology"]];

function SpecialityTab({ e }: { e: Edge }) {
  const kp = (e.key_points ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel title="What the company says it is" hint="Screener business profile">
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: "var(--ink)", maxWidth: "76ch", }}>{(e.about || "No business description stored.").replace(/\s*\n\s*/g, " ")}</p>
        {kp.length > 0 && <ul style={{ margin: "12px 0 0", paddingLeft: 18, display: "grid", gap: 4, fontSize: 13, lineHeight: 1.55, color: "var(--ink2)", maxWidth: "76ch" }}>{kp.slice(0, 14).map((l, i) => <li key={i}>{l}</li>)}</ul>}
      </Panel>
      <Panel title="In their words, over the years" hint="capability, what only they can do, how they differ">
        <Timeline quotes={e.quotes.capability ?? []} empty="No management line about a distinct capability was picked out of the calls read." />
      </Panel>
    </div>
  );
}

function CapacityTab({ e }: { e: Edge }) {
  const util = stated(e.quotes.capacity ?? [], "utilisation_pct");
  const caps = figures(e.quotes.capacity ?? [], "capacity");
  const rh = e.revenue_hist ?? [];
  const sales = (n: number) => (rh.length > n && rh[rh.length - 1 - n] > 0 ? ((rh[rh.length - 1] / rh[rh.length - 1 - n]) - 1) * 100 : null);
  const fa = e.fixed_assets_chg ?? {};
  const wip = isNum(e.cwip_cr) && isNum(e.fixed_assets_cr) && e.fixed_assets_cr > 0 ? (e.cwip_cr / e.fixed_assets_cr) * 100 : null;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="dbv-grid">
        <Panel title="Is the asset base growing with sales?" hint="change over 1, 2 and 3 years">
          <DeltaBars rows={[
            { label: "Fixed assets · 1 yr", value: fa["1y"] }, { label: "Sales · 1 yr", value: sales(1) },
            { label: "Fixed assets · 2 yrs", value: fa["2y"] }, { label: "Sales · 2 yrs", value: sales(2) },
            { label: "Fixed assets · 3 yrs", value: fa["3y"] }, { label: "Sales · 3 yrs", value: sales(3) },
          ]} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 10, fontSize: 12, color: "var(--ink2)" }}>
            <span>Fixed assets <b style={{ color: "var(--ink)" }}>{cr(e.fixed_assets_cr)}</b></span>
            <span>Work in progress <b style={{ color: "var(--ink)" }}>{cr(e.cwip_cr)}</b>{wip != null ? ` (${wip.toFixed(0)}% of assets)` : ""}</span>
          </div>
          <p className="dbv-note">Work in progress is capacity being built and not yet earning. A high share of it with sales not yet following is the capex still to pay off.</p>
        </Panel>
        <Panel title="Capacity utilisation, as stated" hint="each bar is a call; hover for the sentence">
          <StatedBars points={util} max={100} color="var(--s3)" />
        </Panel>
      </div>
      <Panel title="Capacity figures management quoted" hint="click to open the transcript at that page">
        <FigureList items={caps} empty="No installed-capacity figure with a unit was picked out of the calls read." />
      </Panel>
      <Panel title="In their words, over the years" hint="capacity added, utilisation, new plants">
        <Timeline quotes={e.quotes.capacity ?? []} empty="No capacity line was picked out of the calls read." />
      </Panel>
    </div>
  );
}

function MarketTab({ e }: { e: Edge }) {
  const share = stated(e.quotes.share ?? [], "share_pct");
  const tam = figures(e.quotes.market ?? [], "tam");
  const p = e.peers;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="dbv-grid">
        <Panel title="Market share, as stated" hint="each bar is a call; hover for the sentence">
          <StatedBars points={share} max={100} />
          <p className="dbv-note">{share.length ? "A stated share can be for one product, one region or an associate company, not the whole business: read the line behind each bar (hover, or see the lines below)." : "Management never put a percentage on its share in the calls read. That is common: it is shown as not stated rather than guessed."}</p>
        </Panel>
        <Panel title="Against its listed peers" hint={p?.chain?.length ? p.chain.join(" › ") : "Screener peer group"}>
          {p?.rows?.length ? (
            <>
              <PeerBars rows={p.rows} me={e.symbol} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 8, fontSize: 12, color: "var(--ink2)" }}>
                {isNum(p.share_of_sales_pct) && <span>Share of the peer group's sales <b style={{ color: "var(--ink)" }}>{p.share_of_sales_pct}%</b></span>}
                {isNum(p.rank_by_mcap) && <span>Market-cap rank <b style={{ color: "var(--ink)" }}>{p.rank_by_mcap} of {p.rows.length}</b></span>}
              </div>
              <p className="dbv-note">The peer group is Screener's, not an industry-wide market: it is the listed companies it compares this one with, last quarter's sales, so it understates any unlisted or foreign competition.</p>
            </>
          ) : <Muted>No listed peer group found.</Muted>}
        </Panel>
      </div>
      <Panel title="Total addressable market, as quoted" hint="click to open the transcript at that page">
        <FigureList items={tam} empty="No market size with a currency and unit was picked out of the calls read." />
      </Panel>
      <Panel title="Market share and leadership, in their words" hint="over the years">
        <Timeline quotes={e.quotes.share ?? []} empty="No line about market share or leadership was picked out of the calls read." />
      </Panel>
      <Panel title="Market size and demand, in their words" hint="over the years">
        <Timeline quotes={e.quotes.market ?? []} empty="No line about the size of the market was picked out of the calls read." />
      </Panel>
    </div>
  );
}

function IpTab({ e }: { e: Edge }) {
  const qs = e.quotes.ip ?? [];
  const rd = stated(qs, "rd_pct_sales");
  const counts = IP_WORDS.map(([label, rx]) => [label, qs.filter((q) => rx.test(q.text)).length] as [string, number]).filter(([, n]) => n);
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel title="What kind of protection and know-how comes up" hint="calls where it was mentioned">
        {counts.length ? <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{counts.map(([l, n]) => <span key={l} className="edge-chip"><b>{l}</b><span style={{ color: "var(--muted)" }}>{n} line{n === 1 ? "" : "s"}</span></span>)}</div> : <Muted>No patent, proprietary-process, approval or accreditation line was picked out of the calls read.</Muted>}
        <p className="dbv-note">Management mentioning a word is not proof a patent exists: open the transcript. Patents themselves are not in our data; where a call states an approval or accreditation it is quoted below.</p>
      </Panel>
      {rd.length > 0 && <Panel title="R&D spend as a share of sales, as stated" hint="each bar is a call"><StatedBars points={rd} max={Math.max(10, Math.ceil(Math.max(...rd.map((p) => p.v))))} color="var(--s2)" /></Panel>}
      <Panel title="In their words, over the years" hint="approvals, accreditations, technology, R&D">
        <Timeline quotes={qs} empty="No IP or technology line was picked out of the calls read." />
      </Panel>
    </div>
  );
}

function Detail({ e, tab, setTab }: { e: Edge; tab: Tab; setTab: (t: Tab) => void }) {
  const cov = e.coverage;
  const n = { speciality: e.quotes.capability?.length ?? 0, capacity: e.quotes.capacity?.length ?? 0, market: (e.quotes.market?.length ?? 0) + (e.quotes.share?.length ?? 0), ip: e.quotes.ip?.length ?? 0 };
  const onKey = (ev: KeyboardEvent) => {
    const i = TABS.findIndex(([k]) => k === tab);
    const next = ev.key === "ArrowRight" ? TABS[(i + 1) % TABS.length][0] : ev.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length][0] : null;
    if (next) { ev.preventDefault(); setTab(next); document.getElementById(`edge-tab-${next}`)?.focus(); }
  };
  const sh = e.peers?.share_of_sales_pct;
  return (
    <article id="edge-detail" className="dbv-detail" aria-label={`${e.symbol} company edge`}>
      <header className="dbv-dhead">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--ink)", lineHeight: 1.2 }}>{e.symbol}</h2>
          <span style={{ fontSize: 13, color: "var(--ink2)" }}>{e.name}</span>
          {isNum(e.weight) && <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">held · {e.weight.toFixed(1)}% of portfolio</span>}
          {e.website && <a href={e.website} target="_blank" rel="noreferrer" style={{ marginLeft: "auto", fontSize: 12, color: "var(--pos)" }}>company website ↗</a>}
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: "var(--ink2)", marginBottom: 6 }}>Sector and theme</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(e.sectors ?? []).length ? e.sectors!.map((s, i) => <span key={s.tag} className={`edge-sector${i === 0 ? " first" : ""}`} title={`words seen: ${s.words.join(", ")}`}>{s.tag}</span>) : <span style={{ fontSize: 12, color: "var(--muted)" }}>no clear theme found in the business text</span>}
          </div>
          {(e.peers?.chain?.length || e.classification?.length) ? <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>Screener industry: {(e.peers?.chain?.length ? e.peers.chain : e.classification)!.join(" › ")}</div> : null}
        </div>
      </header>

      <div className="dbv-kpis">
        <div className="dbv-kpi"><div style={{ fontSize: 11, color: "var(--ink2)" }}>Market cap</div><div style={{ fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>{cr(e.mcap_cr)}</div><div style={{ fontSize: 11, minHeight: 15 }} /></div>
        <div className="dbv-kpi"><div style={{ fontSize: 11, color: "var(--ink2)" }}>Sales (last year)</div><div style={{ fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>{cr(e.sales_cr)}</div><div style={{ fontSize: 11, minHeight: 15 }} /></div>
        <div className="dbv-kpi"><div style={{ fontSize: 11, color: "var(--ink2)" }}>Share of peers' sales</div><div style={{ fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>{isNum(sh) ? `${sh}%` : "—"}</div><div style={{ fontSize: 11, color: "var(--muted)", minHeight: 15 }}>{isNum(e.peers?.rank_by_mcap) ? `${e.peers!.rank_by_mcap} of ${e.peers!.rows.length} by market cap` : ""}</div></div>
        <div className="dbv-kpi"><div style={{ fontSize: 11, color: "var(--ink2)" }}>Concalls read</div><div style={{ fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>{cov.transcripts_read}</div><div style={{ fontSize: 11, color: "var(--muted)", minHeight: 15 }}>{cov.oldest ? `back to ${cov.oldest.slice(-4)}` : "no transcripts listed"}</div></div>
        <div className="dbv-kpi" style={{ gridColumn: "span 2" }}><div style={{ fontSize: 11, color: "var(--ink2)", marginBottom: 4 }}>Calls read per year</div>{e.calls.length ? <YearCounts calls={e.calls} /> : <div style={{ fontSize: 12, color: "var(--muted)" }}>Screener lists no transcripts for this company.</div>}</div>
      </div>

      <div role="tablist" aria-label="Edge" className="dbv-tabs" onKeyDown={onKey}>
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" id={`edge-tab-${k}`} aria-selected={tab === k} aria-controls="edge-panel" tabIndex={tab === k ? 0 : -1} className="dbv-tab" onClick={() => setTab(k)}>{label}<span className="n">{n[k]}</span></button>
        ))}
      </div>
      <div role="tabpanel" id="edge-panel" aria-labelledby={`edge-tab-${tab}`} className="dbv-body">
        <Guard label={`the ${tab} tab`}>
          {tab === "speciality" && <SpecialityTab e={e} />}
          {tab === "capacity" && <CapacityTab e={e} />}
          {tab === "market" && <MarketTab e={e} />}
          {tab === "ip" && <IpTab e={e} />}
        </Guard>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
export default function CompanyEdge() {
  const { bundle } = useData();
  const { ready } = useScreeners(["companyEdge"]);
  const [sector, setSector] = useState("all");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("speciality");
  const [sel, setSel] = useState<string>(() => (typeof window !== "undefined" ? decodeURIComponent(window.location.hash.slice(1)).toUpperCase() : ""));
  const rows: Edge[] = (bundle.momentum_screeners as any)?.companyEdge?.rows ?? [];
  const sectors = useMemo(() => { const c = new Map<string, number>(); rows.forEach((r) => (r.sectors ?? []).slice(0, 2).forEach((s) => c.set(s.tag, (c.get(s.tag) ?? 0) + 1))); return [...c.entries()].sort((a, b) => b[1] - a[1]); }, [rows]);
  const list = useMemo(() => rows.filter((r) => (sector === "all" || (r.sectors ?? []).slice(0, 2).some((s) => s.tag === sector)) && (!q || r.symbol.includes(q.toUpperCase()) || r.name.toUpperCase().includes(q.toUpperCase()))).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)), [rows, sector, q]);
  const current = list.find((r) => r.symbol === sel) ?? list[0];
  useEffect(() => {
    const onHash = () => setSel(decodeURIComponent(window.location.hash.slice(1)).toUpperCase());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (!current || typeof window === "undefined") return;
    window.history.replaceState(null, "", `#${current.symbol}`);
    document.getElementById(`edgr-${current.symbol}`)?.scrollIntoView({ block: "nearest" });
  }, [current?.symbol]);
  if (!ready) return <ScreenerLoading label="company edge" />;
  const pick = (s: string, focus = false) => {
    setSel(s);
    if (focus) document.getElementById(`edgr-${s}`)?.focus();
    else if (typeof window !== "undefined" && window.innerWidth < 1024) setTimeout(() => document.getElementById("edge-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const onListKey = (ev: KeyboardEvent) => {
    if (!current || (ev.key !== "ArrowDown" && ev.key !== "ArrowUp")) return;
    const i = list.findIndex((r) => r.symbol === current.symbol);
    const n = list[Math.min(list.length - 1, Math.max(0, i + (ev.key === "ArrowDown" ? 1 : -1)))];
    if (n) { ev.preventDefault(); pick(n.symbol, true); }
  };
  const ms = (bundle.momentum_screeners as any)?.companyEdge;
  return (
    <div className="dbv">
      <style>{VIZ_CSS + EDGE_CSS}</style>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold">🧬 Company Edge</h1>
        <span className="text-xs text-slate-500">what each company is good at, its capacity, its market and its IP, in management's own words over the years · {rows.length} holdings{ms?.as_of ? ` · as of ${ms.as_of}` : ""}</span>
      </div>
      <details className="my-2">
        <summary>How to read this page</summary>
        <p className="text-xs text-slate-500 mt-2" style={{ maxWidth: "80ch", lineHeight: 1.6 }}>
          For each stock you hold at 1% or more, every concall transcript Screener lists was read and the management sentences about capability, capacity, market size, market share and IP or technology were kept <b>word for word</b>,
          with the call date, the page and a link that opens the transcript at that page. A program picks them by pattern, so some lines are looser than others: read them in context. A line is what the company
          <i> said</i>, not something checked. Figures such as "45% share" or "85% utilisation" are read from those sentences and charted call by call. Sector and theme come from the words in the business description and the
          calls. Patents are not in our data. Not advice.
        </p>
      </details>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Sector or theme" className="border border-slate-300 rounded px-1.5 py-1 text-xs text-slate-700">
          <option value="all">All sectors and themes</option>
          {sectors.map(([s, n]) => <option key={s} value={s}>{s} ({n})</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a company" aria-label="Find a company" className="ml-auto px-2 py-1 border border-slate-300 rounded text-sm w-40" />
      </div>
      {!current ? (
        <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg p-6 text-center">{rows.length ? "Nothing matches that filter." : "No company edge data yet. Ask Claude to run the CompanyEdge skill."}</div>
      ) : (
        <div className="dbv-layout">
          <Guard label="the list">
            <nav aria-label="Companies" className="dbv-list" onKeyDown={onListKey}>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {list.map((r) => (
                  <li key={r.symbol}>
                    <button id={`edgr-${r.symbol}`} className="dbv-row" aria-current={r.symbol === current.symbol} onClick={() => pick(r.symbol)}>
                      <span className="dbv-vbar" style={{ background: "var(--s1)" }} aria-hidden />
                      <span className="dbv-r1"><b style={{ fontWeight: 600 }}>{r.symbol}</b><span style={{ fontSize: 11, color: "var(--muted)" }}>{isNum(r.weight) ? `${r.weight.toFixed(1)}%` : ""}</span><span className="sp" /><span style={{ fontSize: 11, color: "var(--muted)" }}>{r.coverage.transcripts_read ? `${r.coverage.transcripts_read} calls` : "no calls"}</span></span>
                      <span className="dbv-r2" style={{ flexWrap: "wrap", gap: "2px 6px" }}>
                        {(r.sectors ?? []).slice(0, 2).map((s, i) => <span key={s.tag} style={{ fontWeight: i === 0 ? 600 : 400, color: i === 0 ? "var(--ink)" : "var(--ink2)" }}>{s.tag}{i === 0 && (r.sectors ?? []).length > 1 ? " ·" : ""}</span>)}
                        {!(r.sectors ?? []).length && <span style={{ color: "var(--muted)" }}>no theme found</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </Guard>
          <Guard label={`the ${current.symbol} detail`}><Detail key={current.symbol} e={current} tab={tab} setTab={setTab} /></Guard>
        </div>
      )}
    </div>
  );
}
