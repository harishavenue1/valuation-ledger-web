import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useData, useScreeners } from "../App";
import { api, ApiError, ChartResponse } from "../lib/api";
import CandlestickChart from "../components/CandlestickChart";
import { Signed, fmtNum } from "../components/ScreenerTable";

// 2026-09-27 ("lets have dedicated page for charts with all my
// holdings on the list, with just a up and down the stocks chart
// should load the company chart and default to our indicator and
// weekly timeframe, also make chart full screen") — replaces the
// plain single-stock /chart/:symbol page (folded in here, that route
// is gone) with a proper workspace: every holding in a side list,
// ArrowUp/ArrowDown to move through them, the chart itself using the
// page's full width instead of a narrow centered column. Weekly
// timeframe + this account's own 3 signal systems (quantBollinger/
// myLongTermInvestingStrategy/SmartMoney) is the ONLY mode this chart
// has — see CandlestickChart.tsx and api/momentum_screeners.py's
// chartData module comment — so "default to" is automatic, not a
// toggle.
const RANGES: { key: "6mo" | "1y" | "2y" | "5y"; label: string }[] = [
  { key: "6mo", label: "6M" },
  { key: "1y", label: "1Y" },
  { key: "2y", label: "2Y" },
  { key: "5y", label: "5Y" },
];

export default function PortfolioCharts() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const { symbol = "" } = useParams();
  const { ready: holdingsReady } = useScreeners(["portfolioAllocation"]);

  const holdings = useMemo(() => {
    const rows = bundle.momentum_screeners.portfolioAllocation?.rows ?? [];
    const seen = new Set<string>();
    const out: { symbol: string; pct_of_portfolio: number; pnl_pct: number | null }[] = [];
    for (const r of rows) {
      if (!r.symbol || seen.has(r.symbol)) continue;
      seen.add(r.symbol);
      out.push({ symbol: r.symbol, pct_of_portfolio: r.pct_of_portfolio ?? 0, pnl_pct: r.pnl_pct ?? null });
    }
    out.sort((a, b) => b.pct_of_portfolio - a.pct_of_portfolio);
    return out;
  }, [bundle.momentum_screeners.portfolioAllocation]);

  const currentIndex = holdings.findIndex((h) => h.symbol === symbol);

  // No symbol in the URL yet (first visit to /portfolio-charts), or an
  // unrecognized one — land on the top holding by allocation weight.
  // `replace: true` so this doesn't spam browser history.
  useEffect(() => {
    if (holdingsReady && holdings.length > 0 && currentIndex === -1) {
      navigate(`/portfolio-charts/${encodeURIComponent(holdings[0].symbol)}`, { replace: true });
    }
  }, [holdingsReady, holdings, currentIndex, navigate]);

  // ArrowUp/ArrowDown move to the previous/next holding — clamped, not
  // wrapping, at the list's ends. Ignored while typing in an input (the
  // range buttons and sidebar are plain buttons/links, not inputs, but
  // this guard is a cheap, standard precaution).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (holdings.length === 0 || currentIndex === -1) return;
      if (e.key === "ArrowUp" && currentIndex > 0) {
        e.preventDefault();
        navigate(`/portfolio-charts/${encodeURIComponent(holdings[currentIndex - 1].symbol)}`);
      } else if (e.key === "ArrowDown" && currentIndex < holdings.length - 1) {
        e.preventDefault();
        navigate(`/portfolio-charts/${encodeURIComponent(holdings[currentIndex + 1].symbol)}`);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [holdings, currentIndex, navigate]);

  const [range, setRange] = useState<"6mo" | "1y" | "2y" | "5y">("2y");
  const [data, setData] = useState<ChartResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!symbol) return;
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

  if (!holdingsReady) return <div className="text-sm text-slate-400 text-center py-16">Loading holdings…</div>;
  if (holdings.length === 0) {
    return (
      <div className="text-sm text-slate-500 text-center py-16 border border-slate-200 rounded-lg">
        No portfolio holdings yet — run the PortfolioAllocation skill first.
      </div>
    );
  }

  return (
    <div className="flex gap-4" style={{ height: "calc(100vh - 130px)" }}>
      <div className="w-52 shrink-0 overflow-y-auto border border-slate-200 rounded-lg">
        <div className="sticky top-0 bg-slate-50 text-[10px] text-slate-400 px-2 py-1.5 border-b border-slate-200">
          {holdings.length} holdings · ↑↓ to browse
        </div>
        {holdings.map((h) => (
          <button
            key={h.symbol}
            onClick={() => navigate(`/portfolio-charts/${encodeURIComponent(h.symbol)}`)}
            className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-left border-b border-slate-100 ${
              h.symbol === symbol ? "bg-indigo-50 text-indigo-700 font-semibold" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span className="truncate">{h.symbol}</span>
            <span className="tabular-nums text-slate-400 shrink-0">{fmtNum(h.pct_of_portfolio, 1)}%</span>
          </button>
        ))}
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto">
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
            <CandlestickChart bars={bars} height={560} />
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
    </div>
  );
}
