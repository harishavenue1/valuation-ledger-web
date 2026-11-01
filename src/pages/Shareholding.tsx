import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useData, useScreeners } from "../App";
import { ScreenerLoading } from "../components/ScreenerTable";
import { DeltaBars, Guard, VIZ_CSS, fmtSigned } from "../components/DebateViz";
import { HoldersBars, OwnershipStack, PledgeMeter, type OwnerKey } from "../components/OwnershipViz";

// Shareholding & Pledges — added 2026-11-01 ("maybe one more page for shareholding changes and pledges").
//
// The ShareholdingTracker skill (~/.claude/skills/ShareholdingTracker) reads Screener's shareholding tables (promoters, FIIs, DIIs and the public at each of the last 12 quarter ends, plus the number of shareholders and the
// promoters' pledged share where Screener reports one) and NSE's Regulation 29 feed (every acquisition or sale of 2% or more of a company, with who, how many shares, which mode and a link to the filing), flags what moved
// enough to look at, and pushes the `shareholdingChanges` key. No model writes any of it. Not covered: NSE's pledge and insider-trading endpoints return nothing to scripts, so pledges are today's figure only (no
// history) and insider trades are absent. A promoter-group "sale" can be a transfer within the group or to a family trust: the filing says which.

type Series = { labels: string[]; promoters: (number | null)[]; fiis: (number | null)[]; diis: (number | null)[]; public: (number | null)[]; others?: (number | null)[]; government?: (number | null)[]; shareholders: (number | null)[] };
type Ev = { date: string; who: string; promoter: boolean; kind: "Sale" | "Acquisition"; security?: string | null; mode?: string | null; shares?: number | null; pct?: number | null; after_pct?: number | null; url?: string | null };
interface Row {
  symbol: string; name: string; as_of: string; held: boolean; weight?: number | null; mcap_cr?: number | null; pledge_pct?: number | null; series: Series; yearly?: Series;
  delta: { promoter_q: number | null; promoter_y: number | null; fii_q: number | null; fii_y: number | null; dii_q: number | null; dii_y: number | null; public_y: number | null };
  holders_y_pct: number | null; flags: string[]; events: Ev[];
}
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const cr = (v: number | null | undefined) => (!isNum(v) ? "—" : v >= 100000 ? `₹${(v / 100000).toFixed(1)}L Cr` : v >= 1000 ? `₹${(v / 1000).toFixed(1)}k Cr` : `₹${Math.round(v)} Cr`);
const pts = (v: number | null | undefined, d = 1) => (isNum(v) ? `${fmtSigned(v, d)}` : "—");
const last = (a: (number | null)[] | undefined) => (a && a.length ? a[a.length - 1] : null);
const lakh = (v: number | null | undefined) => (!isNum(v) ? "—" : v >= 1e7 ? `${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)} lakh` : v.toLocaleString("en-IN"));

const FLAGS: Record<string, { label: string; icon: string; tip: string; bad?: boolean }> = {
  promoter_sell: { label: "Promoters selling", icon: "▼", tip: "promoter holding down 1 point or more in a quarter, or 3 points or more in a year", bad: true },
  promoter_buy: { label: "Promoters buying", icon: "▲", tip: "promoter holding up 1 point or more in a quarter, or 3 points or more in a year" },
  pledge: { label: "Pledged shares", icon: "🔒", tip: "Screener reports that promoters have pledged part of their holding", bad: true },
  promoter_sale_filing: { label: "Promoter sale filed", icon: "📄", tip: "a promoter-group sale of 2% or more was filed with the exchange in the last 6 months (it can be a transfer inside the group)", bad: true },
  fii_in: { label: "FIIs buying", icon: "🌍", tip: "FII holding up 3 points or more in a year" },
  fii_out: { label: "FIIs selling", icon: "🌍", tip: "FII holding down 3 points or more in a year", bad: true },
  dii_in: { label: "DIIs buying", icon: "🏦", tip: "domestic institutions up 3 points or more in a year" },
  dii_out: { label: "DIIs selling", icon: "🏦", tip: "domestic institutions down 3 points or more in a year", bad: true },
  retail_in: { label: "Retail crowding in", icon: "👥", tip: "the number of shareholders is up 25% or more in a year" },
};
const FLAG_ORDER = ["promoter_sell", "pledge", "promoter_sale_filing", "promoter_buy", "fii_in", "fii_out", "dii_in", "dii_out", "retail_in"];

