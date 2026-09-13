// Per-ticker growth override store — added 2026-09-13 ("we cant apply
// generic rates across we need specific, so its better you give a
// link from scan page to main page, were we can override and same
// can reflect back to scan page"). A blanket single growth path
// applied uniformly to every stock in Reverse DCF Scan (shipped hours
// earlier the same session) doesn't hold up — different companies
// warrant different growth assumptions. This instead persists ONE
// company's own hand-tuned stage1/2/3 growth (set on /reverse-dcf,
// the single-stock page) keyed by ticker, so /reverse-dcf-scan can
// read it back and use THAT specific path for THAT specific row —
// every other row keeps using the existing auto-decay off its own
// market-implied rate. Plain localStorage, no backend: both pages
// live in the same browser/session already, and this is a personal
// screening preference, not shared data other viewers need to see.
export interface StageOverride {
  stage1Pct: number;
  stage2Pct: number;
  stage3Pct: number;
}

const PREFIX = "vl:reverseDcfGrowth:";

export function getGrowthOverride(ticker: string): StageOverride | null {
  try {
    const raw = localStorage.getItem(PREFIX + ticker);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.stage1Pct !== "number" || typeof parsed?.stage2Pct !== "number" || typeof parsed?.stage3Pct !== "number") return null;
    return parsed;
  } catch {
    return null; // private-mode/blocked storage, corrupt JSON — treat exactly like "no override saved"
  }
}

export function setGrowthOverride(ticker: string, override: StageOverride): void {
  try {
    localStorage.setItem(PREFIX + ticker, JSON.stringify(override));
  } catch {
    // localStorage can throw (private mode, quota, disabled) — silently no-op, same as every other localStorage use in this app
  }
}

export function clearGrowthOverride(ticker: string): void {
  try {
    localStorage.removeItem(PREFIX + ticker);
  } catch {
    // ignore
  }
}
