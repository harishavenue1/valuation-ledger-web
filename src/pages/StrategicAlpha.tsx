import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import RunButton from "../components/RunButton";
import { Col, GenericTable, MethodologyNote, Signed } from "../components/ScreenerTable";

// Added 2026-09-06 — "one more page to be built as a strategic alpha
// summary" (https://www.youtube.com/watch?v=r6BYKayOaIQ, channel
// "Strategic Alpha" / Suyog Dhavan's weekly "Community Connect"
// format). v1 shipped the REPEATABLE structural framework the video
// tracks every week: Nifty 50 & Nifty 500 vs their own 200-day EMA,
// the Nifty 500/Nifty 50 ratio trend (the video's own stated rule),
// Dollar Index, Bitcoin, and a broad commodity index proxy.
// Deliberately NOT built (user's own scope choice, "Ship v1 with
// what's verified now"): Factor Rotation (Nifty500 Momentum50/
// Value50/Quality50 — no direct Yahoo ticker found for any of the
// three), Market Breadth (% of NSE stocks above their own 30-week MA —
// a bigger lift, needs a full universe fetch), and "country rotation"
// (the video itself calls this a proprietary, undisclosed system — not
// reproducible here). Granular one-off sector calls and specific
// price-level targets from any single episode are out of scope by
// design — this page tracks the recurring rules, not that week's picks.
//
// Expanded 2026-09-11 ("add below tickers... give tradingview link to
// all with new col 50DEMA, 33WEMA") — broad-market-cap-segment indices
// (Smallcap 250, Midcap 150), Nasdaq 100, KOSPI, a metals/miners
// cluster (Copper/Gold/Silver futures, GOLDCASE/SILVERCASE, and the
// GDX/SIL/COPX miner ETFs), plus a TradingView chart link and 50-day/
// 33-week EMA columns on every row. See the module comment above
// api/momentum_screeners.py's SA_ASSET_UNIVERSE for exactly which
// requested tickers had no fetchable Yahoo data (Nifty Microcap 250)
// or collapsed onto an existing row (GOLDM1!/"GOLD US$/OZ" and
// SILVER1!/"SILVER US$/OZ" — no MCX or literal spot feed is fetchable
// from here, so those are the SAME COMEX-proxy numbers this page's
// existing Gold/Silver rows already show, just linked via TradingView
// instead of duplicated as their own rows).
const COLS: Col[] = [
  { key: "asset", label: "Asset", align: "left" },
  {
    // 2026-09-11 ("give tradingview to close price itself so column is
    // saved") — the Close cell IS the TradingView link now, freeing up
    // the dedicated Chart column below.
    key: "close",
    label: "Close",
    render: (r) => {
      const text = r.close != null ? r.close.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—";
      return r.tradingview_url ? (
        <a href={r.tradingview_url} target="_blank" rel="noreferrer" className="text-indigo-600 underline whitespace-nowrap">
          {text}
        </a>
      ) : (
        text
      );
    },
  },
  // 2026-09-12 ("remove the column as of, all should be changed on
  // same date of refresh, also no need to mention actual value of
  // 200DEMA, 50DEMA and 33EMA.. and add the change over 1D, 1W, 1M,
  // 3M, 6M, 1Y") — dropped As of (the page-level "as of" banner below
  // already covers this — every row refreshes together) and the raw
  // EMA price levels (only the % distance is useful for scanning).
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
    // 2026-09-11 ("move trend to last column") — was originally right
    // after % vs EMA200; moved to the very end of the table.
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
        literally — not this app's own OHLC4 standing convention), <b>Bear</b> otherwise. The three <b>% vs EMA</b> columns show only the
        percentage distance from each line (200-day, 50-day, 33-week), not the EMA's own price level — the 50D/33W pair is this app's own
        addition on top of the video's framework (33-week matching myLongTermInvestingStrategy's own exit-rule EMA), both computed on OHLC4
        per this app's standing convention, so they're not directly comparable to the 200D EMA's Close-only basis. <b>1D/1W/1M/3M/6M/1Y %</b>{" "}
        are plain trailing returns as of the last close, same calculation globalCountryEtfs/globalCurrencies already use. The{" "}
        <b>Nifty 500 / Nifty 50 ratio</b> row applies the video's own stated rule: a rising ratio means Nifty 500 is outperforming Nifty 50,
        i.e. opportunities lie in the broader market rather than large-caps — it's a derived ratio, not a single tradable symbol, so it has no
        EMA, return columns, or chart link (its Close cell isn't clickable), and its "% vs 200D EMA" column is repurposed to show the ratio's
        own change over the last ~20 trading days. Every other row's <b>Close</b> price is itself the TradingView link.{" "}
        <b>Gold</b>/<b>Silver</b> here are raw COMEX USD futures (GC=F/SI=F) — no MCX or literal spot feed is fetchable from here, so these
        same numbers also stand in for the requested GOLDM1!/SILVER1!/"GOLD US$/OZ"/"SILVER US$/OZ" tickers (their Close cell links to the
        actual MCX contracts on TradingView, even though the price data shown is the COMEX proxy); see <b>Portfolio Allocation</b> for the
        INR-adjusted version of the same two. <b>Nifty Microcap 250</b> was requested but has no fetchable Yahoo ticker (several tried) so
        it's left out rather than faked with a rough stand-in — same principle as everything below. <b>Not built</b>: Factor Rotation
        (Momentum50/Value50/Quality50 — no matching Yahoo ticker found), Market Breadth (% of NSE stocks above their 30-week MA), and "country
        rotation" (the video itself calls this an undisclosed proprietary system).
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
