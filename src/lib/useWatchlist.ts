import { useData } from "../App";
import { api } from "./api";

// Shared by every screener page's Symbol-column star toggle
// (2026-08-23, "instead of checkbox... put a button next [to]
// company name under symbol col with a tap/untap"). Optimistic —
// flips bundle.watchlist immediately, reverts if the API call fails.
export function useWatchlist() {
  const { bundle, setBundle } = useData();
  const set = new Set(bundle.watchlist.tickers);

  function toggle(symbol: string) {
    const wasIn = set.has(symbol);
    setBundle((b) => ({
      ...b,
      watchlist: { tickers: wasIn ? b.watchlist.tickers.filter((t) => t !== symbol) : [...b.watchlist.tickers, symbol] },
    }));
    api.updateWatchlist(wasIn ? "remove" : "add", [symbol]).catch(() => {
      // revert to the pre-toggle state on failure
      setBundle((b) => ({
        ...b,
        watchlist: { tickers: wasIn ? [...b.watchlist.tickers, symbol] : b.watchlist.tickers.filter((t) => t !== symbol) },
      }));
    });
  }

  return { set, toggle };
}
