import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../App";
import { api } from "../lib/api";
import { CASE_COLOR, CASE_LABEL, GRID_CASES, fmt, fmtSigned, getCaseState, headlineCagr } from "../lib/model";

const STALE_DAYS = 7;

function stalenessReason(stock: any): string | null {
  const ts = stock.fundamentals_fetched_at;
  if (!ts) return "never fetched";
  const fetched = new Date(ts.replace(" ", "T"));
  const days = (Date.now() - fetched.getTime()) / 86400000;
  if (days > STALE_DAYS) return `${Math.floor(days)}d stale`;
  return null;
}

export default function Summary() {
  const { bundle, setBundle } = useData();
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const tickers = useMemo(() => {
    const all = Object.keys(bundle.stocks);
    const q = query.trim().toLowerCase();
    const filtered = q
      ? all.filter((t) => t.toLowerCase().includes(q) || bundle.stocks[t].name.toLowerCase().includes(q))
      : all;
    return filtered.sort((a, b) => bundle.stocks[a].name.localeCompare(bundle.stocks[b].name));
  }, [bundle.stocks, query]);

  async function refreshAll() {
    setRefreshing(true);
    setProgress({ done: 0, total: tickers.length });
    const CONCURRENCY = 5;
    const queue = [...Object.keys(bundle.stocks)];
    let done = 0;
    async function worker() {
      while (queue.length) {
        const t = queue.shift();
        if (!t) return;
        try {
          const { stock } = await api.refreshPrice(t);
          setBundle((b) => ({ ...b, stocks: { ...b.stocks, [t]: stock } }));
        } catch {
          // best-effort — one failed ticker shouldn't block the rest
        }
        done += 1;
        setProgress({ done, total: Object.keys(bundle.stocks).length });
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRefreshing(false);
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input
          placeholder="Search companies…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-neutral-500"
        />
        <button
          onClick={refreshAll}
          disabled={refreshing}
          className="ml-auto text-xs px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500 disabled:opacity-50"
        >
          {refreshing ? `Refreshing ${progress.done}/${progress.total}…` : "Refresh all prices"}
        </button>
        <Link to="/companies" className="text-xs px-3 py-1.5 rounded bg-neutral-100 text-neutral-900 font-medium">
          + Add company
        </Link>
      </div>

      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-neutral-400 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2">Company</th>
              <th className="text-right px-3 py-2">Price</th>
              <th className="text-right px-3 py-2">P/E</th>
              <th className="text-right px-3 py-2">Mkt Cap</th>
              {GRID_CASES.map((c) => (
                <th key={c} className="text-right px-3 py-2" style={{ color: CASE_COLOR[c] }}>
                  {CASE_LABEL[c]}
                </th>
              ))}
              <th className="text-left px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {tickers.map((t) => {
              const stock = bundle.stocks[t];
              const stale = stalenessReason(stock);
              return (
                <tr key={t} className="border-t border-neutral-800 hover:bg-neutral-900/60">
                  <td className="px-3 py-2">
                    <Link to={`/company/${t}`} className="hover:underline">
                      <span className="font-medium">{stock.name}</span>{" "}
                      <span className="text-neutral-500 text-xs">{t}</span>
                    </Link>
                    {stock.owned && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300">Owned</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">₹{fmt(stock.current_price)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(stock.pe_ratio, 1)}x</td>
                  <td className="px-3 py-2 text-right tabular-nums">₹{fmt(stock.market_cap_cr)} Cr</td>
                  {GRID_CASES.map((c) => {
                    const state = getCaseState(bundle.scenarios, stock, bundle.guidance[t] ?? null, t, c);
                    const h = headlineCagr(stock, state);
                    return (
                      <td key={c} className="px-3 py-2 text-right tabular-nums">
                        {h && h.cagr !== null ? (
                          <span className={h.cagr >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtSigned(h.cagr, 1)}</span>
                        ) : (
                          <span className="text-neutral-600">fill PE</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-xs text-amber-500">{stale ?? ""}</td>
                </tr>
              );
            })}
            {tickers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-neutral-500">
                  No companies yet — add one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
