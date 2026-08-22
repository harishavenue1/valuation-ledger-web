import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import { api } from "../lib/api";
import { bulkAddCompanies } from "../lib/bulkAdd";
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

function PctCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-400">—</span>;
  return <span className={value >= 0 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>{fmtSigned(value)}</span>;
}

function CaseCell({ h }: { h: ReturnType<typeof headlineCagr> }) {
  if (!h || h.cagr === null) return <span className="text-slate-400 text-xs">fill PE</span>;
  return (
    <div>
      <div className="text-[10px] font-semibold text-slate-500">FY{h.year}</div>
      <div className="text-xs whitespace-nowrap">
        {fmtSigned(h.growth, 1)} | {fmt(h.pe, 1)}x |{" "}
        <span className={h.cagr >= 0 ? "text-emerald-600 font-bold" : "text-red-600 font-bold"}>{fmtSigned(h.cagr, 1)}</span>
      </div>
    </div>
  );
}

function SortableHeader({
  label,
  col,
  sortCol,
  sortDir,
  onClick,
}: {
  label: string;
  col: SortCol;
  sortCol: SortCol | null;
  sortDir: "asc" | "desc";
  onClick: (col: SortCol) => void;
}) {
  const active = sortCol === col;
  return (
    <th className="text-center px-2 py-2 whitespace-nowrap">
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
      <h2 className="text-sm font-medium text-slate-700 mb-2">
        {emoji} {title} ({stocks.length})
      </h2>
      {stocks.length === 0 ? (
        <div className="text-slate-500 text-sm py-6 text-center border border-slate-200 rounded">{emptyMsg}</div>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <SortableHeader label="Company" col="name" sortCol={sortCol} sortDir={sortDir} onClick={clickHeader} />
                <SortableHeader label="Mkt Cap" col="mktcap" sortCol={sortCol} sortDir={sortDir} onClick={clickHeader} />
                <SortableHeader label="Price" col="price" sortCol={sortCol} sortDir={sortDir} onClick={clickHeader} />
                <SortableHeader label="P/E" col="pe" sortCol={sortCol} sortDir={sortDir} onClick={clickHeader} />
                <th className="text-center px-2 py-2" title="Current price vs. the Bull case's target price today (not annualized)">
                  <button onClick={() => clickHeader("upside")} className={sortCol === "upside" ? "text-slate-800" : "hover:text-slate-800"}>
                    Upside {sortCol === "upside" ? (sortDir === "desc" ? "▼" : "▲") : ""}
                  </button>
                </th>
                <SortableHeader label="Qtr Sales Gr%" col="qtr_sales_g" sortCol={sortCol} sortDir={sortDir} onClick={clickHeader} />
                {EMA_COLS.map(([key, label]) => (
                  <SortableHeader key={key} label={label} col={`ema_${key}` as SortCol} sortCol={sortCol} sortDir={sortDir} onClick={clickHeader} />
                ))}
                {GRID_CASES.map((c) => (
                  <th key={c} className="text-center px-2 py-2" style={{ color: CASE_COLOR[c] }}>
                    <button onClick={() => clickHeader(c as SortCol)} className="hover:opacity-80">
                      {CASE_LABEL[c].replace(" Case", "")} {sortCol === c ? (sortDir === "desc" ? "▼" : "▲") : ""}
                    </button>
                  </th>
                ))}
                <th className="text-center px-2 py-2 text-[11px]">Own</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.ticker} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <button onClick={() => navigate(`/company/${row.ticker}`)} className="font-medium hover:underline text-left">
                      {row.stock.name}
                    </button>
                    <div className="text-slate-500 text-xs">{row.ticker}</div>
                    {row.stale && <div className="text-amber-600 text-[10px]">⚠️ {row.stale}</div>}
                  </td>
                  <td className="px-2 py-2 text-center tabular-nums">₹{fmt(row.mktcap)} Cr</td>
                  <td className="px-2 py-2 text-center tabular-nums">₹{fmt(row.price)}</td>
                  <td className="px-2 py-2 text-center tabular-nums">{fmt(row.pe, 1)}x</td>
                  <td className="px-2 py-2 text-center">
                    <PctCell value={row.upside} />
                  </td>
                  <td className="px-2 py-2 text-center">
                    {row.qtrSalesLabel && row.qtrSalesG !== null ? (
                      <div>
                        <div className="text-[10px] font-semibold text-slate-500">{fiscalQuarterLabel(row.qtrSalesLabel)}</div>
                        <PctCell value={row.qtrSalesG} />
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  {EMA_COLS.map(([key]) => (
                    <td key={key} className="px-2 py-2 text-center">
                      <PctCell value={row.ema[key]} />
                    </td>
                  ))}
                  {GRID_CASES.map((c) => (
                    <td key={c} className="px-2 py-2 text-center">
                      <CaseCell h={row.caseHeadline[c]} />
                    </td>
                  ))}
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
    <div>
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
