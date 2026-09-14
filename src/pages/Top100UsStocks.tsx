import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import RunButton from "../components/RunButton";
import { Col, GenericTable, MethodologyNote, Signed } from "../components/ScreenerTable";

// Added 2026-09-14 — "add a new page for top 100 US Stocks, replicate
// and one more col with alpha over Nasdaq 100", from a screenshot of
// this app's own Strategic Alpha table (Close / 1D-1W-1M-3M-6M-1Y % /
// % vs 200D-50D-33W EMA / Trend). Same table shape, same COLS pattern
// as StrategicAlpha.tsx (that page's own module comment has the full
// background on what each column means) — just a fixed 100-US-stock
// universe (api/momentum_screeners.py's TOP100_US_STOCKS, a hand-picked
// snapshot of large-caps, not a live index-membership fetch) instead of
// India/global indices, plus one extra column: Alpha vs Nasdaq 100.
const COLS: Col[] = [
  { key: "asset", label: "Company", align: "left" },
  { key: "symbol", label: "Ticker", align: "left" },
  {
    key: "close",
    label: "Close",
    render: (r) => {
      const text = r.close != null ? r.close.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";
      return r.tradingview_url ? (
        <a href={r.tradingview_url} target="_blank" rel="noreferrer" className="text-indigo-600 underline whitespace-nowrap">
          {text}
        </a>
      ) : (
        text
      );
    },
  },
  { key: "r_1d", label: "1D %", render: (r) => <Signed v={r.r_1d} digits={2} /> },
  { key: "r_1w", label: "1W %", render: (r) => <Signed v={r.r_1w} digits={2} /> },
  { key: "r_1m", label: "1M %", render: (r) => <Signed v={r.r_1m} digits={2} /> },
  { key: "r_3m", label: "3M %", render: (r) => <Signed v={r.r_3m} digits={2} /> },
  { key: "r_6m", label: "6M %", render: (r) => <Signed v={r.r_6m} digits={2} /> },
  { key: "r_1y", label: "1Y %", render: (r) => <Signed v={r.r_1y} digits={2} /> },
  { key: "pct_above_ema200", label: "% vs 200D EMA", render: (r) => <Signed v={r.pct_above_ema200} digits={2} /> },
  { key: "pct_vs_ema50d", label: "% vs 50D EMA", render: (r) => <Signed v={r.pct_vs_ema50d} digits={2} /> },
  { key: "pct_vs_ema33w", label: "% vs 33W EMA", render: (r) => <Signed v={r.pct_vs_ema33w} digits={2} /> },
  {
    // The "one more col" asked for — stock's own 1Y % return minus
    // Nasdaq 100's (^NDX) 1Y % return, same convention Global Country
    // ETFs' own alpha_1y column already uses (just a different
    // benchmark). Right before Trend, same position StrategicAlpha's
    // own columns settle into (comparison metrics before the final
    // Bull/Bear tag).
    key: "alpha_1y",
    label: "Alpha vs Nasdaq 100 (1Y)",
    render: (r) => <Signed v={r.alpha_1y} digits={2} />,
  },
  {
    key: "trend",
    label: "Trend",
    render: (r) =>
      r.trend === "Bull" || r.trend === "Bear" ? (
        <span
          className={`text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${
            r.trend === "Bull" ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-red-50 text-red-600 border-red-300"
          }`}
        >
          {r.trend}
        </span>
      ) : (
        <span className="text-xs text-slate-600">{r.trend ?? "—"}</span>
      ),
  },
];

export default function Top100UsStocks() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const entry = bundle.momentum_screeners["top100UsStocks"];
  const rows = entry?.rows ?? [];

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">🇺🇸 Top 100 US Stocks</h1>
        <span className="ml-auto">
          <RunButton screener="top100UsStocks" />
        </span>
      </div>
      {entry?.as_of && <div className="text-xs text-slate-400 mb-2">as of {entry.as_of}</div>}
      <p className="text-xs text-slate-500 mb-4">
        Same trend/return table as{" "}
        <a href="/strategic-alpha" className="underline">
          Strategic Alpha
        </a>{" "}
        — Close, trailing returns, and % distance from the 200D/50D/33W EMAs — applied to a fixed 100-stock US
        large-cap universe, plus each stock's own alpha vs the Nasdaq 100. Refreshes daily on Vercel.
      </p>

      <MethodologyNote>
        The 100-stock universe (api/momentum_screeners.py's <code>TOP100_US_STOCKS</code>) is a hand-picked snapshot
        of well-known US mega/large-caps, roughly the S&amp;P 100 — not a live index-membership fetch, so it won't
        automatically track real constituent changes over time. Each row's <b>NYSE</b>/<b>NASDAQ</b> exchange tag
        (used for the TradingView link) is best-effort, not individually verified per ticker — if one turns out to
        be mislisted, that's a one-off fix, same precedent Global Country ETFs/Strategic Alpha already set for
        themselves. <b>Close/1D/1W/1M/3M/6M/1Y %</b> and the three <b>% vs EMA</b> columns are computed exactly like
        Strategic Alpha's own table (200-day EMA on Close; 50-day/33-week on OHLC4, this app's own standing
        convention) — see that page's own methodology note for the full detail on each. <b>Alpha vs Nasdaq 100
        (1Y)</b> is the one addition here: each stock's own trailing 1-year return minus the Nasdaq 100 index's
        (^NDX) trailing 1-year return over the same window — the same stock-minus-benchmark convention Global
        Country ETFs' own alpha_1y column already uses, just a different benchmark. <b>Trend</b> is Bull if the
        latest close is above its own 200-day EMA, Bear otherwise.
      </MethodologyNote>
      <GenericTable
        rows={rows}
        cols={COLS}
        navigate={(t) => navigate(`/company/${t}`)}
        emptyMessage="No Top 100 US Stocks data yet — click Run now above."
      />
    </div>
  );
}
