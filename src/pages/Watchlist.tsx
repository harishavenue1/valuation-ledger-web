import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData, useScreeners } from "../App";
import { api } from "../lib/api";
import { bulkAddCompanies } from "../lib/bulkAdd";
import { Col, GenericTable, ScreenerLoading, Signed, fmtNum } from "../components/ScreenerTable";
import { ZONES, proximityBucketFor } from "../lib/athZones";
import { useWatchlist } from "../lib/useWatchlist";

// 2026-09-13 ("can we add one more column to see where the stock lies
// in our momentum category page, is it 52WeekLow, 52WeekHigh,
// AllTimeHigh... add a tag, 52WH, 52WL, ALTH") — cross-references each
// watchlisted symbol against the 3 named momentum screeners' OWN
// pushed rows (bundle.momentum_screeners["52wHigh"/"52wLow"/
// "allTimeHigh"]) and shows every tag that applies (a stock CAN be in
// more than one — e.g. an all-time-high stock is very often also a
// 52-week high on the same day). Membership only, no live
// recomputation — exactly as fresh as each of those 3 screeners' own
// last refresh (same staleness this page already accepts for
// "Owned").
const MOMENTUM_TAG_STYLE: Record<string, string> = {
  "52WH": "bg-emerald-50 text-emerald-700 border-emerald-300",
  "52WL": "bg-red-50 text-red-600 border-red-300",
  ALTH: "bg-indigo-50 text-indigo-700 border-indigo-300",
};

