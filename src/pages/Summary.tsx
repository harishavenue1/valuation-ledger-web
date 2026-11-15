import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import { api } from "../lib/api";
import { bulkAddCompanies } from "../lib/bulkAdd";
import { WatchlistStar } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";
import {
  Stock,
  fmt,
  fmtSigned,
  computeModel,
  getCaseState,
} from "../lib/model";

const STALE_DAYS = 7;

function stalenessReason(stock: Stock): string | null {
  const ts = stock.fundamentals_fetched_at;
  if (!ts) return "never fetched";
  const fetched = new Date(ts.replace(" ", "T"));
  const days = (Date.now() - fetched.getTime()) / 86400000;
  if (days > STALE_DAYS) return `${Math.floor(days)}d stale`;
  return null;
}

// Same layout as the Guidance Value page, but the revenue growth, margin and EPS come from the Bull case on each company's own page
// (the user's saved Bull scenario, or the app default of 25% revenue growth when none is saved), not from management guidance.
const PE_COLS: [string, string][] = [
  ["peg", "P/E = EPS growth"],
  ["pe_min", "Min (3Y)"],
  ["pe_med", "Median (3Y)"],
  ["pe_max", "Max (3Y)"],
  ["pe_cur", "Current"],
];

// Company, Mkt Cap, Price, OPM, EPS, EPS growth, 5 P/E upside columns, Basis, Own, Remove
const COL_WIDTHS = Array(14).fill(132) as number[];

type SortCol = "name" | "mktcap" | "price" | "opm" | "eps" | "epsg" | "peg" | "pe_min" | "pe_med" | "pe_max" | "pe_cur";

interface Row {
  ticker: string;
  stock: Stock;
  price: number | null;
  mktcap: number | null;
  rev: number | null;
  revG: number | null;
  opm: number | null;
  eps: number | null;
  epsG: number | null;
  up: Record<string, number | null>;
  pe: Record<string, number | null>;
  saved: boolean;
  stale: string | null;
  approx: boolean;
  why: string | null;
}

function sortValue(row: Row, col: SortCol): number | string | null {
  switch (col) {
    case "name": return row.stock.name.toLowerCase();
    case "mktcap": return row.mktcap;
    case "price": return row.price;
    case "opm": return row.opm;
    case "eps": return row.eps;
    case "epsg": return row.epsG;
    default: return row.up[col] ?? null;
  }
}

function PctCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-400">—</span>;
  return <span className={value >= 0 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>{fmtSigned(value, 0)}</span>;
}

const pctCol = (v: number | null) => (v === null ? "text-slate-400" : v >= 0 ? "text-emerald-600" : "text-red-600");

function SortableHeader({
  label, col, sortCol, sortDir, onClick, title, cls = "",
}: {
  label: string; col: SortCol; sortCol: SortCol | null; sortDir: "asc" | "desc"; onClick: (col: SortCol) => void; title?: string; cls?: string;
}) {
  const active = sortCol === col;
  return (
    <th className={`text-center px-2 py-2 whitespace-nowrap ${cls}`} title={title}>
      <button onClick={() => onClick(col)} className={`hover:text-slate-800 ${active ? "text-slate-800" : ""}`}>
        {label} {active ? (sortDir === "desc" ? "▼" : "▲") : ""}
      </button>
    </th>
  );
}

