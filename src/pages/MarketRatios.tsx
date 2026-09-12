import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import RunButton from "../components/RunButton";
import { Col, GenericTable, MethodologyNote, Signed } from "../components/ScreenerTable";

// Added 2026-09-12 ("take the ratios details and move to new page, add
// Midcap/Nifty50, SmallCap/Nifty50, Gold/Nifty50") — split out of
// Strategic Alpha's own "Nifty 500 / Nifty 50 ratio" row, which used
// to be a single row buried at the bottom of that table. This page
// gives relative-strength ratios their own home and adds three more
// pairs. See api/momentum_screeners.py's SA_RATIO_UNIVERSE / marketRatios
// / _run_market_ratios for the calculation — each ratio is treated as
// its own synthetic price series and run through the exact same
// 200D-EMA trend / %-vs-EMA / trailing-return logic every other
// Strategic Alpha asset uses (_sa_trend_row, reused unchanged).
const COLS: Col[] = [
  { key: "asset", label: "Ratio", align: "left" },
  { key: "close", label: "Value", render: (r) => (r.close != null ? r.close.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—") },
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

export default function MarketRatios() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const entry = bundle.momentum_screeners["marketRatios"];

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">📐 Market Ratios</h1>
        <span className="ml-auto">
          <RunButton screener="marketRatios" />
        </span>
      </div>
      {entry?.as_of && <div className="text-xs text-slate-400 mb-2">as of {entry.as_of}</div>}
      <p className="text-xs text-slate-500 mb-4">
        Relative-strength ratios — a rising ratio means the numerator is outperforming the denominator, i.e. leadership is in the
        numerator's segment. Split out of Strategic Alpha's own ratio row and expanded to four pairs — refreshes daily on Vercel.
      </p>
      <MethodologyNote>
        Each ratio (numerator Close ÷ denominator Close) is treated as its own synthetic price series and run through the exact same
        trend logic as every other Strategic Alpha asset: <b>Bull</b> if the ratio's latest close is above its own 200-day EMA (rising
        ratio, numerator leading), <b>Bear</b> otherwise. The three <b>% vs EMA</b> columns (200-day, 50-day, 33-week) show only the
        percentage distance from each line — the 50D/33W EMAs are computed as if the ratio's Open/High/Low all equal its Close (a ratio
        of closing prices has no real intraday range), which is a reasonable approximation, not real OHLC data. <b>1D/1W/1M/3M/6M/1Y %</b>{" "}
        are plain trailing returns on the ratio itself. <b>Nifty 500 / Nifty 50</b> is the video's own original rule (rising = broader
        market leading, opportunities outside large-caps); <b>Nifty Midcap 150 / Nifty 50</b> and <b>Nifty Smallcap 250 / Nifty 50</b>{" "}
        extend the same idea down the cap curve; <b>Gold / Nifty 50</b> tracks the classic risk-off/risk-on rotation between gold and
        Indian equities. No row here has a chart link (a ratio isn't a single tradable symbol) or a "current price" in any real sense —
        the <b>Value</b> column is just the raw ratio number, useful only for its own trend, not compared across rows.
      </MethodologyNote>
      <GenericTable
        rows={entry?.rows ?? []}
        cols={COLS}
        navigate={(t) => navigate(`/company/${t}`)}
        emptyMessage="No Market Ratios data yet — click Run now above."
      />
    </div>
  );
}