function MomentumTags({ tags }: { tags: string[] }) {
  if (!tags.length) return <span className="text-slate-300">—</span>;
  return (
    <div className="flex gap-1 flex-wrap">
      {tags.map((t) => (
        <span key={t} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${MOMENTUM_TAG_STYLE[t]}`}>
          {t}
        </span>
      ))}
    </div>
  );
}

// 2026-10-24 ("I need columns as same as portfolio-allocation") — same
// columns, order, labels and widths as Portfolio Allocation's stock table
// (minus Avg Price, which a watch item doesn't have; plus a Group column at the end for the manual override). For a stock
// that is actually held, every value comes from that page's own row; for
// a pure watch item the position-only columns (Buy %, Current %, P&L %) are a dash and the price/return/EMA/ATH/52WH columns come
// from the NSE bhavcopy all-stocks technicals store (the same source All
// Technicals uses), so every watchlisted NSE stock has them.
const DASH = <span className="text-slate-300">—</span>;
const dashOr = (v: any, f: (n: number) => React.ReactNode) => (v === null || v === undefined || v === "" ? DASH : f(v as number));
const NUM_W = 5.21;
const BASE_COLS: Col[] = [
  { key: "rank", label: "Rank", width: 3 },
  { key: "symbol", label: "Symbol", align: "left", width: 9 },
  {
    key: "ath_zone",
    label: "Zone",
    width: 3,
    align: "center",
    render: (r) => {
      const z = ZONES.find((x) => x.label === proximityBucketFor(r.pct_from_ath));
      if (!z || !z.letter) return <span className="text-slate-300">–</span>;
      return (
        <span
          className="inline-block w-5 h-5 leading-5 rounded text-[11px] font-bold text-center"
          style={{ background: z.badge.bg, color: z.badge.fg }}
          title={`${z.title} (${typeof r.pct_from_ath === "number" ? r.pct_from_ath.toFixed(1) + "%" : "n/a"} from ATH)`}
        >
          {z.letter}
        </span>
      );
    },
  },
  { key: "sector", label: "Sector", align: "left", width: 5 },
  { key: "market_cap_cr", label: "Market Cap (Cr)", width: NUM_W, render: (r) => dashOr(r.market_cap_cr, (v) => `₹${fmtNum(v, 0)} Cr`) },
  { key: "pct_of_portfolio_cost", label: "Buy %", width: NUM_W, groupStart: true, render: (r) => dashOr(r.pct_of_portfolio_cost, (v) => <span className="tabular-nums">{fmtNum(v, 1)}%</span>) },
  { key: "pct_of_portfolio", label: "Current %", width: NUM_W, render: (r) => dashOr(r.pct_of_portfolio, (v) => <span className="font-semibold tabular-nums">{fmtNum(v, 1)}%</span>) },
  {
    key: "price",
    label: "Cur Price",
    width: NUM_W,
    render: (r) => {
      if (r.price === null || r.price === undefined) return DASH;
      const prefix = r.exchange === "BSE" ? "BSE" : "NSE";
      return (
        <a
          href={`https://www.tradingview.com/chart/?symbol=${prefix}:${encodeURIComponent(r.symbol)}&interval=W`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="tabular-nums hover:underline hover:text-indigo-600"
          title={`Open ${r.symbol} chart on TradingView`}
        >
          ₹{fmtNum(r.price, 1)}
        </a>
      );
    },
  },
  { key: "pnl_pct", label: "P&L %", width: NUM_W, render: (r) => dashOr(r.pnl_pct, (v) => <Signed v={v} digits={1} />) },
  { key: "day_change_pct", label: "Day %", width: NUM_W, groupStart: true, render: (r) => dashOr(r.day_change_pct, (v) => <Signed v={v} digits={1} />) },
  { key: "pct_1w", label: "1W %", width: NUM_W, render: (r) => dashOr(r.pct_1w, (v) => <Signed v={v} digits={1} />) },
  { key: "pct_1m", label: "1M %", width: NUM_W, render: (r) => dashOr(r.pct_1m, (v) => <Signed v={v} digits={1} />) },
  { key: "pct_3m", label: "3M %", width: NUM_W, render: (r) => dashOr(r.pct_3m, (v) => <Signed v={v} digits={1} />) },
  { key: "pct_6m", label: "6M %", width: NUM_W, render: (r) => dashOr(r.pct_6m, (v) => <Signed v={v} digits={1} />) },
  { key: "pct_200d_ema", label: "% vs 200D EMA", width: NUM_W, groupStart: true, render: (r) => dashOr(r.pct_200d_ema, (v) => <Signed v={v} digits={1} />) },
  { key: "pct_33w_ema", label: "% vs 33W EMA", width: NUM_W, render: (r) => dashOr(r.pct_33w_ema, (v) => <Signed v={v} digits={1} />) },
  { key: "pct_from_ath", label: "ATH %", width: NUM_W, render: (r) => dashOr(r.pct_from_ath, (v) => <Signed v={v} digits={1} />) },
  { key: "pct_from_52w_high", label: "52WH %", width: NUM_W, render: (r) => dashOr(r.pct_from_52w_high, (v) => <Signed v={v} digits={1} />) },
];

// 2026-10-24 ("organize our watchlist as during market downturns its
// difficult to look into long lists") — the flat list is split into
// collapsible groups. Most are AUTOMATIC from data the page already has
// (momentum tags + the NSE Screener's RSI/returns), first match wins:
//   At highs  -> 52WH or ALTH tag
//   Strong    -> weekly RSI >= 66 (the user's own momentum line)
//   Weak      -> 52WL tag, or weekly RSI < 40
//   Holding up-> positive over the last month (still green while others bleed)
//   Pullback  -> everything else (negative month, not yet weak)
// Priority and Parked are MANUAL-only. Every row also has a Group dropdown
// that overrides the automatic bucket ("Auto" clears the override); the
// override is stored per ticker in the watchlist meta (api/watchlist.py).
const GROUPS = [
  { key: "Priority", label: "⭐ Priority", hint: "Your own picks, pinned to the top", open: true },
  { key: "At highs", label: "🚀 At highs", hint: "52-week or all-time high", open: true },
  { key: "Strong", label: "💪 Strong momentum", hint: "Weekly RSI at or above 66", open: true },
  { key: "Holding up", label: "🛡 Holding up", hint: "Up over the last month", open: true },
  { key: "Pullback", label: "↩ Pullback", hint: "Down over the month, not weak yet", open: false },
  { key: "Weak", label: "⚠ Weak", hint: "At a 52-week low or weekly RSI below 40", open: false },
  { key: "Parked", label: "🅿 Parked", hint: "Set aside, not watching right now", open: false },
] as const;
const GROUP_KEYS: string[] = GROUPS.map((g) => g.key);

function autoGroup(r: Record<string, any>): string {
  const tags: string[] = r.momentumTags ?? [];
  const rsiW = toNum(r.rsi_w);
  if (tags.includes("ALTH") || tags.includes("52WH")) return "At highs";
  if (rsiW !== null && rsiW >= 66) return "Strong";
  if (tags.includes("52WL") || (rsiW !== null && rsiW < 40)) return "Weak";
  const m = toNum(r.pct_1m ?? r.monthly_pct);
  if (m !== null && m > 0) return "Holding up";
  return "Pullback";
}

// Deliberately NOT its own priced dataset — tickers here are just a
// persisted list (api/watchlist.py); their columns (price/RSI D-W-M/
// 3W green/etc.) come from bundle.momentum_screeners.nseScreener,
// which covers NSE 750. But a watchlisted ticker isn't guaranteed to
// be IN that universe (e.g. below the Smallcap 100 cutoff, or too
// recently listed to have cleared NSE's index-eligibility rules yet)
// — those still need to show up as a row, just with whatever's
// available instead of the full column set (2026-08-23, "watchlist is
// not showing these 4 companies" — they were being silently excluded
// rather than shown with partial data). Falls back to Viraj Screen's
// own price/name, then the main stock ledger's current_price, before
// finally rendering the row with only its symbol filled in.
function toNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}

