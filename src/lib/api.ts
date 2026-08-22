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

export interface Bundle {
  stocks: Record<string, Stock>;
  scenarios: Record<string, Partial<Record<Case, CaseState>>>;
  guidance: Record<string, Guidance>;
  guidance_tracker: GuidanceTracker;
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
};
