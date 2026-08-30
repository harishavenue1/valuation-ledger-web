import type { Case, CaseState, Guidance, Stock } from "./model";

export type GuidanceTag = "" | "Beat" | "Neutral" | "Miss";
export interface GuidanceTrackerCell {
  note: string;
  tag: GuidanceTag;
}
export interface GuidanceTracker {
  quarters: string[];
  tracked: string[];
  cells: Record<string, Record<string, GuidanceTrackerCell>>;
}

// One row per stock from ~/Downloads/viraj_screen.py's "All Stocks"
// sheet — F1-F3/C1-C3 and most numeric-looking fields arrive as
// already-formatted strings ("✅"/"❌"/"—", "+90%", "5/6") straight
// from the script's own build_rows()/render, not raw numbers; render
// them as-is rather than re-parsing.
export interface VirajRow {
  category: string; // "EQ" | "T2T" | "Sharpe", comma-joined when a symbol appears in more than one screen
  symbol: string;
  name: string;
  marketcap: number | string; // momoindiascreener's raw field — type not guaranteed, coerce defensively
  price: number | string; // same — momoindiascreener's "close"
  sales_g: string;
  ebit_g: string;
  eps_g: string;
  dol: string;
  dfl: string;
  dcl: string;
  F1: string;
  F2: string;
  F3: string;
  C1: string;
  C2: string;
  C3: string;
  score: string; // "5/6"
  verdict: string; // "⭐ ENTRY READY" | "WATCHLIST" | "WATCHLIST — await EMA contraction" | "SKIP" | "SKIP — sales declining" | "NO DATA"
}
export interface VirajScreen {
  as_of: string | null;
  rows: VirajRow[];
}

// One entry per NSE750 momentum screener (myLongTermInvestingStrategy,
// weekendInvesting, quantBollinger, Nifty500RelativeStrength), pushed
// independently by each local skill script — row shape differs per
// screener (own columns), so rows are typed loosely and each tab on
// the MomentumScreeners page renders its own known fields.
export interface MomentumScreenerEntry {
  label: string;
  as_of: string | null;
  rows: Record<string, any>[];
}
export type MomentumScreeners = Record<string, MomentumScreenerEntry>;

// "Run now" queue — see api/run_requests.py for why this is a queue a
// local poller drains rather than something Vercel executes itself.
export type RunStatus = "pending" | "running" | "done" | "error";
export interface RunRequestEntry {
  status: RunStatus;
  requested_at: string;
  updated_at: string;
  error: string | null;
}
export type RunRequests = Record<string, RunRequestEntry>;

// Plain persisted ticker list — see api/watchlist.py. Watchlist.tsx
// gets each ticker's actual columns from bundle.momentum_screeners
// .nseScreener, not from a separate fetch.
export interface Watchlist {
  tickers: string[];
}

// Guide page's Multibagger Checklist — see api/_multibagger.py's
// build_checklist() for the exact shape this mirrors. Items' `pass` is
// `null` (not a boolean) when there wasn't enough data to judge that
// specific rule — rendered as a neutral "—", not counted in either
// scored/applicable total.
export interface GuideChecklistItem {
  key: string;
  label: string;
  value: string;
  pass: boolean | null;
}
export interface GuideSection {
  items: GuideChecklistItem[];
  passed: number;
  applicable: number;
}
export interface GuideEntrySetup {
  active: boolean;
  [field: string]: any; // each setup (ma_breakout/value_rsi_turnaround/grandfather_father_son) carries its own detail fields
}
export interface GuideResult {
  ok: boolean;
  ticker: string;
  name: string;
  price: number | null;
  market_cap_cr: number | null;
  pe_ratio: number | null;
  technicals_error: string | null;
  fundamentals: GuideSection;
  technicals: GuideSection;
  entry_setups: {
    ma_breakout: GuideEntrySetup | null;
    value_rsi_turnaround: GuideEntrySetup | null;
    grandfather_father_son: GuideEntrySetup | null;
  };
  score: { passed: number; applicable: number; pct: number; verdict: string };
}

