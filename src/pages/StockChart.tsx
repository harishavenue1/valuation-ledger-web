import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError, ChartResponse } from "../lib/api";
import CandlestickChart from "../components/CandlestickChart";
import { Signed, fmtNum } from "../components/ScreenerTable";

// 2026-09-27 ("start with the chart" / "lets build only for the
// stocks we have bought in PF") — an in-app candlestick chart with
// MA50/EMA21 overlays and an RSI14 sub-pane, replacing the out-to-
// TradingView links every screener table currently uses. The backend
// endpoint (api/momentum_screeners.py's chartData) works for any NSE
// symbol — the "only bought stocks" scope is enforced by NOT linking
// here from anywhere except Portfolio Allocation's own rows, not by
// this page itself refusing other tickers.
const RANGES: { key: "6mo" | "1y" | "2y" | "5y"; label: string }[] = [
  { key: "6mo", label: "6M" },
  { key: "1y", label: "1Y" },
  { key: "2y", label: "2Y" },
  { key: "5y", label: "5Y" },
];

export default function StockChart() {
  const { symbol = "" } = useParams();
  const [range, setRange] = useState<"6mo" | "1y" | "2y" | "5y">("2y");
  const [data, setData] = useState<ChartResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .getChartData(symbol, range)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, range]);

  const bars = data?.bars ?? [];
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const dayChangePct = last && prev ? ((last.close - prev.close) / prev.close) * 100 : null;

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-xl font-semibold">📈 {symbol}</h1>
        {last && (
          <>
            <span className="text-lg font-semibold tabular-nums">₹{fmtNum(last.close, 2)}</span>
            <Signed v={dayChangePct} digits={2} />
          </>
        )}
        <div className="ml-auto flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`text-xs px-2.5 py-1 rounded border ${
                range === r.key ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {last && (
        <div className="flex items-center gap-4 text-xs text-slate-500 mb-3">
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1" />
            MA50 {fmtNum(last.ma50, 2)}
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-blue-600 mr-1" />
            EMA21 {fmtNum(last.ema21, 2)}
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-violet-600 mr-1" />
            RSI14 {fmtNum(last.rsi14, 1)}
          </span>
          <span className="ml-auto text-slate-400">as of {last.date}</span>
        </div>
      )}

      {loading && <div className="text-sm text-slate-400 text-center py-16">Loading {symbol}…</div>}
      {!loading && error && <div className="text-sm text-red-600 text-center py-16 border border-red-200 rounded-lg bg-red-50">{error}</div>}
      {!loading && !error && bars.length === 0 && <div className="text-sm text-slate-500 text-center py-16 border border-slate-200 rounded-lg">No chart data for {symbol}.</div>}
      {!loading && !error && bars.length > 0 && (
        <div className="border border-slate-200 rounded-lg p-3">
          <CandlestickChart bars={bars} />
        </div>
      )}

      <p className="text-[10px] text-slate-400 mt-2">
        MA50 = 50-day simple moving average on Close. EMA21 = 21-day exponential moving average on OHLC4 (this account's own standing
        convention). RSI14 = Wilder RSI on Close. Daily bars from Yahoo Finance, fetched fresh on each visit — not cached.
      </p>
    </div>
  );
}
