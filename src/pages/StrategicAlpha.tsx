import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import RunButton from "../components/RunButton";
import { Col, GenericTable, MethodologyNote, Signed } from "../components/ScreenerTable";

// Added 2026-09-06 — "one more page to be built as a strategic alpha
// summary" (https://www.youtube.com/watch?v=r6BYKayOaIQ, channel
// "Strategic Alpha" / Suyog Dhavan's weekly "Community Connect"
// format). v1 ships the REPEATABLE structural framework the video
// tracks every week, confirmed ticker-by-ticker against live Yahoo
// data before shipping (same standard as every other tab): Nifty 50 &
// Nifty 500 vs their own 200-day EMA, the Nifty 500/Nifty 50 ratio
// trend (the video's own stated rule), Dollar Index, Bitcoin, a broad
// commodity index proxy, and Gold/Silver (COMEX, USD — see
// Portfolio Allocation for the INR-adjusted MCX proxy of the same
// two). Deliberately NOT built in v1 (user's own scope choice,
// "Ship v1 with what's verified now"): Factor Rotation (Nifty500
// Momentum50/Value50/Quality50 — no direct Yahoo ticker found for any
// of the three), Market Breadth (% of NSE stocks above their own
// 30-week MA — a bigger lift, needs a full universe fetch), exact
// MidSmallcap400/Microcap250 indices (no matching ticker found), and
// "country rotation" (the video itself calls this a proprietary,
// undisclosed system — not reproducible here). Granular one-off sector
// calls and specific price-level targets from any single episode are
// out of scope by design — this page tracks the recurring rules, not
// that week's picks.
const COLS: Col[] = [
  { key: "asset", label: "Asset", align: "left" },
  { key: "close", label: "Close", render: (r) => (r.close != null ? r.close.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—") },
  { key: "ema200", label: "200D EMA", render: (r) => (r.ema200 != null ? r.ema200.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—") },
  { key: "pct_above_ema200", label: "% vs EMA200", render: (r) => <Signed v={r.pct_above_ema200} digits={2} /> },
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
  { key: "as_of", label: "As of", align: "left" },
];

export default function StrategicAlpha() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const entry = bundle.momentum_screeners["strategicAlpha"];

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">📡 Strategic Alpha Summary</h1>
        <span className="ml-auto">
          <RunButton screener="strategicAlpha" />
        </span>
      </div>
      {entry?.as_of && <div className="text-xs text-slate-400 mb-2">as of {entry.as_of}</div>}
      <p className="text-xs text-slate-500 mb-4">
        Weekly market-regime panel, modeled on the{" "}
        <a href="https://www.youtube.com/watch?v=r6BYKayOaIQ" target="_blank" rel="noreferrer" className="underline">
          Strategic Alpha
        </a>{" "}
        channel's own recurring framework — refreshes daily on Vercel.
      </p>
      <MethodologyNote>
        Each asset's trend is <b>Bull</b> if its latest daily close is above its own 200-day EMA (on Close, replicating the video's stated rule
        literally — not this app's own OHLC4 standing convention, which only applies to screens this app invented itself), <b>Bear</b>
        otherwise. The <b>Nifty 500 / Nifty 50 ratio</b> row applies the video's own stated rule: a rising ratio means Nifty 500 is
        outperforming Nifty 50, i.e. opportunities lie in the broader market rather than large-caps — its "% vs EMA200" column is repurposed to
        show the ratio's own change over the last ~20 trading days, and it has no EMA200 (shown as "—"). Gold/Silver here are raw COMEX USD
        futures (GC=F/SI=F); see <b>Portfolio Allocation</b> for the INR-adjusted MCX-equivalent version of the same two. <b>Not built in v1</b>{" "}
        (ship-now scope): Factor Rotation (Momentum50/Value50/Quality50 — no matching Yahoo ticker found), Market Breadth (% of NSE stocks
        above their 30-week MA), exact MidSmallcap400/Microcap250 indices, and "country rotation" (the video itself calls this an undisclosed
        proprietary system).
      </MethodologyNote>
      <GenericTable
        rows={entry?.rows ?? []}
        cols={COLS}
        navigate={(t) => navigate(`/company/${t}`)}
        emptyMessage="No Strategic Alpha data yet — click Run now above."
      />
    </div>
  );
}
