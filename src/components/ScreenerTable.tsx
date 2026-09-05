import { useMemo, useState } from "react";

// Shared by MomentumScreeners.tsx and Watchlist.tsx — the Watchlist
// page reuses NSE_SCREENER_COLS verbatim (2026-08-23, "a stocks
// watchlist with same columns as in the NSE Screener") so both pages
// render nseScreener rows identically instead of drifting apart.

export function fmtNum(v: any, digits = 2): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isNaN(n) ? String(v) : n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function fmtSigned(v: any, digits = 2): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : parseFloat(v);
  if (Number.isNaN(n)) return String(v);
  return (n >= 0 ? "+" : "") + n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function Signed({ v, digits = 2 }: { v: any; digits?: number }) {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (v === null || v === undefined || v === "" || Number.isNaN(n)) return <span className="text-slate-300">—</span>;
  return <span className={n >= 0 ? "text-emerald-600" : "text-red-600"}>{fmtSigned(n, digits)}</span>;
}

// Collapsed-by-default methodology blurb — shared by every screener
// page (2026-08-23... er, 2026-08-30, "add a note on how the
// calculation for score is calculated or the logic behind this
// screener" for every screener tab). <details>/<summary> rather than
// a state-driven toggle: no click handler to wire up, and it degrades
// fine with JS disabled. Collapsed by default so it doesn't compete
// with the actual data table for space on every page load.
export function MethodologyNote({ children }: { children: React.ReactNode }) {
  return (
    <details className="mb-3 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
      <summary className="cursor-pointer font-medium text-slate-700 select-none">ℹ️ How is this calculated?</summary>
      <div className="mt-2 leading-relaxed max-w-3xl">{children}</div>
    </details>
  );
}