function Section({
  title, emoji, stocks, emptyMsg, scenarios, guidance, fy, onOwnedToggle, onRemove,
}: {
  title: string; emoji: string; stocks: [string, Stock][]; emptyMsg: string; scenarios: any; guidance: any; fy: number;
  onOwnedToggle: (t: string, owned: boolean) => void; onRemove: (t: string) => void;
}) {
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function clickHeader(col: SortCol) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
  }

  const rows: Row[] = useMemo(
    () =>
      stocks.map(([ticker, stock]) => {
        const state = getCaseState(scenarios, stock, guidance[ticker] ?? null, ticker, "bull");
        const model = computeModel(stock, state);
        const lastYr = parseInt(stock.years[stock.years.length - 1].split(" ")[1], 10);
        const yi = fy - lastYr - 1;
        const m = yi >= 0 && yi < model.length ? model[yi] : null;
        const dr = m ? state.drivers[yi] : null;
        let eps = m?.eps ?? null;
        let prevEps = yi <= 0 ? (stock.eps[stock.eps.length - 1] ?? null) : (model[yi - 1]?.eps ?? null);
        let approx = false;
        // No operating margin reported (banks, NBFCs): hold last year's net margin, so EPS grows with revenue.
        const lastEps = stock.eps[stock.eps.length - 1] ?? null;
        if (eps === null && m && m.revenue !== null && lastEps !== null && lastEps > 0) {
          let f = 1;
          for (let k = 0; k <= yi; k++) f *= 1 + (state.drivers[k]?.revGrowth ?? 0) / 100;
          const gF = 1 + (state.drivers[yi]?.revGrowth ?? 0) / 100;
          eps = lastEps * f;
          prevEps = eps / gF;
          approx = true;
        }
        const epsG = eps !== null && prevEps !== null && prevEps > 0 ? (eps / prevEps - 1) * 100 : null;
        const why = m ? (eps === null ? "No operating margin or EPS on record, so no estimate" : null) : `Latest reported year is ${stock.years[stock.years.length - 1]}; the Bull case only projects 3 years beyond it, so there is no FY${String(fy).slice(-2)} estimate`;
        const revG = dr?.revGrowth ?? null;
        const price = stock.current_price;
        const ph = stock.pe_history;
        const pegPe = epsG !== null && epsG > 0 ? (epsG > 100 ? 66 : epsG) : null;
        const pes: Record<string, number | null> = { peg: pegPe, pe_min: ph?.min ?? null, pe_med: ph?.median ?? null, pe_max: ph?.max ?? null, pe_cur: stock.pe_ratio ?? null };
        const up: Record<string, number | null> = {};
        for (const [k] of PE_COLS) {
          const pe = pes[k];
          up[k] = eps !== null && eps > 0 && pe && pe > 0 && price ? ((eps * pe) / price - 1) * 100 : null;
        }
        return {
          ticker, stock, price, mktcap: stock.market_cap_cr,
          rev: m?.revenue ?? null, revG, opm: m?.opm_pct ?? null, eps, epsG, up, pe: pes,
          saved: !!scenarios?.[ticker]?.bull?.drivers,
          stale: stalenessReason(stock),
          approx,
          why,
        };
      }),
    [stocks, scenarios, guidance, fy]
  );

  const sortedRows = useMemo(() => {
    if (!sortCol) return rows;
    const present = rows.filter((r) => sortValue(r, sortCol) !== null);
    const missing = rows.filter((r) => sortValue(r, sortCol) === null);
    present.sort((a, b) => {
      const av = sortValue(a, sortCol)!;
      const bv = sortValue(b, sortCol)!;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "desc" ? -cmp : cmp;
    });
    return [...present, ...missing];
  }, [rows, sortCol, sortDir]);

  const H = { sortCol, sortDir, onClick: clickHeader };
  const tint = (k: string) => (k === "pe_min" ? "bg-sky-50 text-sky-800" : k === "peg" ? "bg-violet-50 text-violet-800" : k === "pe_cur" ? "bg-slate-100" : "");
  const tintTd = (k: string) => (k === "pe_min" ? "bg-sky-50/50" : k === "peg" ? "bg-violet-50/50" : "");
  const peTitle: Record<string, string> = {
    peg: "Upside if the stock is priced at a P/E equal to its EPS growth % (PEG = 1); capped at 66 when growth is over 100%. Not available when EPS growth is zero or negative.",
    pe_min: "Upside at the stock's own 3-year minimum P/E. Positive means upside remains even at the lowest recent multiple.",
    pe_cur: "Upside at today's P/E (trailing).",
  };

  return (
    <div className="mb-8">
      <h2 className="text-sm font-medium text-slate-700 mb-2">
        {emoji} {title} ({stocks.length})
      </h2>
      {stocks.length === 0 ? (
        <div className="text-slate-500 text-sm py-6 text-center border border-slate-200 rounded">{emptyMsg}</div>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="text-[13px]" style={{ tableLayout: "fixed", width: COL_WIDTHS.reduce((a, b) => a + b, 0) }}>
            <colgroup>{COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <SortableHeader label="Company" col="name" {...H} />
                <SortableHeader label="Mkt Cap" col="mktcap" {...H} />
                <SortableHeader label="Price" col="price" {...H} />
                <SortableHeader label="OPM" col="opm" {...H} title="Bull-case operating margin for the selected year" />
                <SortableHeader label="EPS ₹" col="eps" {...H} title="Bull-case EPS for the selected year, from the company page (your saved Bull case, or the default)" />
                <SortableHeader label="EPS growth" col="epsg" {...H} title="Bull-case EPS growth against the year before" />
                {PE_COLS.map(([k, l]) => <SortableHeader key={k} label={l} col={k as SortCol} {...H} cls={tint(k)} title={peTitle[k]} />)}
                <th className="text-center px-2 py-2">Basis</th>
                <th className="text-center px-2 py-2 text-[11px]">Own</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.ticker} className="h-9 border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-1 whitespace-nowrap overflow-hidden" title={`${row.stock.name} (${row.ticker})${row.stale ? " - " + row.stale : ""}`}>
                      <WatchlistStar active={watchlist.set.has(row.ticker)} onToggle={watchlist.toggle} symbol={row.ticker} />
                      <button onClick={() => navigate(`/company/${row.ticker}`)} className="font-medium text-indigo-700 hover:underline text-left truncate min-w-0">
                        {row.stock.name}
                      </button>
                      {row.stale && <span className="text-amber-600 text-[10px] shrink-0">⚠️</span>}
                    </div>
                  </td>
                  <td className="px-2 py-1 text-center tabular-nums whitespace-nowrap">
                    <a href={`https://www.screener.in/company/${encodeURIComponent(row.ticker)}/consolidated/`} target="_blank" rel="noopener noreferrer" className="hover:underline hover:text-indigo-600" title={`Open ${row.ticker} on Screener.in`}>
                      ₹{fmt(row.mktcap)} Cr
                    </a>
                  </td>
                  <td className="px-2 py-1 text-center tabular-nums whitespace-nowrap">
                    <a href={`https://www.tradingview.com/chart/?symbol=NSE%3A${encodeURIComponent(row.ticker)}`} target="_blank" rel="noopener noreferrer" className="hover:underline hover:text-indigo-600" title={`Open ${row.ticker} chart on TradingView`}>
                      ₹{fmt(row.price)} ↗
                    </a>
                  </td>
                  <td className="px-2 py-1 text-center tabular-nums">{row.opm !== null ? `${fmt(row.opm, 0)}%` : <span className="text-slate-400" title={row.approx ? "Not reported for banks/NBFCs" : (row.why ?? undefined)}>—</span>}</td>
                  <td className="px-2 py-1 text-center tabular-nums whitespace-nowrap" title={row.eps === null ? (row.why ?? undefined) : row.approx ? "No operating margin reported (bank/NBFC): last year's EPS grown at the revenue growth rate" : undefined}>
                    {row.eps !== null ? <>₹{fmt(row.eps, 1)}{row.approx && <span className="text-amber-600">†</span>}</> : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-2 py-1 text-center tabular-nums whitespace-nowrap">
                    {row.epsG !== null ? <span className={pctCol(row.epsG)}>{fmtSigned(row.epsG, 0)}</span> : <span className="text-slate-400">—</span>}
                  </td>
                  {PE_COLS.map(([k]) => (
                    <td key={k} className={`px-2 py-1 text-center tabular-nums whitespace-nowrap ${tintTd(k)}`}
                      title={row.up[k] !== null && row.eps !== null && row.pe[k] ? `₹${fmt(row.eps * (row.pe[k] as number))} at ${fmt(row.pe[k], 1)}x P/E` : (row.why ?? (row.pe[k] ? "n/a" : k === "peg" ? "No positive EPS growth, so no P/E to apply" : "No P/E history for this statistic (earnings were negative or too short a record)"))}>
                      {row.up[k] !== null ? <PctCell value={row.up[k]} /> : <span className="text-slate-300">n/a</span>}
                      {row.up[k] !== null && k !== "peg" && k !== "pe_cur" && (row.stock.pe_history?.window_years ?? 2) < 3 && <span className="text-slate-400 text-[10px]">*</span>}
                    </td>
                  ))}
                  <td className="px-2 py-1 text-center whitespace-nowrap">
                    <button onClick={() => navigate(`/company/${row.ticker}`)}
                      className={`px-2 py-[3px] rounded-full border text-[12px] ${row.saved ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-300 bg-slate-50 text-slate-600"} hover:border-slate-400`}
                      title={row.saved ? "Your saved Bull case on the company page. Click to edit." : "Default Bull case (25% revenue growth) because none is saved. Click to set your own on the company page."}>
                      {row.saved ? "your bull" : "default bull"} ↗
                    </button>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <button onClick={() => onOwnedToggle(row.ticker, !row.stock.owned)} title="Click to mark as owned/not owned" className="text-base">
                      {row.stock.owned ? "✅" : "⬜"}
                    </button>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <button onClick={() => onRemove(row.ticker)} title={`Remove ${row.stock.name} from tracking`}>🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Summary() {
  const { bundle, setBundle } = useData();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [fy, setFy] = useState(2027);
  const [ticker, setTicker] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addStatus, setAddStatus] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState<"prices" | "full" | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const filtered = useMemo(() => {
    const all = Object.entries(bundle.stocks);
    const q = query.trim().toLowerCase();
    return q ? all.filter(([t, s]) => s.name.toLowerCase().includes(q) || t.toLowerCase().includes(q)) : all;
  }, [bundle.stocks, query]);

  const owned = filtered.filter(([, s]) => s.owned);
  const tracking = filtered.filter(([, s]) => !s.owned);
  const totalCount = Object.keys(bundle.stocks).length;

  async function addCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setAddBusy(true);
    setAddStatus(null);
    const { successes, failures } = await bulkAddCompanies(ticker, (stock) => {
      setBundle((b) => ({ ...b, stocks: { ...b.stocks, [stock.ticker]: stock } }));
    });
    setAddBusy(false);
    if (successes.length === 0) {
      setAddStatus({ kind: "error", text: `Couldn't fetch: ${failures.map((f) => `${f.ticker}: ${f.error}`).join("; ")}` });
      return;
    }
    setTicker("");
    if (successes.length === 1 && failures.length === 0) {
      navigate(`/company/${successes[0].ticker}`);
      return;
    }
    let text = `Retrieved: ${successes.map((s) => `${s.name} (${s.ticker})`).join(", ")}.`;
    if (failures.length > 0) text += ` Couldn't fetch: ${failures.map((f) => `${f.ticker}: ${f.error}`).join("; ")}`;
    setAddStatus({ kind: failures.length > 0 ? "error" : "info", text });
  }

  async function runRefresh(mode: "prices" | "full") {
    setRefreshing(mode);
    const allTickers = Object.keys(bundle.stocks);
    setProgress({ done: 0, total: allTickers.length });
    const CONCURRENCY = 5;
    const queue = [...allTickers];
    let done = 0;
    async function worker() {
      while (queue.length) {
        const t = queue.shift();
        if (!t) return;
        try {
          const { stock } = mode === "prices" ? await api.refreshPrice(t) : await api.fetchCompany(t);
          setBundle((b) => ({ ...b, stocks: { ...b.stocks, [t]: mode === "prices" ? { ...b.stocks[t], ...stock } : stock } }));
        } catch {
          // best-effort — one failed ticker shouldn't block the rest
        }
        done += 1;
        setProgress({ done, total: allTickers.length });
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRefreshing(null);
  }

  async function toggleOwned(t: string, owned: boolean) {
    setBundle((b) => ({ ...b, stocks: { ...b.stocks, [t]: { ...b.stocks[t], owned } } }));
    api.toggleOwned(t, owned).catch(() => {});
  }

  async function remove(t: string) {
    setBundle((b) => {
      const stocks = { ...b.stocks };
      const scenarios = { ...b.scenarios };
      delete stocks[t];
      delete scenarios[t];
      return { ...b, stocks, scenarios };
    });
    await api.deleteCompany(t);
  }

  return (
    // 2026-09-21 — self-capped, same pattern as Detail.tsx/Guide.tsx,
    // now that App.tsx's shared shell grew to max-w-[2000px] (for
    // Portfolio Allocation's 18-column table). This page's own table is
    // a fixed-pixel COL_WIDTHS layout (~1655px, not percentage-based),
    // so it doesn't stretch to fill a wider shell on its own — without
    // this cap the 2026-08-23 "table fills the shell generously" work
    // would regress back to a wide empty gutter.
    <div className="max-w-[1750px] mx-auto">
      <div className="text-2xl font-bold mb-1">
        {totalCount} compan{totalCount === 1 ? "y" : "ies"} tracked
      </div>
      <div className="flex flex-wrap items-start gap-3 mb-6">
        <input
          placeholder="🔍 Filter by name/ticker"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm w-64 focus:outline-none focus:border-slate-400"
        />
        <div className="ml-auto w-full max-w-sm space-y-2">
          <form onSubmit={addCompany} className="flex gap-2">
            <input
              placeholder="e.g. TITAN, or MTAR, WINDLAS, MCX"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              className="flex-1 bg-slate-50 border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-slate-400"
            />
            <button
              type="submit"
              disabled={addBusy}
              className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50 whitespace-nowrap"
            >
              {addBusy ? "…" : "Retrieve"}
            </button>
          </form>
          {addStatus && (
            <p className={`text-xs ${addStatus.kind === "error" ? "text-red-600" : "text-emerald-600"}`}>{addStatus.text}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => runRefresh("prices")}
              disabled={!!refreshing}
              title="Fast — price/PE/market cap/52W high only, no P&L/quarterly/EMA"
              className="flex-1 text-xs px-3 py-1.5 rounded border border-slate-300 hover:border-slate-400 disabled:opacity-50"
            >
              {refreshing === "prices" ? `Refreshing ${progress.done}/${progress.total}…` : "💹 Refresh prices only"}
            </button>
            <button
              onClick={() => runRefresh("full")}
              disabled={!!refreshing}
              title="Full refresh — re-fetches P&L, Quarterly Results, and EMAs too (slower)"
              className="flex-1 text-xs px-3 py-1.5 rounded border border-slate-300 hover:border-slate-400 disabled:opacity-50"
            >
              {refreshing === "full" ? `Refreshing ${progress.done}/${progress.total}…` : "🔄 Refresh all now"}
            </button>
          </div>
        </div>
      </div>

      {totalCount === 0 ? (
        <div className="text-slate-500 text-sm py-8 text-center border border-slate-200 rounded">
          No companies yet — retrieve one from Screener.in above.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
            <span className="text-slate-500">Year:</span>
            {[2027, 2028].map((y) => (
              <button key={y} onClick={() => setFy(y)} className={`px-2 py-0.5 rounded-full border ${fy === y ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}>FY{String(y).slice(-2)}</button>
            ))}
            <span className="text-slate-400">Revenue growth, margin and EPS come from each company's Bull case (your saved one, or the default 25% growth). Each P/E column is the upside to today's price if that EPS is priced at that P/E.</span>
          </div>
          <Section
            title="Stocks I Own"
            emoji="📦"
            stocks={owned}
            emptyMsg={query ? `No owned stocks matching "${query}".` : "No owned stocks yet — check the Own box on a company below to move it here."}
            scenarios={bundle.scenarios}
            guidance={bundle.guidance}
            fy={fy}
            onOwnedToggle={toggleOwned}
            onRemove={remove}
          />
          <Section
            title="Tracking"
            emoji="🔭"
            stocks={tracking}
            emptyMsg={query ? `Nothing tracked matching "${query}".` : "Nothing being tracked right now."}
            scenarios={bundle.scenarios}
            guidance={bundle.guidance}
            fy={fy}
            onOwnedToggle={toggleOwned}
            onRemove={remove}
          />
        </>
      )}
    </div>
  );
}
