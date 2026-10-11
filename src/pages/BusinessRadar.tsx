import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData, useScreeners } from "../App";
import RunButton from "../components/RunButton";
import { Signed } from "../components/ScreenerTable";
import { api } from "../lib/api";
import {
  Item,
  TAG_CLASS,
  TAG_ORDER,
  ageDays,
  chartPath,
  companyPath,
  fmtCr,
  storyStats,
  tvUrl,
  useBusinessData,
  Stats,
} from "../lib/businessData";

// Radar tab — what companies are DOING (orders, capex, M&A, approvals, guidance),
// from the daily-accumulated tagged headlines (api/_business.py).

const PAGE_ROWS = 150;

const HEADERS: { k?: SortKey; label: string; right?: boolean; filter?: boolean; tip?: string }[] = [
  { k: "symbol", label: "Company" },
  { k: "price", label: "Price", right: true, filter: true, tip: "Last close; click the number for the internal chart, TV↗ opens TradingView" },
  { k: "day", label: "Day %", right: true, filter: true },
  { k: "score", label: "Score", right: true, filter: true, tip: "Catalyst score" },
  { label: "Catalysts" },
  { k: "valueCr", label: "Value ₹Cr", right: true, filter: true, tip: "₹ amounts on distinct Order / Capex / M&A stories in the window" },
  { k: "valuePct", label: "% mcap", right: true, filter: true, tip: "Value as a % of market cap" },
  { k: "mcap", label: "Mcap Cr", right: true, filter: true },
  { k: "m3", label: "3M %", right: true, filter: true },
  { k: "wrsi", label: "wRSI", right: true, filter: true, tip: "Weekly RSI(14)" },
  { k: "last", label: "Latest" },
];

type SortKey = "symbol" | "price" | "day" | "score" | "valueCr" | "valuePct" | "mcap" | "m3" | "wrsi" | "last";

interface Row extends Stats {
  symbol: string;
  name: string;
  sector: string;
  mcap: number | null;
  price: number | null;
  day: number | null;
  valuePct: number | null;
  m3: number | null;
  wrsi: number | null;
}

