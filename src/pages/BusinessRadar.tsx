import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData, useScreeners } from "../App";
import RunButton from "../components/RunButton";
import { Signed } from "../components/ScreenerTable";
import { api } from "../lib/api";

// Business Radar — the qualitative side: what companies are DOING (orders,
// capex, M&A, approvals, guidance) rather than what their charts are doing.
// Data: api/_business.py accumulates tagged Google News headlines daily.

interface Item {
  d: string; // ISO date
  t: string; // headline
  s: string; // source
  u: string; // link
  g: string[]; // tags
  a: number | null; // ₹ crore mentioned in the headline
}
interface Radar {
  as_of: string | null;
  updated?: string;
  items: Record<string, Item[]>;
  names: Record<string, string>;
  stats?: Record<string, any>;
  keep_days?: number;
}

// weight of a story by its strongest tag; Risk counts against
const TAG_WEIGHT: Record<string, number> = {
  Order: 3,
  Capex: 3,
  "M&A / JV": 2,
  "Approval / Launch": 2,
  Partnership: 1.5,
  Funding: 1,
  Outlook: 1,
  "Concall / Presentation": 0.5,
  Risk: -2,
};
const TAG_ORDER = Object.keys(TAG_WEIGHT);
const TAG_CLASS: Record<string, string> = {
  Order: "bg-emerald-50 text-emerald-700 border-emerald-300",
  Capex: "bg-sky-50 text-sky-700 border-sky-300",
  "M&A / JV": "bg-violet-50 text-violet-700 border-violet-300",
  "Approval / Launch": "bg-teal-50 text-teal-700 border-teal-300",
  Partnership: "bg-indigo-50 text-indigo-700 border-indigo-300",
  Funding: "bg-amber-50 text-amber-700 border-amber-300",
  Outlook: "bg-slate-100 text-slate-700 border-slate-300",
  "Concall / Presentation": "bg-slate-100 text-slate-600 border-slate-300",
  Risk: "bg-red-50 text-red-700 border-red-300",
};
const PAGE_ROWS = 150;

function primaryTag(tags: string[]): string {
  return tags.slice().sort((a, b) => Math.abs(TAG_WEIGHT[b] ?? 0) - Math.abs(TAG_WEIGHT[a] ?? 0))[0] ?? "";
}
function ageDays(d: string, now: number): number {
  return Math.max(0, (now - new Date(d + "T00:00:00Z").getTime()) / 86400000);
}
function fmtCr(v: number | null | undefined): string {
  if (v == null || !isFinite(v) || v <= 0) return "";
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0);
}

interface Row {
  symbol: string;
  name: string;
  items: Item[]; // in window, newest first
  stories: number;
  tagCounts: Record<string, number>;
  score: number;
  valueCr: number; // distinct ₹ amounts on Order/Capex/M&A stories
  mcap: number | null;
  valuePct: number | null;
  m3: number | null;
  wrsi: number | null;
  dc: string;
  last: string;
}