// Price column -> TradingView weekly chart for that symbol, new tab.
// stopPropagation keeps a click here from also triggering the row's
// Symbol nav link.
export function PriceLink({ symbol, value }: { symbol: string; value: any }) {
  return (
    <a
      href={`https://www.tradingview.com/chart/?symbol=NSE:${encodeURIComponent(symbol)}&interval=W`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="hover:underline hover:text-indigo-600"
      title={`Open ${symbol} chart on TradingView`}
    >
      {fmtNum(value)}
    </a>
  );
}

// Symbol column -> Screener.in company page, new tab. Same pattern as
// PriceLink's TradingView link (2026-09-05, "on the price we have
// anyway trading view link, now can we put screener.in link to
// symbol") — a small separate icon rather than repointing the Symbol
// button itself, so this app's own /company/:symbol page (fundamentals,
// watchlist, Run buttons) stays one click away too, not replaced.
function ScreenerInLink({ symbol }: { symbol: string }) {
  return (
    <a
      href={`https://www.screener.in/company/${encodeURIComponent(symbol)}/consolidated/`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="ml-1 text-slate-300 hover:text-indigo-600 no-underline"
      title={`Open ${symbol} on Screener.in`}
    >
      ⧉
    </a>
  );
}

export interface Col {
  key: string;
  label: string;
  render?: (row: Record<string, any>) => React.ReactNode;
  align?: "left" | "right" | "center";
}

export const NSE_SCREENER_COLS: Col[] = [
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "name", label: "Name", align: "left" },
  { key: "sector", label: "Sector", align: "left" },
  { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
  { key: "change_pct", label: "Change %", render: (r) => <Signed v={r.change_pct} digits={1} /> },
  { key: "weekly_pct", label: "Weekly %", render: (r) => <Signed v={r.weekly_pct} digits={1} /> },
  { key: "monthly_pct", label: "Monthly %", render: (r) => <Signed v={r.monthly_pct} digits={1} /> },
  { key: "three_month_pct", label: "3Month %", render: (r) => <Signed v={r.three_month_pct} digits={1} /> },
  { key: "yearly_pct", label: "Yearly %", render: (r) => <Signed v={r.yearly_pct} digits={1} /> },
  { key: "rsi_d", label: "RSI(D)", render: (r) => fmtNum(r.rsi_d, 1) },
  { key: "rsi_w", label: "RSI(W)", render: (r) => fmtNum(r.rsi_w, 1) },
  { key: "rsi_m", label: "RSI(M)", render: (r) => fmtNum(r.rsi_m, 1) },
  { key: "three_week_green", label: "3W Green", render: (r) => (r.three_week_green ? <span className="text-emerald-600 font-semibold">Y</span> : "") },
];

// Generic cross-type comparator for click-to-sort — rows are
// Record<string, any> (each screener has its own row shape), so this
// has to handle numbers, strings, booleans (true-first when
// descending, since a checkmark-style column like "3W Green" reads
// naturally that way), and null/undefined (always sorts last,
// regardless of direction — an unknown value isn't "lowest").
function compareVals(a: any, b: any): number {
  const aNil = a === null || a === undefined || a === "";
  const bNil = b === null || b === undefined || b === "";
  if (aNil && bNil) return 0;
  if (aNil) return 1;
  if (bNil) return -1;
  if (typeof a === "boolean" || typeof b === "boolean") return (a ? 1 : 0) - (b ? 1 : 0);
  const an = typeof a === "number" ? a : parseFloat(a);
  const bn = typeof b === "number" ? b : parseFloat(b);
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  return String(a).localeCompare(String(b));
}

// Star toggle rendered inline in the Symbol cell — tap to add, tap
// again to remove (2026-08-23, "instead of checkbox... put a button
// next [to] company name under symbol col with a tap/untap"). Not a
// Watchlist-only control: renders wherever `watchlist` is passed to
// GenericTable, i.e. every screener page.
export function WatchlistStar({ active, onToggle, symbol }: { active: boolean; onToggle: (symbol: string) => void; symbol: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle(symbol);
      }}
      title={active ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
      className={`mr-1 leading-none align-middle ${active ? "text-amber-500" : "text-slate-300 hover:text-amber-400"}`}
    >
      {active ? "★" : "☆"}
    </button>
  );
}

export interface WatchlistControl {
  set: Set<string>;
  toggle: (symbol: string) => void;
}

export function GenericTable({
  rows,
  cols,
  navigate,
  watchlist,
  emptyMessage = "No data yet for this screener — run its script to push results.",
}: {
  rows: Record<string, any>[];
  cols: Col[];
  navigate: (t: string) => void;
  watchlist?: WatchlistControl;
  emptyMessage?: string;
}) {
  const [q, setQ] = useState("");
  const [sector, setSector] = useState("All");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Auto-detected — only screeners whose rows carry a sector field
  // (all of them do, as of 2026-08-23) show this filter at all.
  const sectors = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.sector) set.add(String(r.sector));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (sector !== "All" && r.sector !== sector) return false;
      if (needle && !String(r.symbol ?? "").toLowerCase().includes(needle) && !String(r.name ?? "").toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, q, sector]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const cmp = compareVals(a[sortKey], b[sortKey]);
      return sortDir === "desc" ? -cmp : cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  function clickHeader(key: string) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      // Symbol/Name/Sector read naturally A-first; every numeric-ish
      // momentum column (returns, RSI, score...) reads naturally
      // biggest-first — matches Summary.tsx's per-column default.
      setSortDir(key === "symbol" || key === "name" || key === "sector" ? "asc" : "desc");
    }
  }

  if (rows.length === 0) {
    return <div className="text-slate-500 text-sm py-10 text-center border border-slate-200 rounded">{emptyMessage}</div>;
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 Filter by name/ticker"
          className="border border-slate-300 rounded px-3 py-1.5 text-sm w-56"
        />
        {sectors.length > 0 && (
          <select value={sector} onChange={(e) => setSector(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm text-slate-700">
            <option value="All">All sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <span className="text-xs text-slate-400">{sorted.length} shown</span>
      </div>
      {/* max-h + overflow-y-auto + thead sticky top-0 — a plain
          overflow-x-auto wrapper (no height cap) still gets treated by
          the browser as the sticky positioning containing block and
          overlaps the first row instead of sticking to the page
          (verified live 2026-08-23 before landing the original fix). */}
      <div className="overflow-x-auto overflow-y-auto max-h-[75vh] rounded-lg border border-slate-200">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-50 text-slate-500 text-xs sticky top-0 z-10">
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={`px-2 py-2 whitespace-nowrap ${c.align === "left" ? "text-left" : "text-center"}`}>
                  <button onClick={() => clickHeader(c.key)} className={`hover:text-slate-800 ${sortKey === c.key ? "text-slate-800 font-semibold" : ""}`}>
                    {c.label} {sortKey === c.key ? (sortDir === "desc" ? "▼" : "▲") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const sym = String(r.symbol ?? i);
              // Symbol alone isn't a safe React key here: sectorStockAlpha
              // (Stocks vs Sector) legitimately pushes the same stock
              // twice — once under its industry, once under a theme it
              // also belongs to (e.g. SONACOMS under both "Automobile and
              // Auto Components" and "Manufacturing") — so two rows can
              // share a symbol. A duplicate React key breaks
              // reconciliation: the header's sort state updates fine, but
              // React can't correctly re-map DOM rows to the new order,
              // so the visible rows silently stop tracking the sort
              // (confirmed live 2026-08-30 sorting Stocks vs Sector by
              // Sector — arrow updated, rows didn't move). r.sector makes
              // the key unique per (symbol, sector) pair for every
              // screener that carries one, without needing an index (an
              // index-based key would be unique but changes every sort/
              // filter, forcing needless remounts of every row).
              const rowKey = r.sector !== undefined ? `${sym}-${r.sector}` : sym;
              return (
                <tr key={rowKey} className="border-t border-slate-100 hover:bg-slate-50">
                  {cols.map((c) => (
                    <td key={c.key} className={`px-2 py-2 ${c.align === "left" ? "text-left" : "text-center"} ${c.key === "symbol" ? "font-semibold text-indigo-600" : "tabular-nums"}`}>
                      {c.key === "symbol" ? (
                        <>
                          {watchlist && <WatchlistStar active={watchlist.set.has(sym)} onToggle={watchlist.toggle} symbol={sym} />}
                          <button onClick={() => navigate(String(r.symbol))} className="hover:underline">
                            {r.symbol}
                          </button>
                          <ScreenerInLink symbol={sym} />
                        </>
                      ) : c.render ? (
                        c.render(r)
                      ) : (
                        String(r[c.key] ?? "—")
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
