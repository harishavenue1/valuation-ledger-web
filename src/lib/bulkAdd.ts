import { api, ApiError } from "./api";
import type { Stock } from "./model";

export interface BulkAddResult {
  successes: { ticker: string; name: string; stock: Stock }[];
  failures: { ticker: string; error: string }[];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Comma-separated multi-ticker fetch — "MTAR, WINDLAS, MCX" fetches
 * all three in one go, looped one at a time with a small pacing delay
 * (same rate-limit reasoning as the old app's retrieve_companies(),
 * which this ports). onEachSuccess fires as each one lands, so callers
 * can update UI state incrementally rather than waiting for the whole
 * batch. Shared by Companies.tsx and GuidanceTracker.tsx — both had the
 * old app's near-identical single-ticker fetch+save logic before this,
 * now just call this once each. */
export async function bulkAddCompanies(
  tickerInput: string,
  onEachSuccess?: (stock: Stock) => void
): Promise<BulkAddResult> {
  const inputTickers = tickerInput
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const successes: BulkAddResult["successes"] = [];
  const failures: BulkAddResult["failures"] = [];
  for (let i = 0; i < inputTickers.length; i++) {
    if (i > 0) await sleep(400);
    const t = inputTickers[i];
    try {
      const { stock } = await api.fetchCompany(t);
      onEachSuccess?.(stock);
      successes.push({ ticker: stock.ticker, name: stock.name, stock });
    } catch (e) {
      failures.push({ ticker: t, error: e instanceof ApiError ? e.message : "fetch failed" });
    }
  }
  return { successes, failures };
}