const SORTS = { weight: "Portfolio weight", promoter: "Biggest promoter fall (1 yr)", fii: "Biggest FII rise (1 yr)", dii: "Biggest DII rise (1 yr)", pledge: "Highest pledge", holders: "Shareholders growth", mcap: "Market cap" } as const;
type SortKey = keyof typeof SORTS;

const SH_CSS = `
.sh-tile{all:unset;box-sizing:border-box;cursor:pointer;display:block;border:1px solid var(--ring);border-radius:12px;padding:10px 14px;background:var(--surface);min-width:0}
.sh-tile:hover{background:var(--wash)}.sh-tile:focus-visible{outline:2px solid var(--pos)}.sh-tile[aria-pressed="true"]{box-shadow:inset 0 0 0 2px var(--ink)}
.sh-toggle{font-size:12px;padding:5px 12px;border:1px solid var(--ring);border-radius:8px;background:var(--surface);color:var(--ink2)}
.sh-toggle[aria-pressed="true"]{background:var(--ink);color:var(--surface);border-color:var(--ink)}
.sh-ev{width:100%;border-collapse:collapse;font-size:12.5px;color:var(--ink)}
.sh-ev th{text-align:left;font-size:11px;font-weight:600;color:var(--ink2);padding:6px 10px;border-bottom:1px solid var(--grid);white-space:nowrap}
.sh-ev td{padding:8px 10px;border-top:1px solid var(--grid);vertical-align:top}
.sh-badge{display:inline-block;font-size:10.5px;font-weight:600;border-radius:999px;padding:0 7px;border:1px solid var(--s1);color:var(--ink);margin-left:6px;white-space:nowrap}
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

function Kpi({ label, value, sub, subColor }: { label: string; value: ReactNode; sub?: ReactNode; subColor?: string }) {
  return (
    <div className="dbv-kpi">
      <div style={{ fontSize: 11, color: "var(--ink2)" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: "var(--ink)", lineHeight: 1.3 }}>{value}</div>
      <div style={{ fontSize: 11, minHeight: 15, color: subColor ?? "var(--muted)" }}>{sub ?? ""}</div>
    </div>
  );
}
const tone = (v: number | null | undefined) => (!isNum(v) || v === 0 ? "var(--muted)" : v > 0 ? "var(--good-text)" : "var(--crit)");

function Detail({ r }: { r: Row }) {
  const s = r.series, d = r.delta;
  const noPromoter = s.promoters.every((v) => v == null);
  const sel = (k: OwnerKey) => s[k];
  return (
    <article id="sh-detail" className="dbv-detail" aria-label={`${r.symbol} shareholding`}>
      <header className="dbv-dhead">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--ink)", lineHeight: 1.2 }}>{r.symbol}</h2>
          <span style={{ fontSize: 13, color: "var(--ink2)" }}>{r.name}</span>
          {r.held && <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">held{isNum(r.weight) ? ` · ${r.weight.toFixed(1)}% of portfolio` : ""}</span>}
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{cr(r.mcap_cr)} · latest quarter {s.labels[s.labels.length - 1]}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {r.flags.length ? FLAG_ORDER.filter((f) => r.flags.includes(f)).map((f) => (
            <span key={f} title={FLAGS[f].tip} style={{ border: `1px solid ${FLAGS[f].bad ? "var(--crit)" : "var(--s3)"}`, borderRadius: 999, padding: "2px 11px", fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>{FLAGS[f].icon} {FLAGS[f].label}</span>
          )) : <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Nothing moved enough to flag.</span>}
        </div>
      </header>

      <div className="dbv-kpis">
        <Kpi label="Promoters" value={noPromoter ? "none" : `${last(s.promoters)}%`} sub={noPromoter ? "professionally managed" : `${pts(d.promoter_q)} pts last quarter`} subColor={tone(d.promoter_q)} />
        <Kpi label="FIIs" value={`${last(s.fiis) ?? "—"}%`} sub={`${pts(d.fii_y)} pts in a year`} subColor={tone(d.fii_y)} />
        <Kpi label="DIIs" value={`${last(s.diis) ?? "—"}%`} sub={`${pts(d.dii_y)} pts in a year`} subColor={tone(d.dii_y)} />
        <Kpi label="Public" value={`${last(s.public) ?? "—"}%`} sub={`${pts(d.public_y)} pts in a year`} subColor={tone(d.public_y)} />
        <Kpi label="Shareholders" value={isNum(last(s.shareholders)) ? lakh(last(s.shareholders)) : "—"} sub={isNum(r.holders_y_pct) ? `${fmtSigned(r.holders_y_pct, 0)}% in a year` : ""} subColor={r.holders_y_pct != null && r.holders_y_pct >= 25 ? "var(--warn)" : undefined} />
        <Kpi label="Promoter pledge" value={isNum(r.pledge_pct) ? `${r.pledge_pct}%` : "none flagged"} sub={isNum(r.pledge_pct) ? "of their holding" : "by Screener"} subColor={isNum(r.pledge_pct) ? "var(--crit)" : undefined} />
      </div>

      <div className="dbv-body" style={{ display: "grid", gap: 16 }}>
        <div className="dbv-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
          <Panel title="Who owns it" hint="share of the company at each quarter end">
            <Guard label="the ownership chart"><OwnershipStack labels={s.labels} series={{ promoters: sel("promoters"), fiis: sel("fiis"), diis: sel("diis"), public: sel("public") }} /></Guard>
            {noPromoter && <p className="dbv-note">No promoter holding is reported: the company is professionally managed, so a promoter flag cannot apply.</p>}
          </Panel>
          <Panel title="What changed" hint="in percentage points of the company">
            <DeltaBars rows={[
              { label: "Promoters · quarter", value: d.promoter_q }, { label: "Promoters · year", value: d.promoter_y },
              { label: "FIIs · quarter", value: d.fii_q }, { label: "FIIs · year", value: d.fii_y },
              { label: "DIIs · quarter", value: d.dii_q }, { label: "DIIs · year", value: d.dii_y },
              { label: "Public · year", value: d.public_y },
            ]} unit=" pts" />
            <p className="dbv-note">When the promoters' points fall and an institution's points rise by about the same, the shares usually went from one to the other (a block deal or an open-market sale).</p>
          </Panel>
        </div>

        <div className="dbv-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
          <Panel title="How many shareholders" hint="by quarter">
            <Guard label="the holders chart"><HoldersBars labels={s.labels} values={s.shareholders} /></Guard>
          </Panel>
          <Panel title="Pledge" hint="share of the promoters' holding pledged">
            {isNum(r.pledge_pct) ? <PledgeMeter pct={r.pledge_pct} /> : <Muted>Screener flags no pledge by the promoters of this company.</Muted>}
            <p className="dbv-note">A pledge means the promoters borrowed against their shares: if the price falls the lender can sell them. The exchange's pledge data is not available to us, so this is today's figure from Screener with no history.</p>
          </Panel>
        </div>

        <Panel title="Large acquisitions and sales filed with the exchange" hint="Regulation 29: a holder buying or selling 2% or more · last 6 months">
          {r.events.length ? (
            <div className="overflow-x-auto">
              <table className="sh-ev">
                <thead><tr><th>Filed</th><th>Who</th><th>What</th><th style={{ textAlign: "right" }}>Shares</th><th style={{ textAlign: "right" }}>% of company</th><th style={{ textAlign: "right" }}>Holds after</th><th>How</th><th /></tr></thead>
                <tbody>
                  {r.events.map((e, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: "nowrap" }}>{e.date}</td>
                      <td>{e.who}{e.promoter && <span className="sh-badge" title="a promoter or promoter-group entity">promoter group</span>}</td>
                      <td style={{ whiteSpace: "nowrap", fontWeight: 600, color: e.kind === "Sale" ? "var(--crit)" : "var(--good-text)" }}>{e.kind === "Sale" ? "▼ Sold" : "▲ Bought"}<span style={{ fontWeight: 400, color: "var(--muted)" }}> {e.security && e.security !== "Equity shares" ? e.security : ""}</span></td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{lakh(e.shares)}</td>
                      <td style={{ textAlign: "right" }}>{isNum(e.pct) ? `${e.pct}%` : "—"}</td>
                      <td style={{ textAlign: "right" }}>{isNum(e.after_pct) ? `${e.after_pct}%` : "—"}</td>
                      <td style={{ color: "var(--ink2)" }}>{e.mode ?? "—"}</td>
                      <td>{e.url && <a href={e.url} target="_blank" rel="noreferrer" style={{ color: "var(--pos)", whiteSpace: "nowrap" }}>filing ↗</a>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Muted>No acquisition or sale of 2% or more was filed for this company in the last 6 months.</Muted>}
          <p className="dbv-note">"Promoter group" selling can be a transfer inside the family or to a trust, which changes nothing for outside shareholders: the mode and the filing say which. Insider trades below 2% are not covered.</p>
        </Panel>
      </div>
    </article>
  );
}

export default function Shareholding() {
  const { bundle } = useData();
  const { ready } = useScreeners(["shareholdingChanges"]);
  const [flag, setFlag] = useState<string>("all");
  const [heldOnly, setHeldOnly] = useState(true);
  const [sort, setSort] = useState<SortKey>("weight");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string>(() => (typeof window !== "undefined" ? decodeURIComponent(window.location.hash.slice(1)).toUpperCase() : ""));
  const rows: Row[] = (bundle.momentum_screeners as any)?.shareholdingChanges?.rows ?? [];
  const hasUniverse = rows.some((r) => !r.held);
  const scope = useMemo(() => (heldOnly || !hasUniverse ? rows.filter((r) => r.held) : rows), [rows, heldOnly, hasUniverse]);
  const counts = useMemo(() => Object.fromEntries(FLAG_ORDER.map((f) => [f, scope.filter((r) => r.flags.includes(f)).length])), [scope]);
  const list = useMemo(() => {
    const f = scope.filter((r) => (flag === "all" || r.flags.includes(flag)) && (!q || r.symbol.includes(q.toUpperCase()) || (r.name ?? "").toUpperCase().includes(q.toUpperCase())));
    const by: Record<SortKey, (a: Row, b: Row) => number> = {
      weight: (a, b) => (b.weight ?? -1) - (a.weight ?? -1) || (b.mcap_cr ?? 0) - (a.mcap_cr ?? 0),
      promoter: (a, b) => (a.delta.promoter_y ?? 99) - (b.delta.promoter_y ?? 99),
      fii: (a, b) => (b.delta.fii_y ?? -99) - (a.delta.fii_y ?? -99),
      dii: (a, b) => (b.delta.dii_y ?? -99) - (a.delta.dii_y ?? -99),
      pledge: (a, b) => (b.pledge_pct ?? -1) - (a.pledge_pct ?? -1),
      holders: (a, b) => (b.holders_y_pct ?? -999) - (a.holders_y_pct ?? -999),
      mcap: (a, b) => (b.mcap_cr ?? 0) - (a.mcap_cr ?? 0),
    };
    return [...f].sort(by[sort]);
  }, [scope, flag, q, sort]);
  const current = list.find((r) => r.symbol === sel) ?? list[0];
  useEffect(() => {
    const onHash = () => setSel(decodeURIComponent(window.location.hash.slice(1)).toUpperCase());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (!current || typeof window === "undefined") return;
    window.history.replaceState(null, "", `#${current.symbol}`);
    document.getElementById(`shr-${current.symbol}`)?.scrollIntoView({ block: "nearest" });
  }, [current?.symbol]);
  if (!ready) return <ScreenerLoading label="shareholding changes" />;
  const pick = (s: string, focus = false) => {
    setSel(s);
    if (focus) document.getElementById(`shr-${s}`)?.focus();
    else if (typeof window !== "undefined" && window.innerWidth < 1024) setTimeout(() => document.getElementById("sh-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const onListKey = (ev: KeyboardEvent) => {
    if (!current || (ev.key !== "ArrowDown" && ev.key !== "ArrowUp")) return;
    const i = list.findIndex((r) => r.symbol === current.symbol);
    const n = list[Math.min(list.length - 1, Math.max(0, i + (ev.key === "ArrowDown" ? 1 : -1)))];
    if (n) { ev.preventDefault(); pick(n.symbol, true); }
  };
  const ms = (bundle.momentum_screeners as any)?.shareholdingChanges;
  return (
    <div className="dbv">
      <style>{VIZ_CSS + SH_CSS}</style>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold">🔒 Shareholding & Pledges</h1>
        <span className="text-xs text-slate-500">who owns each company and how that is changing: promoters, FIIs, DIIs, the public, pledges and large filings · {scope.length} companies{ms?.as_of ? ` · as of ${ms.as_of}` : ""}</span>
      </div>
      <details className="my-2">
        <summary>How to read this page</summary>
        <p className="text-xs text-slate-500 mt-2" style={{ maxWidth: "80ch", lineHeight: 1.6 }}>
          Ownership by quarter comes from Screener's shareholding tables (the company's own exchange filings). A tile flags a company when promoters moved by 1 point in a quarter or 3 points in a year, when institutions moved by
          3 points in a year, when the number of shareholders is up 25% in a year, when Screener reports a promoter pledge, or when a promoter-group sale of 2% or more was filed. The filings list is the exchange's
          Regulation 29 feed. Pledges are today's figure only, and insider trades below 2% are not covered: the exchange's own pledge and insider-trading data are not available to us. Not advice.
        </p>
      </details>

      <div role="group" aria-label="Filter by what changed" style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", margin: "12px 0" }}>
        {FLAG_ORDER.map((f) => (
          <button key={f} className="sh-tile" aria-pressed={flag === f} title={FLAGS[f].tip} onClick={() => setFlag(flag === f ? "all" : f)} style={{ borderTop: `3px solid ${FLAGS[f].bad ? "var(--crit)" : "var(--s3)"}` }}>
            <div style={{ fontSize: 11.5, color: "var(--ink2)" }}>{FLAGS[f].icon} {FLAGS[f].label}</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: "var(--ink)", lineHeight: 1.2 }}>{counts[f]}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {hasUniverse && <button className="sh-toggle" aria-pressed={heldOnly} onClick={() => setHeldOnly(!heldOnly)}>My holdings only</button>}
        <label className="text-xs text-slate-500">Sort{" "}
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="border border-slate-300 rounded px-1.5 py-1 text-xs text-slate-700">
            {(Object.keys(SORTS) as SortKey[]).map((k) => <option key={k} value={k}>{SORTS[k]}</option>)}
          </select>
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a company" aria-label="Find a company" className="ml-auto px-2 py-1 border border-slate-300 rounded text-sm w-40" />
      </div>

      {!current ? (
        <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg p-6 text-center">{rows.length ? "Nothing matches that filter." : "No shareholding data yet. Ask Claude to run the ShareholdingTracker skill."}</div>
      ) : (
        <div className="dbv-layout">
          <Guard label="the list">
            <nav aria-label="Companies" className="dbv-list" onKeyDown={onListKey}>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {list.map((r) => {
                  const bad = r.flags.some((f) => FLAGS[f]?.bad);
                  return (
                    <li key={r.symbol}>
                      <button id={`shr-${r.symbol}`} className="dbv-row" aria-current={r.symbol === current.symbol} onClick={() => pick(r.symbol)}>
                        <span className="dbv-vbar" style={{ background: bad ? "var(--crit)" : r.flags.length ? "var(--s3)" : "var(--grid)" }} aria-hidden />
                        <span className="dbv-r1"><b style={{ fontWeight: 600 }}>{r.symbol}</b><span style={{ fontSize: 11, color: "var(--muted)" }}>{isNum(r.weight) ? `${r.weight.toFixed(1)}%` : ""}</span><span className="sp" />
                          <span style={{ fontSize: 11.5, color: "var(--ink2)" }} title="promoter holding now, and its change over the year">{isNum(last(r.series.promoters)) ? `${last(r.series.promoters)}%` : "no promoter"}{isNum(r.delta.promoter_y) ? <b style={{ marginLeft: 6, color: tone(r.delta.promoter_y) }}>{pts(r.delta.promoter_y)}</b> : null}</span></span>
                        <span className="dbv-r2" style={{ gap: 8 }}>
                          {FLAG_ORDER.filter((f) => r.flags.includes(f)).slice(0, 5).map((f) => <span key={f} title={FLAGS[f].label} style={{ opacity: 0.95 }}>{FLAGS[f].icon}</span>)}
                          {!r.flags.length && <span style={{ color: "var(--muted)" }}>nothing flagged</span>}
                          <span style={{ flex: 1 }} />
                          {isNum(r.pledge_pct) && <span style={{ color: "var(--crit)", fontWeight: 600 }}>pledge {r.pledge_pct}%</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </Guard>
          <Guard label={`the ${current.symbol} detail`}><Detail key={current.symbol} r={current} /></Guard>
        </div>
      )}
    </div>
  );
}
