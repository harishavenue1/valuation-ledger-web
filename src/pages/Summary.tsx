import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import { api } from "../lib/api";
import { bulkAddCompanies } from "../lib/bulkAdd";
import { WatchlistStar } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";
import {
  CASE_COLOR,
  CASE_LABEL,
  GRID_CASES,
  Stock,
  fiscalQuarterLabel,
  fmt,
  fmtSigned,
  computeModel,
  getCaseState,
  headlineCagr,
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

// Upside to the Base-case EPS at the stock's own 3-year Min / Median / Max P/E (same idea as the Guidance Value page).
const PE_COLS: [string, string][] = [
  ["pe_min", "Min (3Y)"],
  ["pe_med", "Median (3Y)"],
  ["pe_max", "Max (3Y)"],
];

// Column, MktCap, Price, P/E, Upside, QtrSalesGr%, 20D, 50D, 33W, Base, Bull, Bear, Trend, Own, Remove
// Base/Bull/Bear widened 150->210 — at 150 the "+20.0% | 20.0x |
// -73.4%" line was truncating with an ellipsis (2026-08-23
// screenshot). Other columns bumped up too so the table fills more
// of the page's shell (App.tsx's <main>, max-w-[2000px] as of
// 2026-09-21) generously instead of leaving a wide empty gutter,
// rather than widening only the 3 cutoff columns.
// 2026-11-15 ("single row and equidistant column width"): every column the same width, one line per row.
const COL_WIDTHS = Array(15).fill(132) as number[];

type SortCol = "name" | "mktcap" | "price" | "pe" | "upside" | "qtr_sales_g" | "pe_min" | "pe_med" | "pe_max" | "base" | "bull" | "bear";

interface Row {
  ticker: string;
  stock: Stock;
  price: number | null;
  pe: number | null;
  mktcap: number | null;
  upside: number | null;
  gPe: number | null;
  qEpsG: number | null;
  qtrSalesG: number | null;
  qtrSalesLabel: string | undefined;
  peUp: Record<string, number | null>;
  peEps: number | null;
  peYear: number | null;
  peWin: number | null;
  caseHeadline: Record<string, ReturnType<typeof headlineCagr>>;
  stale: string | null;
}

function sortValue(row: Row, col: SortCol): number | string | null {
  switch (col) {
    case "name":
      return row.stock.name.toLowerCase();
    case "mktcap":
      return row.mktcap;
    case "price":
      return row.price;
    case "pe":
      return row.pe;
    case "upside":
      return row.upside;
    case "qtr_sales_g":
      return row.qtrSalesG;
    case "pe_min":
    case "pe_med":
    case "pe_max":
      return row.peUp[col];
    default:
      {
        const h = row.caseHeadline[col];
        return h && h.cagr !== null && row.price ? (h.sharePrice / row.price - 1) * 100 : null;
      }
  }
}

function PctCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-400">—</span>;
  return <span className={value >= 0 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>{fmtSigned(value)}</span>;
}

// Built from the 4 real trailing price points already on `Stock` (33W
// EMA → 50D EMA → 20D EMA → CMP) — coarse, but every point is real
// data, not a synthesized shape. Re-added 2026-09-18 after a full
// revert of the dark-theme redesign accidentally dropped it too — the
// "not good" feedback was about the dark background, not this column.
// 2026-09-18 ("what is trend timeframe used on summary, make it 1Y
// weekly") — previously plotted 4 different EMA values (33W/50D/20D/
// CMP) as a rough stand-in for a trend line, since no real price
// history was fetched anywhere. Now uses stock.price_history_52w —
// the last ~52 real weekly closes (same Screener.in fetch ema33w
// already made, just no longer discarded after computing the EMA —
// see api/_screener_fetch.py's fetch_price_emas). Only populated by a
// FULL refresh ("🔄 Refresh all now" or a fresh company add), same
// lifecycle as the EMA fields themselves — a company only ever
// "💹 Refresh prices only"'d, or added before this shipped, falls back
// to "—" until its next full refresh, rather than silently reverting
// to the old coarse EMA approximation.
function TrendSparkline({ stock }: { stock: Stock }) {
  const closes = stock.price_history_52w;
  if (!closes || closes.length < 2) return <span className="text-slate-400 text-xs">—</span>;

  const W = 72;
  const H = 26;
  const PAD = 3;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const step = (W - PAD * 2) / (closes.length - 1);
  const coords = closes.map((v, i) => {
    const x = PAD + i * step;
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
    return [x, y] as [number, number];
  });
  const up = closes[closes.length - 1] >= closes[0];
  const color = up ? "#16a34a" : "#d9894a";
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${PAD},${H - PAD} ${line} ${W - PAD},${H - PAD}`;
  const title = `1Y weekly: ${fmt(closes[0], 1)} → ${fmt(closes[closes.length - 1], 1)} (${fmtSigned((closes[closes.length - 1] / closes[0] - 1) * 100, 1)})`;

  return (
    // React's SVGProps<SVGSVGElement> has no `title` attribute (unlike
    // HTML elements) — a wrapping <span title=...> gives the identical
    // hover tooltip without changing anything visual.
    <span title={title}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <polygon points={area} fill={color} fillOpacity={0.12} stroke="none" />
        <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function CaseCell({ h, price }: { h: ReturnType<typeof headlineCagr>; price: number | null }) {
  if (!h || h.cagr === null || !price) return <span className="text-slate-400 text-xs">fill PE</span>;
  // Total move from today's price to the case's target price (not annualised), same basis as the Upside column.
  const up = (h.sharePrice / price - 1) * 100;
  const full = `FY${h.year}: revenue growth ${fmtSigned(h.growth, 1)}, P/E ${fmt(h.pe, 1)}x, target price ₹${fmt(h.sharePrice)} -> ${fmtSigned(up, 1)} total (${fmtSigned(h.cagr, 1)} a year)`;
  return (
    <div className={`text-xs font-bold whitespace-nowrap ${up >= 0 ? "text-emerald-600" : "text-red-600"}`} title={full}>
      {fmtSigned(up, 1)}
    </div>
  );
}

function SortableHeader({
  label,
  col,
  sortCol,
  sortDir,
  onClick,
  width,
}: {
  label: string;
  col: SortCol;
  sortCol: SortCol | null;
  sortDir: "asc" | "desc";
  onClick: (col: SortCol) => void;
  width?: number;
}) {
  const active = sortCol === col;
  return (
    <th className="text-center px-2 py-2 whitespace-nowrap" style={width ? { width } : undefined}>
      <button onClick={() => onClick(col)} className={`hover:text-slate-800 ${active ? "text-slate-800" : ""}`}>
        {label} {active ? (sortDir === "desc" ? "▼" : "▲") : ""}
      </button>
    </th>
  );
}

function Section({
  title,
  emoji,
  stocks,
  emptyMsg,
  scenarios,
  guidance,
  onOwnedToggle,
  onRemove,
}: {
  title: string;
  emoji: string;
  stocks: [string, Stock][];
  emptyMsg: string;
  scenarios: any;
  guidance: any;
  onOwnedToggle: (t: string, owned: boolean) => void;
  onRemove: (t: string) => void;
}) {
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function clickHeader(col: SortCol) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  const rows: Row[] = useMemo(
    () =>
      stocks.map(([ticker, stock]) => {
        const caseHeadline: Row["caseHeadline"] = {};
        for (const c of GRID_CASES) {
          caseHeadline[c] = headlineCagr(stock, getCaseState(scenarios, stock, guidance[ticker] ?? null, ticker, c));
        }
        // Base-case EPS for the year the headline uses (explicit pick, else first year with a P/E filled, else next year).
        const baseState = getCaseState(scenarios, stock, guidance[ticker] ?? null, ticker, "base");
        const baseModel = computeModel(stock, baseState);
        const lastYr = parseInt(stock.years[stock.years.length - 1].split(" ")[1], 10);
        let yi = baseState.chosenYear ?? baseState.drivers.findIndex((d) => d.pe);
        if (yi === null || yi < 0) yi = 0;
        const peEps = baseModel[yi]?.eps ?? null;
        const peYear = lastYr + yi + 1;
        const ph = stock.pe_history;
        const upAt = (pe: number | undefined) => (peEps !== null && peEps > 0 && pe && stock.current_price ? ((peEps * pe) / stock.current_price - 1) * 100 : null);
        const peUpside: Record<string, number | null> = { pe_min: upAt(ph?.min), pe_med: upAt(ph?.median), pe_max: upAt(ph?.max) };
        // Upside at P/E = last quarter's YoY EPS growth (capped at 66 when growth is over 100%, same rule as the Guidance Value page).
        const qe = stock.q_eps as (number | null)[] | undefined;
        const qeLast = qe && qe.length >= 5 ? qe[qe.length - 1] : null;
        const qeYa = qe && qe.length >= 5 ? qe[qe.length - 5] : null;
        const qEpsG = qeLast !== null && qeYa !== null && qeYa > 0 ? (qeLast / qeYa - 1) * 100 : null;
        const gPe = qEpsG !== null && qEpsG > 0 ? (qEpsG > 100 ? 66 : qEpsG) : null;
        const upside = gPe !== null && peEps !== null && peEps > 0 && stock.current_price ? ((peEps * gPe) / stock.current_price - 1) * 100 : null;
        const qGrowth = stock.q_revenue_growth_pct as (number | null)[] | undefined;
        const qLabels = stock.quarters;
        return {
          ticker,
          stock,
          price: stock.current_price,
          pe: stock.pe_ratio,
          mktcap: stock.market_cap_cr,
          upside,
          gPe,
          qEpsG,
          qtrSalesG: qGrowth && qGrowth.length ? qGrowth[qGrowth.length - 1] : null,
          qtrSalesLabel: qLabels && qLabels.length ? qLabels[qLabels.length - 1] : undefined,
          peUp: peUpside,
          peEps,
          peYear,
          peWin: stock.pe_history ? stock.pe_history.window_years ?? 2 : null,
          caseHeadline,
          stale: stalenessReason(stock),
        };
      }),
    [stocks, scenarios, guidance]
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

  return (
    <div className="mb-8">
      <h2 className="text-sm font-medium text-slate-700 mb-2">
        {emoji} {title} ({stocks.length})
      </h2>
      {stocks.length === 0 ? (
        <div className="text-slate-500 text-sm py-6 text-center border border-slate-200 rounded">{emptyMsg}</div>
      ) : (
        // table-layout: fixed + an explicit width on every header cell —
        // without this, "Stocks I Own" and "Tracking" (two independent
        // tables) each auto-size their own columns off their own data,
        // so corresponding columns don't line up in width between the
        // two sections even though they're meant to read as one
        // continuous grid. Same fix as the Detail page's Annual Results
        // table.
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="text-sm" style={{ tableLayout: "fixed", width: COL_WIDTHS.reduce((a, b) => a + b, 0) }}>
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <SortableHeader label="Company" col="name" sortCol={sortCol} sortDir={sortDir} onClick={clickHeader} width={COL_WIDTHS[0]} />
                <SortableHeader label="Mkt Cap" col="mktcap" sortCol={sortCol} sortDir={sortDir} onClick={clickHeader} width={COL_WIDTHS[1]} />
                <SortableHeader label="Price" col="price" sortCol={sortCol} sortDir={sortDir} onClick={clickHeader} width={COL_WIDTHS[2]} />
                <SortableHeader label="P/E" col="pe" sortCol={sortCol} sortDir={sortDir} onClick={clickHeader} width={COL_WIDTHS[3]} />
                <th className="text-center px-2 py-2" style={{ width: COL_WIDTHS[4] }} title="Base-case EPS x a P/E equal to last quarter's YoY EPS growth (66 if growth is over 100%), vs today's price. Not annualised.">
                  <button onClick={() => clickHeader("upside")} className={sortCol === "upside" ? "text-slate-800" : "hover:text-slate-800"}>
                    P/E = Qtr EPS Gr {sortCol === "upside" ? (sortDir === "desc" ? "▼" : "▲") : ""}
                  </button>
                </th>
                <SortableHeader label="Qtr Sales Gr%" col="qtr_sales_g" sortCol={sortCol} sortDir={sortDir} onClick={clickHeader} width={COL_WIDTHS[5]} />
                {PE_COLS.map(([key, label], i) => (
                  <SortableHeader key={key} label={label} col={key as SortCol} sortCol={sortCol} sortDir={sortDir} onClick={clickHeader} width={COL_WIDTHS[6 + i]} />
                ))}
                {GRID_CASES.map((c, i) => (
                  <th key={c} className="text-center px-2 py-2" style={{ color: CASE_COLOR[c], width: COL_WIDTHS[9 + i] }}>
                    <button onClick={() => clickHeader(c as SortCol)} className="hover:opacity-80">
                      {CASE_LABEL[c].replace(" Case", "")} {sortCol === c ? (sortDir === "desc" ? "▼" : "▲") : ""}
                    </button>
                  </th>
                ))}
                <th className="text-center px-2 py-2 text-[11px]" style={{ width: COL_WIDTHS[12] }}>Trend</th>
                <th className="text-center px-2 py-2 text-[11px]" style={{ width: COL_WIDTHS[13] }}>Own</th>
                <th className="px-2 py-2" style={{ width: COL_WIDTHS[14] }}></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.ticker} className="border-t border-slate-200 hover:bg-slate-50">
                  {/* Company column is a fixed 200px (COL_WIDTHS[0]), so
                      names wrap to however many lines they need — 1 for
                      short ones, 3 for long ones — and since row height
                      follows its tallest cell, that made row heights
                      vary company to company (2026-08-23, "some show in
                      2 lines, some in 3 lines"). min-h-[64px] reserves
                      room for the worst case (3 lines) on every row so
                      they're all the same static height, and line-
                      clamp-3 caps any name longer than that instead of
                      growing the row further. */}
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1 whitespace-nowrap overflow-hidden" title={`${row.stock.name} (${row.ticker})${row.stale ? " - " + row.stale : ""}`}>
                      <WatchlistStar active={watchlist.set.has(row.ticker)} onToggle={watchlist.toggle} symbol={row.ticker} />
                      <button onClick={() => navigate(`/company/${row.ticker}`)} className="font-medium hover:underline text-left truncate min-w-0">
                        {row.stock.name}
                      </button>
                      {row.stale && <span className="text-amber-600 text-[10px] shrink-0">⚠️</span>}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center tabular-nums whitespace-nowrap">₹{fmt(row.mktcap)} Cr</td>
                  <td className="px-2 py-2 text-center tabular-nums">₹{fmt(row.price)}</td>
                  <td className="px-2 py-2 text-center tabular-nums">{fmt(row.pe, 1)}x</td>
                  <td className="px-2 py-2 text-center whitespace-nowrap" title={row.gPe !== null && row.peEps !== null ? `Last-quarter EPS growth ${fmt(row.qEpsG, 1)}% -> P/E ${fmt(row.gPe, 1)}x${row.qEpsG !== null && row.qEpsG > 100 ? " (capped at 66)" : ""}; FY${row.peYear} Base-case EPS ₹${fmt(row.peEps, 1)} -> ₹${fmt(row.peEps * row.gPe)}` : "No positive EPS growth in the last quarter, so no P/E to apply"}>
                    <PctCell value={row.upside} />
                  </td>
                  <td className="px-2 py-2 text-center">
                    {row.qtrSalesLabel && row.qtrSalesG !== null ? (
                      <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                        <span className="text-[10px] font-semibold text-slate-500">{fiscalQuarterLabel(row.qtrSalesLabel)}</span>
                        <PctCell value={row.qtrSalesG} />
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  {PE_COLS.map(([key]) => {
                    const stat = row.stock.pe_history ? (key === "pe_min" ? row.stock.pe_history.min : key === "pe_med" ? row.stock.pe_history.median : row.stock.pe_history.max) : null;
                    const tip = row.peEps !== null && stat !== null
                      ? `FY${row.peYear} Base-case EPS ₹${fmt(row.peEps, 1)} x P/E ${fmt(stat, 1)}x = ₹${fmt(row.peEps * stat)}${row.peWin !== null && row.peWin < 3 ? ` (P/E range is the ${row.peWin}-year one until this stock's next full refresh)` : ""}`
                      : undefined;
                    return (
                      <td key={key} className="px-2 py-2 text-center whitespace-nowrap" title={tip}>
                        <PctCell value={row.peUp[key]} />
                        {row.peUp[key] !== null && row.peWin !== null && row.peWin < 3 && <span className="text-slate-400 text-[10px]">*</span>}
                      </td>
                    );
                  })}
                  {GRID_CASES.map((c) => (
                    <td key={c} className="px-2 py-2 text-center">
                      <CaseCell h={row.caseHeadline[c]} price={row.price} />
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center">
                    <div className="flex justify-center">
                      <TrendSparkline stock={row.stock} />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      onClick={() => onOwnedToggle(row.ticker, !row.stock.owned)}
                      title="Click to mark as owned/not owned"
                      className="text-base"
                    >
                      {row.stock.owned ? "✅" : "⬜"}
                    </button>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button onClick={() => onRemove(row.ticker)} title={`Remove ${row.stock.name} from tracking`}>
                      🗑️
                    </button>
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
          <Section
            title="Stocks I Own"
            emoji="📦"
            stocks={owned}
            emptyMsg={query ? `No owned stocks matching "${query}".` : "No owned stocks yet — check the Own box on a company below to move it here."}
            scenarios={bundle.scenarios}
            guidance={bundle.guidance}
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
            onOwnedToggle={toggleOwned}
            onRemove={remove}
          />
        </>
      )}
    </div>
  );
}
