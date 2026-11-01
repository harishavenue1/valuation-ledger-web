import { useMemo } from "react";
import { useData, useScreeners } from "../App";
import { api } from "./api";

// Shared by every screener page's Symbol-column star toggle
// (2026-08-23, "instead of checkbox... put a button next [to]
// company name under symbol col with a tap/untap"). Optimistic —
// flips bundle.watchlist immediately, reverts if the API call fails.
export function useWatchlist() {
  const { bundle, setBundle } = useData();
  const set = new Set(bundle.watchlist.tickers);
  // 2026-11-01 ("yellow if still in holdings, else green"): the holdings are the latest PF snapshot — the same source the Guidance and Business Radar pages
  // use for "My holdings". A stock sold since the last PF update still counts as held until the next update.
  useScreeners(["portfolioAllocation"]);
  const held = useMemo(() => new Set<string>(((bundle.momentum_screeners as any)?.portfolioAllocation?.rows ?? []).map((r: any) => r.symbol)), [bundle.momentum_screeners]);

  function toggle(symbol: string) {
    const wasIn = set.has(symbol);
    setBundle((b) => ({
      ...b,
      watchlist: { ...b.watchlist, tickers: wasIn ? b.watchlist.tickers.filter((t) => t !== symbol) : [...b.watchlist.tickers, symbol] },
    }));
    api.updateWatchlist(wasIn ? "remove" : "add", [symbol]).catch(() => {
      // revert to the pre-toggle state on failure
      setBundle((b) => ({
        ...b,
        watchlist: { ...b.watchlist, tickers: wasIn ? [...b.watchlist.tickers, symbol] : b.watchlist.tickers.filter((t) => t !== symbol) },
      }));
    });
  }

  return { set, toggle, held };
}
