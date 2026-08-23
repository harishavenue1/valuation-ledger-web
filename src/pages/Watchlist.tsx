import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import { GenericTable, NSE_SCREENER_COLS } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";

// Deliberately NOT its own priced dataset — tickers here are just a
// persisted list (api/watchlist.py); their actual columns (price/RSI
// D-W-M/3W green/etc.) come from bundle.momentum_screeners.nseScreener,
// which already covers the whole NSE 750 universe. Add/remove via the
// same tap-to-star toggle used on every screener page (useWatchlist) —
// tapping a starred row's ★ here removes it, since every row on this
// page is by definition already on the watchlist.
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

  const rows = tickers.map((t) => nseBySymbol.get(t)).filter((r): r is Record<string, any> => !!r);
  const missing = tickers.filter((t) => !nseBySymbol.has(t));

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
            emptyMessage="None of your watchlisted tickers are in the NSE Screener's latest data yet — run that screener, or Refresh."
          />
          {missing.length > 0 && (
            <p className="text-xs text-amber-600 mt-2">
              ⚠️ {missing.length} watchlisted ticker{missing.length > 1 ? "s" : ""} not found in the NSE Screener's current data ({missing.join(", ")}) —
              they may be outside NSE 750 or the screener needs a fresh run.
            </p>
          )}
        </>
      )}
    </div>
  );
}
