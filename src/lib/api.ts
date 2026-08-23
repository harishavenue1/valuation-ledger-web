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

  updateWatchlist: (action: "add" | "remove", tickers: string[]): Promise<Watchlist> =>
    req("/api/watchlist", { method: "POST", body: JSON.stringify({ action, tickers }) }),

  // On-demand price/RSI/return-% for watchlisted tickers outside NSE
  // 750 (nseScreener has no data for them) — see api/watchlist_detail.py.
  fetchWatchlistDetail: (tickers: string[]): Promise<{ rows: Record<string, Record<string, any>> }> =>
    req("/api/watchlist_detail", { method: "POST", body: JSON.stringify({ tickers }) }),
};
