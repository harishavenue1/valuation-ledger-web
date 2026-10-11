import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData, useScreeners } from "../App";
import { ScreenerInLink, Signed } from "../components/ScreenerTable";
import { api } from "../lib/api";
import { buildMatchers, chartPath, companyPath, findMentions, tvUrl, useBusinessData } from "../lib/businessData";
import { G_CLASS, G_TYPES, GType, extractGuidance } from "../lib/guidance";

// Guidance tab — one row per company with what is being said about its future (revenue, margin, capex, orders),
// each statement linked to where it came from: a news headline, one of the tweets you follow, and (on expand)
// the company's concall transcripts and presentations. Pattern-matched, so read the source before relying on it.

interface Entry {
  symbol: string;
  date: string; // YYYY-MM-DD
  src: "News" | "Tweet";
  who: string; // outlet or @handle
  text: string;
  types: GType[];
  horizon: string | null;
  strength: number;
  link: string | null;
}
interface Row {
  symbol: string;
  name: string;
  entries: Entry[];
  latest: string;
  best: number;
  mcap: number | null;
  price: number | null;
  day: number | null;
  m3: number | null;
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
const PAGE_ROWS = 100;

export default function Guidance() {
  const { bundle } = useData();
  useScreeners(["portfolioAllocation"]);
  const { radar, tech } = useBusinessData();
  const [tweets, setTweets] = useState<any[] | null>(null);
  const [days, setDays] = useState(90);
  const [types, setTypes] = useState<Set<GType>>(new Set());
  const [srcs, setSrcs] = useState<Set<string>>(new Set());
  const [onlyHold, setOnlyHold] = useState(false);
  const [onlyWatch, setOnlyWatch] = useState(false);
  const [minMcap, setMinMcap] = useState(0);
  const [minStrength, setMinStrength] = useState(3);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<"latest" | "symbol" | "mcap" | "n" | "best">("latest");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [open, setOpen] = useState<string | null>(null);
  const [concalls, setConcalls] = useState<Record<string, any>>({});
  const [shown, setShown] = useState(PAGE_ROWS);

  useEffect(() => {
    api.getFintwit().then((r) => setTweets(r.tweets)).catch(() => setTweets([]));
  }, []);

  const holdings = useMemo(() => new Set<string>(((bundle.momentum_screeners as any)?.portfolioAllocation?.rows ?? []).map((r: any) => r.symbol)), [bundle]);
  const watch = useMemo(() => new Set<string>(bundle.watchlist?.tickers ?? []), [bundle]);
  const tracker = bundle.guidance_tracker;
  const matchers = useMemo(() => buildMatchers(radar, tech), [radar, tech]);

  const entries = useMemo<Entry[]>(() => {
    if (!radar) return [];
    const out: Entry[] = [];
    const seen = new Set<string>();
    const add = (e: Entry) => {
      const k = e.symbol + norm(e.text);
      if (seen.has(k)) return;
      seen.add(k);
      out.push(e);
    };
    for (const [sym, items] of Object.entries(radar.items)) {
      for (const i of items) {
        for (const g of extractGuidance(i.t, 2)) add({ symbol: sym, date: i.d, src: "News", who: i.s, text: g.text, types: g.types, horizon: g.horizon, strength: g.strength, link: i.u ?? null });
      }
    }
    for (const t of tweets ?? []) {
      if (t.k === "repost") continue;
      const date = String(t.d).slice(0, 10);
      const link = `https://x.com/${t.h}/status/${t.id}`;
      const mentioned = findMentions(t.t, matchers);
      if (!mentioned.length) continue;
      for (const g of extractGuidance(t.t, 2)) {
        // a tweet about one company belongs to it; in a multi-company tweet the sentence must name the company
        const syms = mentioned.length === 1 ? mentioned : findMentions(g.text, matchers);
        for (const sym of syms) add({ symbol: sym, date, src: "Tweet", who: `@${t.h}`, text: g.text, types: g.types, horizon: g.horizon, strength: g.strength, link });
      }
    }
    return out;
  }, [radar, tweets, matchers]);

  const rows = useMemo<Row[]>(() => {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const by = new Map<string, Entry[]>();
    for (const e of entries) {
      if (e.date < cutoff || e.strength < minStrength) continue;
      if (types.size && !e.types.some((t) => types.has(t))) continue;
      if (srcs.size && !srcs.has(e.src)) continue;
      const a = by.get(e.symbol) ?? [];
      a.push(e);
      by.set(e.symbol, a);
    }
    const out: Row[] = [];
    for (const [sym, es] of by) {
      es.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.strength - a.strength));
      const t = tech.get(sym);
      out.push({
        symbol: sym,
        name: radar?.names?.[sym] ?? t?.name ?? sym,
        entries: es,
        latest: es[0].date,
        best: Math.max(...es.map((e) => e.strength)),
        mcap: t?.market_cap_cr ?? null,
        price: t?.price ?? null,
        day: t?.change_pct ?? null,
        m3: t?.three_month_pct ?? null,
      });
    }
    return out;
  }, [entries, days, types, srcs, minStrength, tech, radar]);

  const view = useMemo(() => {
    let r = rows;
    if (minMcap > 0) r = r.filter((x) => (x.mcap ?? 0) >= minMcap);
    if (onlyHold) r = r.filter((x) => holdings.has(x.symbol));
    if (onlyWatch) r = r.filter((x) => watch.has(x.symbol));
    const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((x) => x.symbol.toLowerCase().includes(needle) || x.name.toLowerCase().includes(needle) || x.entries.some((e) => e.text.toLowerCase().includes(needle)));
    const val = (x: Row): number | string | null => (sortKey === "symbol" ? x.symbol : sortKey === "mcap" ? x.mcap : sortKey === "n" ? x.entries.length : sortKey === "best" ? x.best : x.latest);
    return r.slice().sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return va < vb ? -dir : va > vb ? dir : 0;
    });
  }, [rows, minMcap, onlyHold, onlyWatch, q, sortKey, dir, holdings, watch]);

  function click(k: typeof sortKey) {
    if (k === sortKey) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setDir(k === "symbol" ? 1 : -1);
    }
  }
  const toggle = <T,>(set: Set<T>, v: T, setter: (s: Set<T>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    setter(n);
  };
  function toggleOpen(sym: string) {
    setOpen((o) => (o === sym ? null : sym));
    if (!concalls[sym]) {
      api
        .getBusinessProfile(sym)
        .then((p) => setConcalls((c) => ({ ...c, [sym]: p })))
        .catch(() => setConcalls((c) => ({ ...c, [sym]: { error: true } })));
    }
  }
  const sortMark = (k: typeof sortKey) => (sortKey === k ? <span className="ml-0.5">{dir === -1 ? "▼" : "▲"}</span> : null);
  const trackerNote = (sym: string): { q: string; tag: string; note: string } | null => {
    const cells = tracker?.cells?.[sym];
    if (!cells) return null;
    for (const quarter of [...(tracker.quarters ?? [])].reverse()) {
      const c = cells[quarter];
      if (c && (c.note || c.tag)) return { q: quarter, tag: c.tag, note: c.note };
    }
    return null;
  };

  return (
    <div>
      <p className="text-xs text-slate-500 mb-3 max-w-4xl">
        What is being said about each company's future — revenue, margin, capex, orders — pulled from news headlines and the tweets you follow, each linked to its source. Open a row for the company's
        concall transcripts and presentations (the filed announcements). These are pattern matches, not a reading of the filings: check the source.
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-xs text-slate-500">Window</span>
        {[30, 90, 180].map((d) => (
          <button key={d} onClick={() => setDays(d)} className={`text-sm px-2.5 py-1 rounded-full border ${days === d ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600"}`}>
            {d}d
          </button>
        ))}
        <span className="mx-1 text-slate-300">|</span>
        {G_TYPES.map((g) => (
          <button key={g} onClick={() => toggle(types, g, setTypes)} className={`text-xs px-2 py-1 rounded-full border ${types.has(g) ? G_CLASS[g] + " font-medium" : "border-slate-300 text-slate-500"}`}>
            {g}
          </button>
        ))}
        <span className="mx-1 text-slate-300">|</span>
        {["News", "Tweet"].map((s) => (
          <button key={s} onClick={() => toggle(srcs, s, setSrcs)} className={`text-xs px-2 py-1 rounded-full border ${srcs.has(s) ? "bg-slate-200 text-slate-800 border-slate-400 font-medium" : "border-slate-300 text-slate-500"}`}>
            {s === "News" ? "📰 News" : "🐦 Tweets"}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
        <label className="flex items-center gap-1.5 text-slate-600" title="How specific a statement must be: 2 = forward phrase + a figure or year; 3 = also a % / ₹ amount and a fiscal year or a guidance verb; 4 = all of it">
          Specificity ≥
          <select value={minStrength} onChange={(e) => setMinStrength(parseInt(e.target.value))} className="px-1 py-1 border border-slate-300 rounded bg-white">
            <option value={2}>2 (broad)</option>
            <option value={3}>3 (default)</option>
            <option value={4}>4 (strict)</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-slate-600">
          Mcap ≥
          <input type="number" min={0} value={minMcap} onChange={(e) => setMinMcap(parseFloat(e.target.value) || 0)} className="w-20 px-1 py-0 text-right border border-slate-300 rounded bg-white text-slate-800" />
          Cr
        </label>
        <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer">
          <input type="checkbox" checked={onlyHold} onChange={(e) => setOnlyHold(e.target.checked)} /> My holdings
        </label>
        <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer">
          <input type="checkbox" checked={onlyWatch} onChange={(e) => setOnlyWatch(e.target.checked)} /> Watchlist
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company or text" className="px-2 py-1 text-sm border border-slate-300 rounded bg-white w-52" />
        <span className="text-xs text-slate-500">{view.length} companies · {view.reduce((n, r) => n + r.entries.length, 0)} statements</span>
      </div>

      {!radar && <div className="text-sm text-slate-500">Loading…</div>}
      {radar && view.length === 0 && <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded p-4">No guidance statements match these filters.</div>}

      {view.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-2 cursor-pointer select-none hover:text-slate-700" onClick={() => click("symbol")}>
                  Company{sortMark("symbol")}
                </th>
                <th className="py-2 px-2 text-right">Price</th>
                <th className="py-2 px-2 text-right cursor-pointer select-none hover:text-slate-700" onClick={() => click("mcap")}>
                  Mcap Cr{sortMark("mcap")}
                </th>
                <th className="py-2 px-2 text-right">3M %</th>
                <th className="py-2 px-2 cursor-pointer select-none hover:text-slate-700" onClick={() => click("best")} title="Most specific statement first">
                  Guidance{sortMark("best")}
                </th>
                <th className="py-2 px-2 text-right cursor-pointer select-none hover:text-slate-700" onClick={() => click("n")}>
                  #{sortMark("n")}
                </th>
                <th className="py-2 px-2 cursor-pointer select-none hover:text-slate-700" onClick={() => click("latest")}>
                  Latest{sortMark("latest")}
                </th>
                <th className="py-2 px-2" title="Your own note from the Guidance Tracker page">
                  Your tracker
                </th>
              </tr>
            </thead>
            <tbody>
              {view.slice(0, shown).map((r) => {
                const tr = trackerNote(r.symbol);
                return (
                  <Fragment key={r.symbol}>
                    <tr className="border-b border-slate-100 align-top hover:bg-slate-50/60">
                      <td className="py-2 pr-2 whitespace-nowrap">
                        <button onClick={() => toggleOpen(r.symbol)} className="text-slate-400 mr-1 w-4" title="Concall transcripts & presentations">
                          {open === r.symbol ? "▾" : "▸"}
                        </button>
                        <Link to={companyPath(r.symbol)} className="font-medium text-indigo-600 hover:underline" title="Business profile">
                          {r.symbol}
                        </Link>
                        <ScreenerInLink symbol={r.symbol} />
                        {holdings.has(r.symbol) && <span title="In your holdings"> ★</span>}
                        <div className="text-xs text-slate-500 ml-5 max-w-[13rem] truncate">{r.name}</div>
                      </td>
                      <td className="py-2 px-2 text-right whitespace-nowrap">
                        {r.price != null ? (
                          <>
                            <Link to={chartPath(r.symbol)} className="text-indigo-600 hover:underline">
                              {r.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                            </Link>
                            <div className="text-xs">
                              {r.day != null && <Signed v={r.day} digits={1} />}{" "}
                              <a href={tvUrl(r.symbol)} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-slate-600">
                                TV↗
                              </a>
                            </div>
                          </>
                        ) : null}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-600">{r.mcap != null ? Math.round(r.mcap).toLocaleString("en-IN") : ""}</td>
                      <td className="py-2 px-2 text-right">{r.m3 != null ? <Signed v={r.m3} digits={0} /> : ""}</td>
                      <td className="py-2 px-2 max-w-[44rem]">
                        <ul className="space-y-1.5">
                          {r.entries
                            .slice()
                            .sort((a, b) => b.strength - a.strength || (a.date < b.date ? 1 : -1))
                            .slice(0, open === r.symbol ? 12 : 3)
                            .map((e, k) => (
                              <li key={k}>
                                <div className="flex flex-wrap items-baseline gap-1.5">
                                  {e.types.map((t) => (
                                    <span key={t} className={`text-[10px] px-1 rounded border shrink-0 ${G_CLASS[t]}`}>
                                      {t}
                                    </span>
                                  ))}
                                  {e.horizon && <span className="text-[10px] px-1 rounded border border-slate-300 text-slate-600 shrink-0">{e.horizon}</span>}
                                  <span>{e.text}</span>
                                </div>
                                <div className="text-xs text-slate-400">
                                  {e.src === "Tweet" ? "🐦" : "📰"} {e.who} · {e.date}
                                  {e.link ? (
                                    <>
                                      {" "}
                                      ·{" "}
                                      <a href={e.link} target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline">
                                        source ↗
                                      </a>
                                    </>
                                  ) : null}
                                </div>
                              </li>
                            ))}
                        </ul>
                        {r.entries.length > 3 && open !== r.symbol && (
                          <button onClick={() => toggleOpen(r.symbol)} className="text-xs text-slate-500 hover:text-slate-700 mt-1">
                            + {r.entries.length - 3} more
                          </button>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right">{r.entries.length}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-slate-600">{r.latest}</td>
                      <td className="py-2 px-2 max-w-[14rem] text-xs">
                        {tr ? (
                          <Link to="/guidance-tracker" className="hover:underline">
                            <span className={tr.tag === "Beat" ? "text-emerald-600" : tr.tag === "Miss" ? "text-red-500" : "text-slate-500"}>{tr.tag || "–"}</span> {tr.q}
                            {tr.note ? <div className="text-slate-500 line-clamp-2">{tr.note}</div> : null}
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                    {open === r.symbol && (
                      <tr>
                        <td colSpan={8} className="pl-8 pr-2 pb-3 pt-1">
                          <div className="border-l-2 border-slate-300 pl-4 text-sm">
                            <div className="text-xs text-slate-500 mb-1">Concall transcripts &amp; presentations (filed on BSE; from the company's Screener.in page)</div>
                            {!concalls[r.symbol] ? (
                              <div className="text-slate-500">Loading…</div>
                            ) : concalls[r.symbol].error || !(concalls[r.symbol].concalls?.length) ? (
                              <div className="text-slate-500">None listed.</div>
                            ) : (
                              <ul className="space-y-0.5">
                                {concalls[r.symbol].concalls.slice(0, 6).map((c: any, i: number) => (
                                  <li key={i} className="flex gap-3">
                                    <span className="w-20 text-slate-500 shrink-0">{c.date}</span>
                                    {Object.entries(c.links as Record<string, string>).map(([label, href]) => (
                                      <a key={label} href={href} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                                        {label}
                                      </a>
                                    ))}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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
