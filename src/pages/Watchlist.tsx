import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import { api } from "../lib/api";
import { GenericTable, NSE_SCREENER_COLS } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";

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
  const { bundle, reload } = useData();
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const [refreshing, setRefreshing] = useState(false);

  const tickers = bundle.watchlist.tickers;
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
  const rows = tickers.map((t) => {
    const nse = nseBySymbol.get(t);
    if (nse) return nse;
    outsideNse750.push(t);
    const vr = virajBySymbol.get(t);
    const stock = bundle.stocks[t];
    const live = liveDetail[t];
    return {
      symbol: t,
      name: vr?.name ?? stock?.name ?? t,
      price: toNum(vr?.price) ?? stock?.current_price ?? null,
      ...live,
    };
  });
  // Keyed on the sorted ticker list, not the array reference, so the
  // effect below only re-fires when the actual SET of off-universe
  // tickers changes, not on every render.
  const outsideKey = [...outsideNse750].sort().join(",");
  const stillPartial = outsideNse750.filter((t) => !liveDetail[t]);

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

  async function doRefresh() {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }

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
        Columns match the NSE Screener tab — data comes from that screener's latest run, not a separate fetch. Tap ★ on any screener page to add a stock; tap it again here (or there) to remove it.
      </p>

      {tickers.length === 0 ? (
        <div className="text-slate-500 text-sm py-10 text-center border border-slate-200 rounded">
          Your watchlist is empty — tap the ☆ next to any stock on Viraj Screen or Momentum Screeners to add it.
        </div>
      ) : (
        <>
          <GenericTable
            rows={rows}
            cols={NSE_SCREENER_COLS}
            navigate={(t) => navigate(`/company/${t}`)}
            watchlist={watchlist}
            emptyMessage="Nothing to show yet — Refresh, or run the NSE Screener."
          />
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