// Add/remove via the same tap-to-star toggle used on every screener
// page (useWatchlist) — tapping a starred row's ★ here removes it,
// since every row on this page is by definition already on the
// watchlist.
export default function Watchlist() {
  const { bundle, setBundle, reload } = useData();
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const [refreshing, setRefreshing] = useState(false);
  const { ready } = useScreeners(["portfolioAllocation", "nseScreener", "52wHigh", "52wLow", "allTimeHigh", "nse750Fundamentals"]);

  const tickers = bundle.watchlist.tickers;
  // 2026-09-11 ("split watchlist into 2 parts actual owned in
  // portfolio vs nonPortfolio") — "owned" is read from
  // bundle.momentum_screeners.portfolioAllocation, the same live-Kite-
  // holdings snapshot Portfolio Allocation itself renders (on-request
  // only, see PortfolioAllocation skill — so "owned" here is only as
  // fresh as that screener's own last refresh, same staleness every
  // other page reading it already accepts). Matched by symbol only
  // (portfolioAllocation's own symbols are already series-suffix-
  // stripped via clean_symbol, same plain-NSE-ticker format every
  // other screener's `symbol` field uses) — includes funds/ETFs, not
  // just stocks, since a watchlisted GOLDCASE/BANKBEES etc. should
  // still count as "owned" if it's actually held.
  const ownedSymbols = useMemo(() => {
    const s = new Set<string>();
    for (const r of bundle.momentum_screeners.portfolioAllocation?.rows ?? []) if (r.symbol) s.add(r.symbol);
    return s;
  }, [bundle.momentum_screeners.portfolioAllocation]);
  const nseRows = bundle.momentum_screeners.nseScreener?.rows ?? [];
  const nseBySymbol = useMemo(() => {
    const m = new Map<string, Record<string, any>>();
    for (const r of nseRows) m.set(String(r.symbol), r);
    return m;
  }, [nseRows]);
  const virajBySymbol = useMemo(() => {
    const m = new Map<string, (typeof bundle.viraj_screen.rows)[number]>();
    for (const r of bundle.viraj_screen.rows) m.set(r.symbol, r);
    return m;
  }, [bundle.viraj_screen.rows]);

  // 2026-09-13 ("add a tag, 52WH, 52WL, ALTH") — symbol sets from each
  // of the 3 named momentum screeners' own pushed rows, checked per
  // watchlisted ticker below.
  const wh52Symbols = useMemo(() => new Set((bundle.momentum_screeners["52wHigh"]?.rows ?? []).map((r: any) => String(r.symbol))), [bundle.momentum_screeners["52wHigh"]]);
  const wl52Symbols = useMemo(() => new Set((bundle.momentum_screeners["52wLow"]?.rows ?? []).map((r: any) => String(r.symbol))), [bundle.momentum_screeners["52wLow"]]);
  const athSymbols = useMemo(() => new Set((bundle.momentum_screeners["allTimeHigh"]?.rows ?? []).map((r: any) => String(r.symbol))), [bundle.momentum_screeners["allTimeHigh"]]);
  function momentumTagsFor(symbol: string): string[] {
    const tags: string[] = [];
    if (wh52Symbols.has(symbol)) tags.push("52WH");
    if (wl52Symbols.has(symbol)) tags.push("52WL");
    if (athSymbols.has(symbol)) tags.push("ALTH");
    return tags;
  }

  // Live per-ticker fetch (api/watchlist_detail.py) for whichever
  // watchlisted tickers nseScreener doesn't cover, so they get real
  // RSI/return-% instead of just name+price (2026-08-23, "build
  // details for all"). Declared before `rows` below since it reads
  // liveDetail while building each fallback row.
  const [liveDetail, setLiveDetail] = useState<Record<string, Record<string, any>>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const lastFetchedKey = useRef("");

  const outsideNse750: string[] = [];
  const rows: Record<string, any>[] = tickers.map((t) => {
    const nse = nseBySymbol.get(t);
    if (nse) return { ...nse, symbol: t, momentumTags: momentumTagsFor(t) };
    outsideNse750.push(t);
    const vr = virajBySymbol.get(t);
    const stock = bundle.stocks[t];
    const live = liveDetail[t];
    // `live` spread FIRST, then symbol/name/sector/price explicitly
    // overridden with a proper fallback chain — spreading it last
    // would let a null name/sector from a failed yfinance .info call
    // (api/watchlist_detail.py's fetch_name_sector is best-effort)
    // silently clobber a perfectly good fallback name with null.
    // Screener (bundle.stocks, via _screener_fetch.py) leads the
    // price/name chain, not yfinance — it's this app's authoritative,
    // already-trusted source everywhere else (Summary/Detail pages),
    // and yfinance's own symbol resolution has real failure modes
    // (confirmed live: "ANLON.NS" partially resolving to an unrelated
    // mutual fund in Yahoo's system) that Screener doesn't share.
    // yfinance still supplies the RSI/return-window columns Screener
    // doesn't compute at all (2026-08-23, "is it not possible to get
    // price from screener??").
    return {
      ...live,
      symbol: t,
      name: stock?.name || vr?.name || live?.name || t,
      sector: live?.sector || undefined,
      price: stock?.current_price ?? toNum(vr?.price) ?? toNum(live?.price) ?? null,
      momentumTags: momentumTagsFor(t),
    };
  });
  // Keyed on the sorted ticker list, not the array reference, so the
  // effect below only re-fires when the actual SET of off-universe
  // tickers changes, not on every render.
  const outsideKey = [...outsideNse750].sort().join(",");
  // "no real signal" (rsi_d missing), not just "no response at all" —
  // some obscure tickers (confirmed live: ANLON) get a 200 with price
  // but too little trading history on Yahoo for any of the RSI/return
  // math, which should read the same as "couldn't find it" rather
  // than silently passing as fully resolved.
  const stillPartial = outsideNse750.filter((t) => liveDetail[t]?.rsi_d == null);
  const [bhav, setBhav] = useState<Record<string, any>>({});
  useEffect(() => {
    let cancelled = false;
    api
      .getBhavTechnicals()
      .then((r) => {
        if (cancelled || !r?.rows) return;
        const m: Record<string, any> = {};
        for (const row of r.rows) m[row.symbol] = row;
        setBhav(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const pfBySymbol = useMemo(() => {
    const m = new Map<string, Record<string, any>>();
    for (const r of bundle.momentum_screeners.portfolioAllocation?.rows ?? []) if (r.symbol && !m.has(r.symbol)) m.set(r.symbol, r);
    return m;
  }, [bundle.momentum_screeners.portfolioAllocation]);
  const fundBySymbol = useMemo(() => {
    const m = new Map<string, Record<string, any>>();
    for (const r of bundle.momentum_screeners.nse750Fundamentals?.rows ?? []) if (r.symbol) m.set(String(r.symbol), r);
    return m;
  }, [bundle.momentum_screeners.nse750Fundamentals]);
  const num = (v: any) => (v === null || v === undefined || v === "" ? null : typeof v === "number" ? v : toNum(v));
  const firstNum = (...vs: any[]) => {
    for (const v of vs) {
      const n = num(v);
      if (n !== null) return n;
    }
    return null;
  };
  // position fields from Portfolio Allocation (held stocks only), everything else Portfolio-first then bhav then the NSE Screener row
  const enriched: Record<string, any>[] = rows.map((r) => {
    const sym = String(r.symbol);
    const pf = pfBySymbol.get(sym);
    const bh = bhav[sym];
    const fund = fundBySymbol.get(sym);
    return {
      ...r,
      sector: pf?.sector || r.sector,
      exchange: pf?.exchange,
      market_cap_cr: firstNum(pf?.market_cap_cr, fund?.marketcap),
      pct_of_portfolio_cost: pf?.pct_of_portfolio_cost ?? null,
      pct_of_portfolio: pf?.pct_of_portfolio ?? null,
      avg_price: pf?.avg_price ?? null,
      pnl_pct: pf?.pnl_pct ?? null,
      price: firstNum(pf?.price, bh?.price, r.price),
      day_change_pct: firstNum(pf?.day_change_pct, bh?.change_pct, r.change_pct),
      pct_1w: firstNum(pf?.pct_1w, bh?.w_pct_1w, r.weekly_pct),
      pct_1m: firstNum(pf?.pct_1m, bh?.w_pct_1m, r.monthly_pct),
      pct_3m: firstNum(pf?.pct_3m, bh?.w_pct_3m, r.three_month_pct),
      pct_6m: firstNum(pf?.pct_6m, bh?.w_pct_6m),
      pct_200d_ema: firstNum(pf?.pct_200d_ema, bh?.pct_200d_ema),
      pct_33w_ema: firstNum(pf?.pct_33w_ema, bh?.pct_33w_ema),
      pct_from_ath: firstNum(pf?.pct_from_ath, bh?.pct_from_ath),
      pct_from_52w_high: firstNum(pf?.pct_from_52w_high, bh?.pct_from_52w_high),
      rsi_w: firstNum(r.rsi_w, bh?.rsi_w),
    };
  });

  const manualGroups = bundle.watchlist.groups ?? {};
  const [view, setView] = useState<"signal" | "owned">("signal");
  const [search, setSearch] = useState("");
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() => Object.fromEntries(GROUPS.map((g) => [g.key, g.open])));

  function setGroup(symbol: string, group: string | null) {
    const prev = bundle.watchlist.groups ?? {};
    const next = { ...prev };
    if (group === null) delete next[symbol];
    else next[symbol] = group;
    setBundle((b) => ({ ...b, watchlist: { ...b.watchlist, groups: next } }));
    api.setWatchlistGroup(symbol, group).catch(() => setBundle((b) => ({ ...b, watchlist: { ...b.watchlist, groups: prev } })));
  }

  const cols: Col[] = [
    ...BASE_COLS,
    {
      key: "group",
      label: "Group",
      width: 7,
      render: (r) => (
        <select
          value={manualGroups[r.symbol] && GROUP_KEYS.includes(manualGroups[r.symbol]) ? manualGroups[r.symbol] : "auto"}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setGroup(String(r.symbol), e.target.value === "auto" ? null : e.target.value)}
          className="border border-slate-300 rounded px-1 py-0.5 text-xs text-slate-700 bg-white max-w-full"
        >
          <option value="auto">Auto ({autoGroup(r)})</option>
          {GROUPS.map((g) => (
            <option key={g.key} value={g.key}>
              {g.key}
            </option>
          ))}
        </select>
      ),
    },
  ];

  const needle = search.trim().toLowerCase();
  const visibleRows = needle ? enriched.filter((r) => String(r.symbol).toLowerCase().includes(needle) || String(r.name ?? "").toLowerCase().includes(needle)) : enriched;
  const ownedRows = visibleRows.filter((r) => ownedSymbols.has(String(r.symbol))).map((r, i) => ({ ...r, rank: i + 1 }));
  const notOwnedRows = visibleRows.filter((r) => !ownedSymbols.has(String(r.symbol))).map((r, i) => ({ ...r, rank: i + 1 }));
  const byWeekly = (a: Record<string, any>, b: Record<string, any>) => (toNum(b.pct_1w) ?? -1e9) - (toNum(a.pct_1w) ?? -1e9);
  const grouped = GROUPS.map((g) => {
    const list = visibleRows
      .filter((r) => {
        const m = manualGroups[r.symbol];
        return (m && GROUP_KEYS.includes(m) ? m : autoGroup(r)) === g.key;
      })
      .sort(byWeekly)
      .map((r, i): Record<string, any> => ({ ...r, rank: i + 1 }));
    const weeklies = list.map((r) => toNum(r.pct_1w)).filter((v): v is number => v !== null);
    return { ...g, list, avgWeekly: weeklies.length ? weeklies.reduce((a, b) => a + b, 0) / weeklies.length : null };
  });

  useEffect(() => {
    if (!outsideKey || outsideKey === lastFetchedKey.current) return;
    lastFetchedKey.current = outsideKey;
    const need = outsideKey.split(",").filter((t) => !liveDetail[t]);
    if (need.length === 0) return;
    setDetailLoading(true);
    setDetailError("");
    api
      .fetchWatchlistDetail(need)
      .then(({ rows: fetched }) => setLiveDetail((prev) => ({ ...prev, ...fetched })))
      .catch(() => setDetailError("Live fetch failed — showing name/price only for the tickers below."))
      .finally(() => setDetailLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outsideKey]);

  // Auto-fetch off-universe tickers into the real ledger (Screener.in,
  // via the same call the Detail page's "Add it" button uses) so they
  // get an authoritative price/name instead of leaning on yfinance for
  // that. attemptedScreenerFetch (not state) tracks what's already
  // been tried, so this fires once per ticker even as bundle.stocks
  // updates piece-by-piece re-trigger renders — re-running on every
  // stock landing would otherwise refetch the same shrinking "still
  // missing" set repeatedly.
  const attemptedScreenerFetch = useRef<Set<string>>(new Set());
  useEffect(() => {
    const need = outsideNse750.filter((t) => !bundle.stocks[t] && !attemptedScreenerFetch.current.has(t));
    if (need.length === 0) return;
    need.forEach((t) => attemptedScreenerFetch.current.add(t));
    bulkAddCompanies(need.join(","), (stock) => {
      setBundle((b) => ({ ...b, stocks: { ...b.stocks, [stock.ticker]: stock } }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outsideKey]);

  async function doRefresh() {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }

  if (!ready) return <ScreenerLoading label="Watchlist" />;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">⭐ Watchlist</h1>
        <span className="text-slate-500 text-sm">{tickers.length} stocks</span>
        <button
          onClick={doRefresh}
          disabled={refreshing}
          className="ml-auto text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "🔄 Refresh"}
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Columns match the NSE Screener tab, plus a <b>Momentum</b> tag column (2026-09-13) showing which of the Momentum Screeners' own{" "}
        <b>52WH</b> (52-Week High), <b>52WL</b> (52-Week Low), or <b>ALTH</b> (All-Time High) tabs a stock currently appears in — a stock can
        carry more than one at once, or none. Tickers outside NSE 750 get their price/name from Screener.in (auto-fetched) and RSI/returns
        from a live yfinance lookup instead. Tap ★ on any screener page to add a stock; tap it again here (or there) to remove it. Grouped below
        by signal (automatic, with a Group dropdown on every row to override it); switch to Owned / Not owned for the Kite-holding split (from Portfolio Allocation's last refresh).
      </p>

      {tickers.length === 0 ? (
        <div className="text-slate-500 text-sm py-10 text-center border border-slate-200 rounded">
          Your watchlist is empty — tap the ☆ next to any stock on Viraj Screen or Momentum Screeners to add it.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Filter by name/ticker" className="border border-slate-300 rounded px-3 py-1.5 text-sm w-56" />
            {(["signal", "owned"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`text-xs px-2.5 py-1.5 rounded border ${view === v ? "border-indigo-500 text-indigo-600 font-medium" : "border-slate-300 hover:border-slate-400"}`}>
                {v === "signal" ? "By signal" : "Owned / Not owned"}
              </button>
            ))}
          </div>

          {view === "signal" ? (
            <>
              <div className="flex flex-wrap gap-2 mb-4">
                {grouped.map((g) => (
                  <button
                    key={g.key}
                    onClick={() => {
                      setOpenMap((m) => ({ ...m, [g.key]: true }));
                      setTimeout(() => document.getElementById(`wl-${g.key.replace(/\s+/g, "-")}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                    }}
                    title={g.hint}
                    className="text-xs px-2.5 py-1 rounded-full border border-slate-300 hover:border-slate-400 bg-white"
                  >
                    {g.label} <b className="tabular-nums">{g.list.length}</b>
                  </button>
                ))}
              </div>
              {grouped.map((g) => (
                <div key={g.key} id={`wl-${g.key.replace(/\s+/g, "-")}`} className="mb-5">
                  <button onClick={() => setOpenMap((m) => ({ ...m, [g.key]: !m[g.key] }))} className="flex items-center gap-2 w-full text-left mb-2">
                    <span className="text-slate-400 text-xs w-3">{openMap[g.key] ? "▼" : "▶"}</span>
                    <h2 className="text-base font-semibold">
                      {g.label} ({g.list.length})
                    </h2>
                    <span className="text-xs text-slate-400">{g.hint}</span>
                    {g.avgWeekly !== null && (
                      <span className="ml-auto text-xs text-slate-500">
                        avg weekly <Signed v={g.avgWeekly} digits={1} />%
                      </span>
                    )}
                  </button>
                  {openMap[g.key] &&
                    (g.list.length > 0 ? (
                      <GenericTable rows={g.list} cols={cols} navigate={(t) => navigate(`/company/${t}`)} watchlist={watchlist} hideFilters fullHeight />
                    ) : (
                      <div className="text-xs text-slate-400 border border-slate-200 rounded py-4 text-center">Nothing here right now.</div>
                    ))}
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1 mt-2">
                <h2 className="text-base font-semibold">💼 Owned ({ownedRows.length})</h2>
              </div>
              <GenericTable
                rows={ownedRows}
                cols={cols}
                navigate={(t) => navigate(`/company/${t}`)}
                watchlist={watchlist}
                hideFilters
                emptyMessage="None of your watchlist is currently in your portfolio."
              />

              <div className="flex items-center gap-2 mb-1 mt-8">
                <h2 className="text-base font-semibold">☆ Not Owned ({notOwnedRows.length})</h2>
              </div>
              <GenericTable
                rows={notOwnedRows}
                cols={cols}
                navigate={(t) => navigate(`/company/${t}`)}
                watchlist={watchlist}
                hideFilters
                emptyMessage="Everything on your watchlist is currently in your portfolio."
              />
            </>
          )}

          {detailLoading && (
            <p className="text-xs text-slate-400 mt-2">⏳ Fetching live details for {outsideNse750.length} off-universe ticker{outsideNse750.length > 1 ? "s" : ""}…</p>
          )}
          {detailError && <p className="text-xs text-red-600 mt-2">{detailError}</p>}
          {!detailLoading && stillPartial.length > 0 && (
            <p className="text-xs text-amber-600 mt-2">
              ⚠️ {stillPartial.length} ticker{stillPartial.length > 1 ? "s" : ""} ({stillPartial.join(", ")}) {stillPartial.length > 1 ? "aren't" : "isn't"} in NSE 750, and
              the live yfinance fetch couldn't find {stillPartial.length > 1 ? "them" : "it"} either — showing name/price only.
            </p>
          )}
        </>
      )}
    </div>
  );
}