export interface Bundle {
  stocks: Record<string, Stock>;
  scenarios: Record<string, Partial<Record<Case, CaseState>>>;
  guidance: Record<string, Guidance>;
  guidance_tracker: GuidanceTracker;
  viraj_screen: VirajScreen;
  momentum_screeners: MomentumScreeners;
  run_requests: RunRequests;
  watchlist: Watchlist;
  last_refresh: Record<string, any>;
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req(path: string, opts: RequestInit = {}) {
  const res = await fetch(path, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (res.status === 401) throw new ApiError(401, "unauthorized");
  if (!res.ok) {
    let msg = `request failed (${res.status})`;
    try {
      const body = await res.json();
      msg = body.error || msg;
    } catch {}
    throw new ApiError(res.status, msg);
  }
  return res.status === 204 ? null : res.json();
}

export { ApiError };

export const api = {
  login: (password: string) => req("/api/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => req("/api/login", { method: "DELETE" }),

  getAll: (): Promise<Bundle> => req("/api/stocks"),

  fetchCompany: (ticker: string): Promise<{ stock: Stock }> =>
    req("/api/fetch_company", { method: "POST", body: JSON.stringify({ ticker }) }),

  refreshPrice: (ticker: string): Promise<{ stock: Stock }> =>
    req("/api/refresh_price", { method: "POST", body: JSON.stringify({ ticker }) }),

  deleteCompany: (ticker: string) => req("/api/fetch_company", { method: "DELETE", body: JSON.stringify({ ticker }) }),

  saveScenario: (ticker: string, case_: Case, state: CaseState) =>
    req("/api/scenario", { method: "POST", body: JSON.stringify({ ticker, case: case_, state }) }),

  clearScenario: (ticker: string, case_: Case) =>
    req("/api/scenario", { method: "DELETE", body: JSON.stringify({ ticker, case: case_ }) }),

  saveGuidance: (ticker: string, data: Guidance) => req("/api/guidance", { method: "POST", body: JSON.stringify({ ticker, data }) }),

  saveGuidanceTracker: (tracker: GuidanceTracker) => req("/api/guidance_tracker", { method: "POST", body: JSON.stringify(tracker) }),

  toggleOwned: (ticker: string, owned: boolean) =>
    req("/api/fetch_company", { method: "PATCH", body: JSON.stringify({ ticker, owned }) }),

  requestRun: (screener: string) => req("/api/run_requests", { method: "POST", body: JSON.stringify({ action: "request", screener }) }),

  // Runs one of the 4 yfinance-based NSE-750 momentum screeners
  // directly on Vercel (see api/momentum_screeners.py's do_GET) — the
  // same session cookie every other request already uses, no local
  // poller involved. Takes ~60-100s (a full 750-ticker yfinance pull),
  // so the caller should show a "running" state while this awaits
  // rather than treating it as instant. 2026-08-30, "refresh on click
  // from any machine, not just the Mac" — viraj_screen still needs
  // api.requestRun() above (it needs Harish's own Screener.in/Chartink
  // cookies, which only live on his Mac).
  runScreenerCloud: (screener: string): Promise<{ ok: boolean; universe: number; scanned: number; skipped: number; pushed: number; elapsed_s: number }> =>
    req(`/api/momentum_screeners?screener=${encodeURIComponent(screener)}`),

  // Guide page's Multibagger Checklist (added 2026-08-30) — one live,
  // stateless lookup for ANY NSE company by name/symbol, merging
  // Screener.in fundamentals (ROE/ROCE/cash conversion/DOL/growth) with
  // yfinance technicals mirroring 4 already-shipped screeners (weekly
  // RSI>66 + EMA ribbon, MA Breakout, Value RSI Turnaround, Grandfather-
  // Father-Son) — see api/fetch_company.py's `?guide=` branch and
  // api/_multibagger.py. Takes ~2-4s (one Screener.in page + one
  // single-ticker yfinance pull, nothing at NSE-750 scale).
  guideCheck: (query: string): Promise<GuideResult> => req(`/api/fetch_company?guide=${encodeURIComponent(query)}`),

  updateWatchlist: (action: "add" | "remove", tickers: string[]): Promise<Watchlist> =>
    req("/api/watchlist", { method: "POST", body: JSON.stringify({ action, tickers }) }),

  // On-demand price/RSI/return-% for watchlisted tickers outside NSE
  // 750 (nseScreener has no data for them) — see api/watchlist_detail.py.
  fetchWatchlistDetail: (tickers: string[]): Promise<{ rows: Record<string, Record<string, any>> }> =>
    req("/api/watchlist_detail", { method: "POST", body: JSON.stringify({ tickers }) }),
};
