import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import { api } from "../lib/api";
import { GenericTable, NSE_SCREENER_COLS } from "../components/ScreenerTable";

// Deliberately NOT its own priced dataset — tickers here are just a
// persisted list (api/watchlist.py); their actual columns (price/RSI
// D-W-M/3W green/etc.) come from bundle.momentum_screeners.nseScreener,
// which already covers the whole NSE 750 universe. Add stocks via the
// checkbox + "Add to Watchlist" button on Viraj Screen or any Momentum
// Screeners tab (2026-08-23, "a stocks watchlist with same columns as
// in the NSE Screener... from any screener page, user should be able
// to select and add to watchlist").
export default function Watchlist() {
  const { bundle, setBundle, reload } = useData();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);
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

  function toggleOne(symbol: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }
  function toggleAll(symbols: string[]) {
    setSelected((s) => {
      const allSelected = symbols.length > 0 && symbols.every((sym) => s.has(sym));
      return allSelected ? new Set() : new Set(symbols);
    });
  }

  async function removeSelected() {
    const toRemove = Array.from(selected);
    if (toRemove.length === 0) return;
    setRemoving(true);
    try {
      const wl = await api.updateWatchlist("remove", toRemove);
      setBundle((b) => ({ ...b, watchlist: wl }));
      setSelected(new Set());
    } finally {
      setRemoving(false);
    }
  }

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
        Columns match the NSE Screener tab — data comes from that screener's latest run, not a separate fetch. Add stocks from any screener page's checkboxes.
      </p>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={removeSelected}
            disabled={removing}
            className="text-xs px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white font-medium disabled:opacity-50"
          >
            {removing ? "Removing…" : `Remove ${selected.size} from Watchlist`}
          </button>
        </div>
      )}

      {tickers.length === 0 ? (
        <div className="text-slate-500 text-sm py-10 text-center border border-slate-200 rounded">
          Your watchlist is empty — check the boxes next to any stock on Viraj Screen or Momentum Screeners and hit "Add to Watchlist".
        </div>
      ) : (
        <>
          <GenericTable
            rows={rows}
            cols={NSE_SCREENER_COLS}
            navigate={(t) => navigate(`/company/${t}`)}
            selection={{ selected, onToggle: toggleOne, onToggleAll: toggleAll }}
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