export default function BusinessRadar() {
  const { bundle } = useData();
  useScreeners(["portfolioAllocation"]);
  const [radar, setRadar] = useState<Radar | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tech, setTech] = useState<Map<string, any>>(new Map());
  const [days, setDays] = useState(30);
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [minMcap, setMinMcap] = useState(0);
  const [onlyHold, setOnlyHold] = useState(false);
  const [onlyWatch, setOnlyWatch] = useState(false);
  const [hideRiskOnly, setHideRiskOnly] = useState(true);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"score" | "value" | "valuePct" | "latest">("score");
  const [open, setOpen] = useState<string | null>(null);
  const [full, setFull] = useState<Record<string, Item[]>>({});
  function toggleOpen(sym: string) {
    setOpen((o) => (o === sym ? null : sym));
    if (!full[sym]) {
      api
        .getBusinessRadarSymbol(sym)
        .then((r) => setFull((f) => ({ ...f, [sym]: r.items })))
        .catch(() => {});
    }
  }
  const [shown, setShown] = useState(PAGE_ROWS);

  useEffect(() => {
    let off = false;
    api
      .getBusinessRadar()
      .then((r: Radar) => !off && setRadar(r))
      .catch((e: any) => !off && setErr(String(e?.message ?? e)));
    api
      .getBhavTechnicals()
      .then((r) => !off && setTech(new Map((r.rows ?? []).map((x: any) => [x.symbol, x]))))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);

  const holdings = useMemo(() => {
    const rows = (bundle.momentum_screeners as any)?.portfolioAllocation?.rows ?? [];
    return new Set<string>(rows.map((r: any) => r.symbol));
  }, [bundle]);
  const watch = useMemo(() => new Set<string>(bundle.watchlist?.tickers ?? []), [bundle]);

  const rows = useMemo<Row[]>(() => {
    if (!radar) return [];
    const now = Date.now();
    const out: Row[] = [];
    for (const [sym, all] of Object.entries(radar.items)) {
      const inWin = all.filter((i) => ageDays(i.d, now) <= days);
      if (!inWin.length) continue;
      // one story per (strongest tag, ₹ amount) — outlets repeat the same news a dozen times
      const seen = new Set<string>();
      let score = 0;
      let valueCr = 0;
      const tagCounts: Record<string, number> = {};
      let stories = 0;
      for (const i of inWin) {
        const pt = primaryTag(i.g);
        const key = i.a != null ? `${pt}:${Math.round(i.a)}` : `${pt}:${i.t.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 50)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        stories++;
        for (const g of i.g) tagCounts[g] = (tagCounts[g] ?? 0) + 1;
        score += (TAG_WEIGHT[pt] ?? 0) * Math.pow(0.5, ageDays(i.d, now) / 30);
        if (i.a != null && ["Order", "Capex", "M&A / JV"].includes(pt)) valueCr += i.a;
      }
      const t = tech.get(sym);
      const mcap = t?.market_cap_cr ?? null;
      out.push({
        symbol: sym,
        name: radar.names[sym] ?? t?.name ?? sym,
        items: inWin,
        stories,
        tagCounts,
        score: Math.round(score * 10) / 10,
        valueCr,
        mcap,
        valuePct: mcap && valueCr ? (valueCr / mcap) * 100 : null,
        m3: t?.three_month_pct ?? null,
        wrsi: t?.rsi_w ?? null,
        dc: t?.dc_state ?? "",
        last: inWin[0].d,
      });
    }
    return out;
  }, [radar, days, tech]);

  const view = useMemo(() => {
    let r = rows;
    if (tags.size) r = r.filter((x) => Array.from(tags).some((g) => x.tagCounts[g]));
    if (hideRiskOnly) r = r.filter((x) => Object.keys(x.tagCounts).some((g) => g !== "Risk"));
    if (minMcap > 0) r = r.filter((x) => (x.mcap ?? 0) >= minMcap);
    if (onlyHold) r = r.filter((x) => holdings.has(x.symbol));
    if (onlyWatch) r = r.filter((x) => watch.has(x.symbol));
    const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((x) => x.symbol.toLowerCase().includes(needle) || x.name.toLowerCase().includes(needle));
    const by: Record<string, (x: Row) => number | string> = {
      score: (x) => x.score,
      value: (x) => x.valueCr,
      valuePct: (x) => x.valuePct ?? -1,
      latest: (x) => x.last,
    };
    const f = by[sort];
    return r.slice().sort((a, b) => (f(a) < f(b) ? 1 : f(a) > f(b) ? -1 : 0));
  }, [rows, tags, hideRiskOnly, minMcap, onlyHold, onlyWatch, q, sort, holdings, watch]);

  function toggleTag(g: string) {
    setTags((p) => {
      const n = new Set(p);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });
    setShown(PAGE_ROWS);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">🧭 Business Radar</h1>
        <span className="text-slate-500 text-sm">What companies are doing — orders, capex, M&A, approvals, guidance — not what the chart is doing</span>
        <span className="ml-auto">
          <RunButton screener="businessRadar" />
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Built daily from news headlines (one search per company, {radar?.stats?.universe ?? "~1,300"} companies: every stock above ₹1,000 Cr plus your holdings and watchlist). Each headline is tagged by
        keyword, ₹ amounts are read from it, and the history accumulates for {radar?.keep_days ?? 120} days — so this page gets richer every day. It is headlines, not filings: open the link to judge
        the substance.
        {radar?.as_of && <> Last refreshed {radar.as_of}.</>}
      </p>

      <details className="mb-3 text-xs text-slate-600">
        <summary className="cursor-pointer text-slate-500">How is this calculated?</summary>
        <div className="mt-2 space-y-1 max-w-4xl">
          <p>
            <b>Catalyst score</b> = for each distinct story in the window, its strongest tag's weight (Order 3, Capex 3, M&A/JV 2, Approval/Launch 2, Partnership 1.5, Funding 1, Outlook 1, Concall 0.5,
            Risk −2) halved every 30 days of age. Several outlets reporting the same order or capex count once.
          </p>
          <p>
            <b>Value ₹Cr</b> = the ₹ amounts on distinct Order, Capex and M&A stories (dollar amounts at a flat ₹88). <b>Value % mcap</b> compares it with the market cap: an ₹800 Cr order means far more to a
            ₹4,000 Cr company than to a ₹80,000 Cr one.
          </p>
          <p>Tags are keyword matches on the headline, so they will sometimes be wrong; the score is a way to find where to read, not a verdict.</p>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-xs text-slate-500">Window</span>
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`text-sm px-2.5 py-1 rounded-full border ${days === d ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600"}`}
          >
            {d}d
          </button>
        ))}
        <span className="mx-1 text-slate-300">|</span>
        {TAG_ORDER.map((g) => (
          <button
            key={g}
            onClick={() => toggleTag(g)}
            className={`text-xs px-2 py-1 rounded-full border ${tags.has(g) ? TAG_CLASS[g] + " font-medium" : "border-slate-300 text-slate-500"}`}
          >
            {g}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
        <label className="flex items-center gap-1.5 text-slate-600">
          Mcap ≥
          <input
            type="number"
            value={minMcap}
            min={0}
            onChange={(e) => setMinMcap(parseFloat(e.target.value) || 0)}
            className="w-20 px-1 py-0 text-right border border-slate-300 rounded bg-white text-slate-800"
          />
          Cr
        </label>
        <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer">
          <input type="checkbox" checked={onlyHold} onChange={(e) => setOnlyHold(e.target.checked)} /> My holdings
        </label>
        <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer">
          <input type="checkbox" checked={onlyWatch} onChange={(e) => setOnlyWatch(e.target.checked)} /> Watchlist
        </label>
        <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer" title="Hide companies whose only items in the window are risk headlines">
          <input type="checkbox" checked={hideRiskOnly} onChange={(e) => setHideRiskOnly(e.target.checked)} /> Hide risk-only
        </label>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by name/ticker"
          className="px-2 py-1 text-sm border border-slate-300 rounded bg-white w-48"
        />
        <label className="flex items-center gap-1.5 text-slate-600">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as any)} className="px-1 py-1 border border-slate-300 rounded bg-white">
            <option value="score">Catalyst score</option>
            <option value="value">Value ₹Cr</option>
            <option value="valuePct">Value % of mcap</option>
            <option value="latest">Latest news</option>
          </select>
        </label>
        <span className="text-xs text-slate-500">{view.length} companies</span>
      </div>

      {err && <div className="text-sm text-red-600 mb-3">Could not load: {err}</div>}
      {!radar && !err && <div className="text-sm text-slate-500">Loading…</div>}
      {radar && rows.length === 0 && (
        <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded p-4">
          Nothing collected yet — press "Run now" (top right) to run the first scan; after that it refreshes itself every day.
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-2">Company</th>
                <th className="py-2 px-2 text-right">Score</th>
                <th className="py-2 px-2">Catalysts</th>
                <th className="py-2 px-2 text-right">Value ₹Cr</th>
                <th className="py-2 px-2 text-right">% mcap</th>
                <th className="py-2 px-2 text-right">Mcap Cr</th>
                <th className="py-2 px-2 text-right">3M %</th>
                <th className="py-2 px-2 text-right">wRSI</th>
                <th className="py-2 px-2">Latest</th>
              </tr>
            </thead>
            <tbody>
              {view.slice(0, shown).map((r) => (
                <>
                  <tr key={r.symbol} className="border-b border-slate-100 align-top hover:bg-slate-50/60">
                    <td className="py-2 pr-2 whitespace-nowrap">
                      <button onClick={() => toggleOpen(r.symbol)} className="text-slate-400 mr-1 w-4" title="Show all items">
                        {open === r.symbol ? "▾" : "▸"}
                      </button>
                      <Link to={`/portfolio-charts/${encodeURIComponent(r.symbol)}`} className="font-medium text-indigo-600 hover:underline">
                        {r.symbol}
                      </Link>
                      {holdings.has(r.symbol) && <span title="In your holdings"> ★</span>}
                      <div className="text-xs text-slate-500 ml-5 max-w-[14rem] truncate">{r.name}</div>
                    </td>
                    <td className="py-2 px-2 text-right font-medium">{r.score.toFixed(1)}</td>
                    <td className="py-2 px-2">
                      <div className="flex flex-wrap gap-1">
                        {TAG_ORDER.filter((g) => r.tagCounts[g]).map((g) => (
                          <span key={g} className={`text-[11px] px-1.5 py-0.5 rounded border ${TAG_CLASS[g]}`}>
                            {g} {r.tagCounts[g]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right">{fmtCr(r.valueCr)}</td>
                    <td className="py-2 px-2 text-right">{r.valuePct != null ? r.valuePct.toFixed(r.valuePct < 10 ? 1 : 0) : ""}</td>
                    <td className="py-2 px-2 text-right text-slate-600">{r.mcap != null ? Math.round(r.mcap).toLocaleString("en-IN") : ""}</td>
                    <td className="py-2 px-2 text-right">{r.m3 != null ? <Signed v={r.m3} digits={0} /> : ""}</td>
                    <td className="py-2 px-2 text-right text-slate-600">{r.wrsi != null ? r.wrsi.toFixed(0) : ""}</td>
                    <td className="py-2 px-2 max-w-[28rem]">
                      <a href={r.items[0].u} target="_blank" rel="noreferrer" className="text-slate-800 hover:underline line-clamp-2">
                        {r.items[0].t}
                      </a>
                      <div className="text-xs text-slate-400">
                        {r.items[0].d} · {r.items[0].s}
                      </div>
                    </td>
                  </tr>
                  {open === r.symbol && (
                    <tr key={r.symbol + "-open"}>
                      <td colSpan={9} className="pl-8 pr-2 pb-3 pt-1">
                        <div className="border-l-2 border-slate-300 pl-4">
                        <ul className="space-y-1.5">
                          {(full[r.symbol] ?? r.items).filter((i) => ageDays(i.d, Date.now()) <= Math.max(days, 90)).map((i, k) => (
                            <li key={k} className="flex gap-2 items-baseline">
                              <span className="text-xs text-slate-400 w-20 shrink-0">{i.d}</span>
                              <span className="flex flex-wrap gap-1 shrink-0">
                                {i.g.map((g) => (
                                  <span key={g} className={`text-[10px] px-1 rounded border ${TAG_CLASS[g]}`}>
                                    {g}
                                  </span>
                                ))}
                              </span>
                              {i.u ? (
                                <a href={i.u} target="_blank" rel="noreferrer" className="hover:underline">
                                  {i.t}
                                </a>
                              ) : (
                                <span>{i.t}</span>
                              )}
                              {i.a != null && <span className="text-xs text-slate-500 shrink-0">₹{fmtCr(i.a)} Cr</span>}
                              <span className="text-xs text-slate-400 shrink-0">{i.s}</span>
                            </li>
                          ))}
                        </ul>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          {view.length > shown && (
            <button onClick={() => setShown((n) => n + PAGE_ROWS)} className="mt-3 text-sm px-3 py-1.5 rounded border border-slate-300 text-slate-600 hover:border-slate-400">
              Show more ({view.length - shown} left)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
