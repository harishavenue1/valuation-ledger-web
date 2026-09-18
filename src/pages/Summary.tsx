import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import { api } from "../lib/api";
import { bulkAddCompanies } from "../lib/bulkAdd";
import { useWatchlist } from "../lib/useWatchlist";
import {
  CASE_COLOR,
  CASE_LABEL,
  GRID_CASES,
  Stock,
  fiscalQuarterLabel,
  fmt,
  fmtSigned,
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

function emaPct(price: number | null, ema: number | null | undefined): number | null {
  if (price === null || ema === null || ema === undefined || ema === 0) return null;
  return ((price - ema) / ema) * 100;
}

const EMA_COLS: [string, string][] = [
  ["ema20d", "20D"],
  ["ema50d", "50D"],
  ["ema33w", "33W"],
];

// 2026-09-18 — "visual make over to match the screenshot attached" (a
// dark-card, badge-heavy tracker UI from a different app entirely).
// Restyled to a dark panel with pill badges, numbered rows, and a
// per-row trend sparkline — scoped to this page only (rest of the app
// keeps its light theme); every column here is still backed by real
// data already in `Stock`/`caseHeadline`, nothing fabricated to match
// the reference screenshot's look (e.g. no confidence-% badges since
// we don't have that data, no CMP day-change since Stock carries no
// intraday field).
// Index, Watch, Company, MktCap, Price, P/E, Upside, QtrSalesGr%, 20D, 50D, 33W, Base, Bull, Bear, Trend, Own, Remove
const COL_WIDTHS = [40, 44, 220, 100, 90, 75, 90, 100, 80, 80, 80, 210, 210, 210, 90, 70, 50];

type SortCol = "name" | "mktcap" | "price" | "pe" | "upside" | "qtr_sales_g" | "ema_ema20d" | "ema_ema50d" | "ema_ema33w" | "base" | "bull" | "bear";

interface Row {
  ticker: string;
  stock: Stock;
  price: number | null;
  pe: number | null;
  mktcap: number | null;
  upside: number | null;
  qtrSalesG: number | null;
  qtrSalesLabel: string | undefined;
  ema: Record<string, number | null>;
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
    case "ema_ema20d":
      return row.ema.ema20d;
    case "ema_ema50d":
      return row.ema.ema50d;
    case "ema_ema33w":
      return row.ema.ema33w;
    default:
      return row.caseHeadline[col]?.cagr ?? null;
  }
}

// Small tinted pill for a signed %, replacing the old plain colored
// text — matches the reference screenshot's badge-style cells.
function PctBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-600">—</span>;
  const up = value >= 0;
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded-md text-xs font-semibold tabular-nums ${
        up ? "bg-emerald-400/10 text-emerald-400" : "bg-rose-400/10 text-rose-400"
      }`}
    >
      {fmtSigned(value)}
    </span>
  );
}

function CaseCell({ h }: { h: ReturnType<typeof headlineCagr> }) {
  if (!h || h.cagr === null) return <span className="text-slate-600 text-xs">fill PE</span>;
  const detail = `${fmtSigned(h.growth, 1)} | ${fmt(h.pe, 1)}x`;
  const up = h.cagr >= 0;
  return (
    <div className="overflow-hidden flex flex-col items-center gap-0.5">
      <div className="text-[10px] font-medium text-slate-500">FY{h.year}</div>
      <span
        title={`${detail} | ${fmtSigned(h.cagr, 1)}`}
        className={`px-2 py-0.5 rounded-md text-sm font-bold tabular-nums ${up ? "bg-emerald-400/10 text-emerald-400" : "bg-rose-400/10 text-rose-400"}`}
      >
        {fmtSigned(h.cagr, 1)}
      </span>
      <div className="text-[10px] text-slate-500 truncate max-w-full" title={detail}>
        {detail}
      </div>
    </div>
  );
}

// Built from the 4 real trailing price points we actually have on
// `Stock` (33W EMA → 50D EMA → 20D EMA → CMP) — coarse, but every
// point is real data, not a synthesized shape.
function TrendSparkline({ stock }: { stock: Stock }) {
  const series: [string, number | null][] = [
    ["33W EMA", stock.ema33w ?? null],
    ["50D EMA", stock.ema50d ?? null],
    ["20D EMA", stock.ema20d ?? null],
    ["CMP", stock.current_price],
  ];
  const pts = series.filter(([, v]) => v !== null) as [string, number][];
  if (pts.length < 2) return <span className="text-slate-600 text-xs">—</span>;

  const W = 72;
  const H = 26;
  const PAD = 3;
  const vals = pts.map(([, v]) => v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const step = (W - PAD * 2) / (pts.length - 1);
  const coords = pts.map(([, v], i) => {
    const x = PAD + i * step;
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
    return [x, y] as [number, number];
  });
  const up = vals[vals.length - 1] >= vals[0];
  const color = up ? "#34d399" : "#fb7185";
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${PAD},${H - PAD} ${line} ${W - PAD},${H - PAD}`;
  const title = pts.map(([label, v]) => `${label}: ${fmt(v, 1)}`).join(" → ");

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} title={title}>
      <polygon points={area} fill={color} fillOpacity={0.12} stroke="none" />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Local pill-style watch toggle, scoped to this page only — the
