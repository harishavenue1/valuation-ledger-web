import { useState } from "react";
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
// requested tickers had no fetchable Yahoo data (Nifty Microcap 250 —
// added back 2026-09-13 once a different ticker format turned up, see
// that dict entry's own caveat) or collapsed onto an existing row
// (GOLDM1!/"GOLD US$/OZ" and
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
  const allRows = entry?.rows ?? [];
  // Added 2026-09-13 ("split strategic page to india and international
  // tickets") — every asset in api/momentum_screeners.py's
  // SA_ASSET_UNIVERSE is tagged with its own "region" field ("India" or
  // "International"); this just filters the SAME single dataset by
  // that tag, same toggle-button pattern Reverse DCF Scan already uses
  // for its ledger/NSE 750 sources — no separate fetch, no separate
  // as_of, all views always refresh together. Grew a third tab the
  // same day ("merge the strategic and ratios page under strategic") —
  // the standalone Market Ratios page/screener (added earlier the same
  // day) was folded back into this same strategicAlpha screener,
  // tagged region="Ratios", rather than staying a separate page.
  // Grew a fourth tab the same day — "Factor Rotation"
  // (Momentum50/Alpha50/MulticapMomentumQuality50/Value50), the family
  // v1's own module comment explicitly deferred ("no direct Yahoo
  // ticker found for any of the three"). Re-checked live: some of
  // these DO have a real ticker after all (see SA_ASSET_UNIVERSE's own
  // note for which are raw indices vs. real tracking ETFs).
  const [region, setRegion] = useState<"india" | "international" | "ratios" | "factor">("india");
  const indiaRows = allRows.filter((r: any) => r.region === "India");
  const internationalRows = allRows.filter((r: any) => r.region === "International");
  const ratiosRows = allRows.filter((r: any) => r.region === "Ratios");
  const factorRows = allRows.filter((r: any) => r.region === "Factor");
  const rows = region === "india" ? indiaRows : region === "international" ? internationalRows : region === "ratios" ? ratiosRows : factorRows;

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

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setRegion("india")}
          className={`text-xs px-3 py-1.5 rounded border ${region === "india" ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}
        >
          🇮🇳 India ({indiaRows.length})
        </button>
        <button
          onClick={() => setRegion("international")}
          className={`text-xs px-3 py-1.5 rounded border ${region === "international" ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}
        >
          🌍 International ({internationalRows.length})
        </button>
        <button
          onClick={() => setRegion("ratios")}
          className={`text-xs px-3 py-1.5 rounded border ${region === "ratios" ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}
        >
          📐 Ratios ({ratiosRows.length})
        </button>
        <button
          onClick={() => setRegion("factor")}
          className={`text-xs px-3 py-1.5 rounded border ${region === "factor" ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}
        >
          🏭 Factor ({factorRows.length})
        </button>
      </div>

      <MethodologyNote>
        The <b>🇮🇳 India</b>/<b>🌍 International</b>/<b>📐 Ratios</b>/<b>🏭 Factor</b> toggle above splits the same single dataset four ways
        — all refresh together on the same daily run, just filtered by which bucket each asset belongs to. <b>🏭 Factor</b> is the "Factor
        Rotation" family the video's own framework calls for — v1 originally left this out entirely ("no direct Yahoo ticker found for any
        of the three"), re-checked 2026-09-13 and every one of them turned out to have a real ticker after all: <b>Nifty Alpha 50</b>,{" "}
        <b>Nifty500 Momentum 50</b>, <b>Nifty500 Value 50</b>, and <b>Nifty500 Quality 50</b> have real raw index tickers (the latter three
        confirmed live via the user's own TradingView screenshots showing each exact NSE-native symbol actually quoted); <b>Nifty500
        Multicap Momentum Quality 50</b> has no raw index ticker but DOES have a real, actually-traded ETF tracking it, used as the proxy
        (same precedent GOLDCASE/SILVERCASE already set for gold/silver). <b>📐 Ratios</b> is relative-strength ratios (numerator Close ÷
        denominator Close, treated as its own synthetic price series run through the exact same trend logic as every other row):{" "}
        <b>Nifty 500 / Nifty 50</b> is the video's own original rule (rising = broader market leading, opportunities outside large-caps);{" "}
        <b>Nifty Midcap 150 / Nifty 50</b> and <b>Nifty Smallcap 250 / Nifty 50</b> extend the same idea down the cap curve;{" "}
        <b>Gold / Nifty 50</b> tracks the classic risk-off/risk-on rotation between gold and Indian equities; <b>Nifty Smallcap 250 / Nifty
        500</b>, <b>Nifty500 Momentum 50 / Nifty 500</b>, <b>Nifty500 Value 50 / Nifty 500</b>, <b>Nifty500 Quality 50 / Nifty 500</b>, and{" "}
        <b>Nifty Microcap 250 / Nifty 500</b> (CNX names in the old pre-rebrand NSE convention where requested) all measure a segment or
        factor sleeve against the broad market instead of large-caps specifically; <b>Silver / Gold</b> is the classic precious-metals ratio
        (rising = silver outperforming gold, a risk-on/industrial-demand read). Ratio rows have no chart link
        (a ratio isn't a single tradable symbol) and their 50D/33W EMAs are computed as if Open/High/Low all equal Close (a ratio of closing
        prices has no real intraday range) — a reasonable approximation, not real OHLC data. Each asset's trend is <b>Bull</b> if its latest
        daily close is above its own 200-day EMA (on Close, replicating the video's stated rule
        literally — not this app's own OHLC4 standing convention), <b>Bear</b> otherwise. The three <b>% vs EMA</b> columns show only the
        percentage distance from each line (200-day, 50-day, 33-week), not the EMA's own price level — the 50D/33W pair is this app's own
        addition on top of the video's framework (33-week matching myLongTermInvestingStrategy's own exit-rule EMA), both computed on OHLC4
        per this app's standing convention, so they're not directly comparable to the 200D EMA's Close-only basis. <b>1D/1W/1M/3M/6M/1Y %</b>{" "}
        are plain trailing returns as of the last close, same calculation globalCountryEtfs/globalCurrencies already use. Every row's{" "}
        <b>Close</b> price is itself the TradingView link.{" "}
        <b>Gold</b>/<b>Silver</b> here are raw COMEX USD futures (GC=F/SI=F) — the global USD view, unchanged. <b>Gold (INR, ~MCX GOLD1!)</b>
        /<b>Silver (INR, ~MCX SILVER1!)</b> are added 2026-09-13: real MCX futures data is only reachable via Kite, which only works from an
        interactive Claude session (same limit as Portfolio Allocation) — no good for a page that refreshes on an unattended daily cron. So
        these are DERIVED instead: the same COMEX USD price converted to INR at the daily USDINR rate (per 10g for gold, per kg for silver,
        India's own quoting convention), plus a flat India markup (import duty + GST + local exchange premium combined) — empirically
        calibrated against live MCX quotes on 2026-09-13, +12.63% for gold and +17.16% for silver (the two differ, not one shared markup).
        The pure conversion alone lands noticeably below the real MCX print even with a correct exchange rate — confirmed live that the
        implied USDINR the raw formula used (~95.7) was itself a plausible real rate, so the gap was genuinely duty/premium, not a bad fetch.
        This is a fixed, point-in-time calibration, not a formula that self-corrects if the real duty/premium drifts over time. Their Close
        cell links to the real MCX chart on TradingView even though the price shown is the derived-and-calibrated approximation.
        <b>Nifty Microcap 250</b> and <b>Nifty MidSmallcap 400</b> were added 2026-09-13; Microcap 250 had no fetchable Yahoo ticker when first
        requested (several formats tried, all 404) — a different one turned up since, confirmed live via the user's own TradingView
        screenshot. <b>Not built</b>: Market Breadth (% of NSE stocks above their 30-week MA), and "country rotation" (the video itself calls
        this an undisclosed proprietary system).
      </MethodologyNote>
      <GenericTable
        rows={rows}
        cols={COLS}
        navigate={(t) => navigate(`/company/${t}`)}
        emptyMessage="No Strategic Alpha data yet — click Run now above."
      />
    </div>
  );
}