export default function BusinessRadar() {
  const { bundle } = useData();
  useScreeners(["portfolioAllocation"]);
  const { radar, tech, err } = useBusinessData();
  const [days, setDays] = useState(30);
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [minMcap, setMinMcap] = useState(0);
  const [sector, setSector] = useState("");
  const [onlyHold, setOnlyHold] = useState(false);
  const [onlyWatch, setOnlyWatch] = useState(false);
  const [hideRiskOnly, setHideRiskOnly] = useState(true);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<1 | -1>(-1); // -1 = high to low
  // per-column minimum filters (blank = off); blanks in the data never pass an active filter
  const [colMin, setColMin] = useState<Partial<Record<SortKey, string>>>({});
  function clickSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(k === "symbol" ? 1 : -1);
    }
  }
  const [open, setOpen] = useState<string | null>(null);
  const [full, setFull] = useState<Record<string, Item[]>>({});
  const [shown, setShown] = useState(PAGE_ROWS);

  function toggleOpen(sym: string) {
    setOpen((o) => (o === sym ? null : sym));
    if (!full[sym]) {
      api
        .getBusinessRadarSymbol(sym)
        .then((r) => setFull((f) => ({ ...f, [sym]: r.items })))
        .catch(() => {});
    }
  }

  const holdings = useMemo(() => {
    const rows = (bundle.momentum_screeners as any)?.portfolioAllocation?.rows ?? [];
    return new Set<string>(rows.map((r: any) => r.symbol));
  }, [bundle]);
  const watch = useMemo(() => new Set<string>(bundle.watchlist?.tickers ?? []), [bundle]);
  const sectors = useMemo(() => Array.from(new Set(Object.values(radar?.sectors ?? {}))).sort(), [radar]);

  const rows = useMemo<Row[]>(() => {
    if (!radar) return [];
    const now = Date.now();
    const out: Row[] = [];
    for (const [sym, all] of Object.entries(radar.items)) {
      const st = storyStats(all, 0, days, now);
      if (!st) continue;
      const t = tech.get(sym);
      const mcap = t?.market_cap_cr ?? null;
      out.push({
        ...st,
        symbol: sym,
        name: radar.names[sym] ?? t?.name ?? sym,
        sector: radar.sectors?.[sym] ?? "",
        mcap,
        price: t?.price ?? null,
        day: t?.change_pct ?? null,
        valuePct: mcap && st.valueCr ? (st.valueCr / mcap) * 100 : null,
        m3: t?.three_month_pct ?? null,
        wrsi: t?.rsi_w ?? null,
      });
    }
    return out;
  }, [radar, days, tech]);

  const view = useMemo(() => {
    let r = rows;
    if (tags.size) r = r.filter((x) => Array.from(tags).some((g) => x.tagCounts[g]));
    if (hideRiskOnly) r = r.filter((x) => Object.keys(x.tagCounts).some((g) => g !== "Risk"));
    if (minMcap > 0) r = r.filter((x) => (x.mcap ?? 0) >= minMcap);
    if (sector) r = r.filter((x) => x.sector === sector);
    if (onlyHold) r = r.filter((x) => holdings.has(x.symbol));
    if (onlyWatch) r = r.filter((x) => watch.has(x.symbol));
    const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((x) => x.symbol.toLowerCase().includes(needle) || x.name.toLowerCase().includes(needle));
    for (const [k, v] of Object.entries(colMin)) {
      const n = parseFloat(v as string);
      if (!Number.isNaN(n)) r = r.filter((x) => typeof (x as any)[k] === "number" && (x as any)[k] >= n);
    }
    const val = (x: Row): number | string | null => (sortKey === "symbol" ? x.symbol : ((x as any)[sortKey] ?? null));
    return r.slice().sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // blanks always last
      if (vb == null) return -1;
      return va < vb ? -sortDir : va > vb ? sortDir : 0;
    });
  }, [rows, tags, hideRiskOnly, minMcap, sector, onlyHold, onlyWatch, q, sortKey, sortDir, colMin, holdings, watch]);

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
        <span className="text-slate-500 text-sm">What companies are doing — orders, capex, M&A, approvals, guidance — not what the chart is doing</span>
        <span className="ml-auto">
          <RunButton screener="businessRadar" />
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Built daily from news headlines (one search per company, {radar?.stats?.universe ?? "~1,500"} companies: every stock above ₹1,000 Cr plus your holdings and watchlist). Each headline is tagged by
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
            <b>Value ₹Cr</b> = the ₹ amounts on distinct Order, Capex and M&A stories (dollar amounts at a flat ₹88; order-book totals are not counted). <b>% mcap</b> compares it with the market cap: an
            ₹800 Cr order means far more to a ₹4,000 Cr company than to a ₹80,000 Cr one.
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
        <select value={sector} onChange={(e) => setSector(e.target.value)} className="px-1 py-1 border border-slate-300 rounded bg-white text-slate-700 max-w-[14rem]">
          <option value="">All sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
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
                {HEADERS.map((h) => (
                  <th
                    key={h.k ?? h.label}
                    className={`py-2 px-2 ${h.right ? "text-right" : ""} ${h.k ? "cursor-pointer select-none hover:text-slate-700" : ""}`}
                    title={h.tip}
                    onClick={h.k ? () => clickSort(h.k!) : undefined}
                  >
                    {h.label}
                    {h.k && sortKey === h.k && <span className="ml-0.5">{sortDir === -1 ? "▼" : "▲"}</span>}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-slate-200">
                {HEADERS.map((h) => (
                  <th key={(h.k ?? h.label) + "-f"} className={`px-2 pb-1 ${h.right ? "text-right" : ""}`}>
                    {h.filter && (
                      <input
                        type="number"
                        placeholder="min"
                        value={colMin[h.k!] ?? ""}
                        onChange={(e) => setColMin((m) => ({ ...m, [h.k!]: e.target.value }))}
                        className="w-14 px-1 py-0 text-xs text-right font-normal border border-slate-300 rounded bg-white text-slate-800"
                        title={`Show only rows with ${h.label} at or above this`}
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.slice(0, shown).map((r) => (
                <Fragment key={r.symbol}>
                  <tr className="border-b border-slate-100 align-top hover:bg-slate-50/60">
                    <td className="py-2 pr-2 whitespace-nowrap">
                      <button onClick={() => toggleOpen(r.symbol)} className="text-slate-400 mr-1 w-4" title="Show all items">
                        {open === r.symbol ? "▾" : "▸"}
                      </button>
                      <Link to={companyPath(r.symbol)} className="font-medium text-indigo-600 hover:underline" title="Business profile">
                        {r.symbol}
                      </Link>
                      {holdings.has(r.symbol) && <span title="In your holdings"> ★</span>}
                      <div className="text-xs text-slate-500 ml-5 max-w-[14rem] truncate" title={r.sector}>
                        {r.name}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">
                      {r.price != null ? (
                        <>
                          <Link to={chartPath(r.symbol)} className="text-indigo-600 hover:underline" title="Internal chart">
                            {r.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                          </Link>
                          <div className="text-xs">
                            <a href={tvUrl(r.symbol)} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-slate-600" title="Open in TradingView">
                              TV↗
                            </a>
                          </div>
                        </>
                      ) : (
                        <a href={tvUrl(r.symbol)} target="_blank" rel="noreferrer" className="text-xs text-slate-400 hover:text-slate-600">
                          TV↗
                        </a>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right">{r.day != null ? <Signed v={r.day} digits={1} /> : ""}</td>
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
                      {r.items[0].u ? (
                        <a href={r.items[0].u} target="_blank" rel="noreferrer" className="text-slate-800 hover:underline line-clamp-2">
                          {r.items[0].t}
                        </a>
                      ) : (
                        <span className="line-clamp-2">{r.items[0].t}</span>
                      )}
                      <div className="text-xs text-slate-400">
                        {r.items[0].d} · {r.items[0].s}
                      </div>
                    </td>
                  </tr>
                  {open === r.symbol && (
                    <tr>
                      <td colSpan={11} className="pl-8 pr-2 pb-3 pt-1">
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
                </Fragment>
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
