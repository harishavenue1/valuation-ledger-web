import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError, ChartResponse } from "../lib/api";
import CandlestickChart from "../components/CandlestickChart";
import { Signed, fmtNum } from "../components/ScreenerTable";

// 2026-09-27 ("start with the chart" / "lets build only for the
// stocks we have bought in PF" / "the chart indicator has to be our
// own built") — an in-app WEEKLY candlestick chart overlaying this
// account's own 3 signal systems (quantBollinger, myLongTerm
// InvestingStrategy, SmartMoney — see CandlestickChart.tsx and
// api/momentum_screeners.py's chartData module comments for the full
// port from the user's own Pine Script), replacing the out-to-
// TradingView links every screener table currently uses. The backend
// endpoint works for any NSE symbol — the "only bought stocks" scope
// is enforced by NOT linking here from anywhere except Portfolio
// Allocation's own rows, not by this page itself refusing other
// tickers.
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
  const weekChangePct = last && prev ? ((last.close - prev.close) / prev.close) * 100 : null;

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-xl font-semibold">📈 {symbol}</h1>
        {last && (
          <>
            <span className="text-lg font-semibold tabular-nums">₹{fmtNum(last.close, 2)}</span>
            <Signed v={weekChangePct} digits={2} />
            <span className="text-[10px] text-slate-400">this week</span>
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mb-3">
          <span>
            <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "#d4aa00" }} />
            EMA1 (12W) {fmtNum(last.ema1, 2)}
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "#94a3b8" }} />
            EMA2 (21W) {fmtNum(last.ema2, 2)}
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "#47b027" }} />
            Slow EMA (33W) {fmtNum(last.slow_ema, 2)}
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-sky-500 mr-1" />
            QB Upper {fmtNum(last.qb_upper, 2)}
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-orange-500 mr-1" />
            QB Trail (34W) {fmtNum(last.qb_trail, 2)}
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-violet-600 mr-1" />
            RSI14 {fmtNum(last.rsi14, 1)}
          </span>
          <span className="ml-auto text-slate-400">week ending {last.date}</span>
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

      <p className="text-[10px] text-slate-400 mt-2 leading-relaxed max-w-3xl">
        Weekly bars, ported line-for-line from this account's own "EMAs+Buy+Sell+SmartMoney" Pine Script — 3 systems, not generic
        indicators. <b>EMA1/EMA2/Slow EMA</b> (12W/21W/33W on OHLC4) are myLongTermInvestingStrategy's own ribbon — 🔽 aqua "LTIS" marker
        when close is above all three AND weekly RSI &gt; 66 (fresh cross only), ✕ orange when close crosses below the slow EMA.{" "}
        <b>QB Upper/QB Trail</b> are quantBollinger's 55W-SMA+3.7σ band and 34W EMA trail — 🔼 lime "QB" marker on a weekly close breaking
        above the band, 🔽 red "QB" on a weekly close breaking below the trail. <b>SM Entry/SM Sell/SM Close</b> are SmartMoney (Vivek
        Equity Tool) — an EMA(10)/EMA(20) vs SMA(40) trend inside a Wilder-ATR(40)×0.618 neutral channel, driving a state machine carried
        bar-to-bar. Fetched fresh from Yahoo Finance on each visit — not cached.
      </p>
    </div>
  );
}