// shared WatchlistStar (star icon) is used by every other screener
// page and stays untouched; this reproduces the reference
// screenshot's "+ Watch" / "Saved" pill using the same watchlist
// state/toggle underneath.
function WatchPill({ active, onToggle, symbol }: { active: boolean; onToggle: (symbol: string) => void; symbol: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle(symbol);
      }}
      title={active ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
      className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap border transition-colors ${
        active ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40" : "bg-transparent text-slate-500 border-slate-600 hover:border-slate-400 hover:text-slate-300"
      }`}
    >
      {active ? "★ Saved" : "+ Watch"}
    </button>
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
      <button onClick={() => onClick(col)} className={`hover:text-slate-200 ${active ? "text-slate-200" : ""}`}>
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
        const bullH = caseHeadline["bull"];
        const upside = bullH && bullH.cagr !== null && stock.current_price ? (bullH.sharePrice / stock.current_price - 1) * 100 : null;
        const qGrowth = stock.q_revenue_growth_pct as (number | null)[] | undefined;
        const qLabels = stock.quarters;
        return {
          ticker,
          stock,
          price: stock.current_price,
          pe: stock.pe_ratio,
          mktcap: stock.market_cap_cr,
          upside,
          qtrSalesG: qGrowth && qGrowth.length ? qGrowth[qGrowth.length - 1] : null,
          qtrSalesLabel: qLabels && qLabels.length ? qLabels[qLabels.length - 1] : undefined,
          ema: {
            ema20d: emaPct(stock.current_price, stock.ema20d),
            ema50d: emaPct(stock.current_price, stock.ema50d),
            ema33w: emaPct(stock.current_price, stock.ema33w),
          },
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
      <h2 className="text-sm font-medium text-slate-300 mb-2">
        {emoji} {title} <span className="text-slate-500">({stocks.length})</span>
      </h2>
      {stocks.length === 0 ? (
        <div className="text-slate-500 text-sm py-6 text-center border border-white/10 rounded-xl">{emptyMsg}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="text-sm" style={{ tableLayout: "fixed", width: COL_WIDTHS.reduce((a, b) => a + b, 0) }}>
            <thead className="bg-white/[0.03] text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-center px-2 py-2" style={{ width: COL_WIDTHS[0] }}>
                  #
                </th>
                <th className="text-center px-2 py-2" style={{ width: COL_WIDTHS[1] }}></th>
                <SortableHeader label="Company" col="name" sortCol={sortCol} sortDir={sortDir} onClick={clickHeader} width={COL_WIDTHS[2]} />
                <SortableHeader label="Mkt Cap" col="mktcap" sortCol={sortCol} sortDir={sortDir} onClick={clickHeader} width={COL_WIDTHS[3]} />
                <SortableHeader label="Price" col="price" sortCol={sortCol} sortDir={sortDir} onClick={clickHeader} width={COL_WIDTHS[4]} />
                <SortableHeader label="P/E" col="pe" sortCol={sortCol} sortDir={sortDir} onClick={clickHeader} width={COL_WIDTHS[5]} />
                <th className="text-center px-2 py-2" style={{ width: COL_WIDTHS[6] }} title="Current price vs. the Bull case's target price today (not annualized)">
                  <button onClick={() => clickHeader("upside")} className={sortCol === "upside" ? "text-slate-200" : "hover:text-slate-200"}>
                    Upside {sortCol === "upside" ? (sortDir === "desc" ? "▼" : "▲") : ""}
                  </button>
                </th>
                <SortableHeader label="Qtr Sales Gr%" col="qtr_sales_g" sortCol={sortCol} sortDir={sortDir} onClick={clickHeader} width={COL_WIDTHS[7]} />
                {EMA_COLS.map(([key, label], i) => (
                  <SortableHeader key={key} label={label} col={`ema_${key}` as SortCol} sortCol={sortCol} sortDir={sortDir} onClick={clickHeader} width={COL_WIDTHS[8 + i]} />
                ))}
                {GRID_CASES.map((c, i) => (
                  <th key={c} className="text-center px-2 py-2" style={{ color: CASE_COLOR[c], width: COL_WIDTHS[11 + i] }}>
                    <button onClick={() => clickHeader(c as SortCol)} className="hover:opacity-80">
                      {CASE_LABEL[c].replace(" Case", "")} {sortCol === c ? (sortDir === "desc" ? "▼" : "▲") : ""}
                    </button>
                  </th>
                ))}
                <th className="text-center px-2 py-2 text-[11px]" style={{ width: COL_WIDTHS[14] }}>
                  Trend
                </th>
                <th className="text-center px-2 py-2 text-[11px]" style={{ width: COL_WIDTHS[15] }}>
                  Own
                </th>
                <th className="px-2 py-2" style={{ width: COL_WIDTHS[16] }}></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, i) => (
                <tr key={row.ticker} className={`border-t border-white/5 hover:bg-white/[0.04] ${row.stock.owned ? "bg-emerald-400/[0.03]" : ""}`}>
                  <td className="px-2 py-2 text-center text-slate-600 text-xs tabular-nums">{i + 1}</td>
                  <td className="px-1 py-2 text-center">
                    <WatchPill active={watchlist.set.has(row.ticker)} onToggle={watchlist.toggle} symbol={row.ticker} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="min-h-[64px] flex flex-col justify-center">
                      <button onClick={() => navigate(`/company/${row.ticker}`)} className="font-medium text-slate-100 hover:underline text-left line-clamp-3">
                        {row.stock.name}
                      </button>
                      <div className="text-slate-500 text-[11px] font-mono">{row.ticker}</div>
                      {row.stale && <div className="text-amber-500 text-[10px]">⚠️ {row.stale}</div>}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center tabular-nums text-slate-300">₹{fmt(row.mktcap)} Cr</td>
                  <td className="px-2 py-2 text-center tabular-nums text-slate-300">₹{fmt(row.price)}</td>
                  <td className="px-2 py-2 text-center tabular-nums text-slate-300">{fmt(row.pe, 1)}x</td>
                  <td className="px-2 py-2 text-center">
                    <PctBadge value={row.upside} />
                  </td>
                  <td className="px-2 py-2 text-center">
                    {row.qtrSalesLabel && row.qtrSalesG !== null ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="text-[10px] font-medium text-slate-500">{fiscalQuarterLabel(row.qtrSalesLabel)}</div>
                        <PctBadge value={row.qtrSalesG} />
                      </div>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  {EMA_COLS.map(([key]) => (
                    <td key={key} className="px-2 py-2 text-center">
                      <PctBadge value={row.ema[key]} />
                    </td>
                  ))}
                  {GRID_CASES.map((c) => (
                    <td key={c} className="px-2 py-2 text-center">
                      <CaseCell h={row.caseHeadline[c]} />
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
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                        row.stock.owned ? "bg-emerald-400/10 text-emerald-400 border-emerald-500/30" : "bg-transparent text-slate-500 border-slate-600"
                      }`}
                    >
                      {row.stock.owned ? "Owned" : "Mark"}
                    </button>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button onClick={() => onRemove(row.ticker)} title={`Remove ${row.stock.name} from tracking`} className="text-slate-500 hover:text-rose-400">
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
    <div className="rounded-2xl bg-[#0d0f14] border border-white/10 p-5 text-slate-100">
      <div className="flex flex-wrap items-start gap-3 mb-6">
        <div>
          <div className="text-2xl font-bold mb-1 text-white">
            {totalCount} compan{totalCount === 1 ? "y" : "ies"} tracked
          </div>
          <input
            placeholder="🔍 Filter by name/ticker"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-full px-3 py-1.5 text-sm w-64 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-white/30"
          />
        </div>
        <div className="ml-auto w-full max-w-sm space-y-2">
          <form onSubmit={addCompany} className="flex gap-2">
            <input
              placeholder="e.g. TITAN, or MTAR, WINDLAS, MCX"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-white/30"
            />
            <button
              type="submit"
              disabled={addBusy}
              className="px-3 py-1.5 rounded-full bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium disabled:opacity-50 whitespace-nowrap"
            >
              {addBusy ? "…" : "Retrieve"}
            </button>
          </form>
          {addStatus && (
            <p className={`text-xs ${addStatus.kind === "error" ? "text-rose-400" : "text-emerald-400"}`}>{addStatus.text}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => runRefresh("prices")}
              disabled={!!refreshing}
              title="Fast — price/PE/market cap/52W high only, no P&L/quarterly/EMA"
              className="flex-1 text-xs px-3 py-1.5 rounded-full border border-white/15 text-slate-300 hover:border-white/30 disabled:opacity-50"
            >
              {refreshing === "prices" ? `Refreshing ${progress.done}/${progress.total}…` : "💹 Refresh prices only"}
            </button>
            <button
              onClick={() => runRefresh("full")}
              disabled={!!refreshing}
              title="Full refresh — re-fetches P&L, Quarterly Results, and EMAs too (slower)"
              className="flex-1 text-xs px-3 py-1.5 rounded-full border border-white/15 text-slate-300 hover:border-white/30 disabled:opacity-50"
            >
              {refreshing === "full" ? `Refreshing ${progress.done}/${progress.total}…` : "🔄 Refresh all now"}
            </button>
          </div>
        </div>
      </div>

      {totalCount === 0 ? (
        <div className="text-slate-500 text-sm py-8 text-center border border-white/10 rounded-xl">
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
