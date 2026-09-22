import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData, useScreeners } from "../App";
import RunButton from "../components/RunButton";
import { Col, GenericTable, MethodologyNote, ScreenerLoading, Signed } from "../components/ScreenerTable";

// 2026-09-22 ("add a chart of gold against nifty50... also gold
// against interest rates") — dataviz skill's validated reference
// palette, same instance PortfolioAllocation's own donut chart already
// uses (SECTOR_COLORS there) — kept consistent across the app rather
// than picking new hex values per chart.
const CHART_BLUE = "#2a78d6";
const CHART_ORANGE = "#eb6834";

interface ChartPoint {
  date: string; // ISO, e.g. "2016-09-25"
  value: number;
}

// Plain SVG line chart — same "no charting library in this app's
// dependency tree" precedent as PortfolioAllocation's SectorDonut.
// Handles 1-2 series on ONE shared y-axis (only ever called with
// comparable-unit series — indexed-to-100 growth, or a single price/
// yield series — never two different units on the same instance; see
// the "one axis" rule in the dataviz skill). Hover shows a crosshair +
// tooltip (nearest point by x), matching the skill's interaction spec
// for line charts.
function TimeSeriesChart({
  series,
  height = 220,
  yFormat = (v: number) => v.toFixed(0),
  yLabel,
}: {
  series: { label: string; color: string; points: ChartPoint[] }[];
  height?: number;
  yFormat?: (v: number) => string;
  yLabel?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 900;
  const padLeft = 52;
  const padRight = 12;
  // Extra top padding when yLabel is present — otherwise its text
  // collides with the topmost gridline's own tick value, both sitting
  // right at the plot's top edge.
  const padTop = yLabel ? 30 : 12;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const allPoints = series[0]?.points ?? [];
  const n = allPoints.length;
  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const yMin = Math.min(...allValues);
  const yMax = Math.max(...allValues);
  const yPad = (yMax - yMin) * 0.08 || 1;
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;

  function xAt(i: number) {
    return padLeft + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  }
  function yAt(v: number) {
    return padTop + plotH - ((v - yLo) / (yHi - yLo)) * plotH;
  }

  function handleMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const frac = Math.min(1, Math.max(0, (px * (width / rect.width) - padLeft) / plotW));
    const idx = Math.round(frac * (n - 1));
    setHoverIdx(Math.min(n - 1, Math.max(0, idx)));
  }

  // 4 evenly-spaced y gridlines + labels — recessive per the dataviz
  // skill's mark spec (hairline gray, not full chart borders).
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => yLo + f * (yHi - yLo));
  // Sparse x-axis labels (start/mid/end) — 523 weekly points is too
  // dense for a label per tick.
  const xTickIdxs = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : [0];

  const hp = hoverIdx !== null ? allPoints[hoverIdx] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block" }}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padLeft} x2={width - padRight} y1={yAt(t)} y2={yAt(t)} stroke="#e1e0d9" strokeWidth={1} />
            <text x={padLeft - 6} y={yAt(t) + 3} textAnchor="end" className="fill-slate-400" style={{ fontSize: 9 }}>
              {yFormat(t)}
            </text>
          </g>
        ))}
        {xTickIdxs.map((i) => (
          <text key={i} x={xAt(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-slate-400" style={{ fontSize: 9 }}>
            {allPoints[i]?.date.slice(0, 7)}
          </text>
        ))}
        {yLabel && (
          <text x={2} y={10} className="fill-slate-400" style={{ fontSize: 9 }}>
            {yLabel}
          </text>
        )}
        {series.map((s) => {
          const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(p.value)}`).join(" ");
          return <path key={s.label} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />;
        })}
        {hoverIdx !== null && (
          <line x1={xAt(hoverIdx)} x2={xAt(hoverIdx)} y1={padTop} y2={padTop + plotH} stroke="#898781" strokeWidth={1} strokeDasharray="3,3" />
        )}
        {hoverIdx !== null &&
          series.map((s) => <circle key={s.label} cx={xAt(hoverIdx)} cy={yAt(s.points[hoverIdx].value)} r={3.5} fill={s.color} stroke="#fcfcfb" strokeWidth={1.5} />)}
        <rect x={padLeft} y={padTop} width={plotW} height={plotH} fill="transparent" onMouseMove={handleMove} onMouseLeave={() => setHoverIdx(null)} style={{ cursor: "crosshair" }} />
      </svg>
      {hp && (
        <div
          className="absolute top-1 pointer-events-none bg-white border border-slate-200 rounded shadow-sm px-2 py-1 text-[10px] leading-tight"
          style={{ left: `${Math.min(78, Math.max(12, (xAt(hoverIdx!) / width) * 100))}%` }}
        >
          <div className="text-slate-400">{hp.date}</div>
          {series.map((s) => (
            <div key={s.label} className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.color }} />
              <span className="text-slate-600">{s.label}:</span>
              <span className="font-medium tabular-nums">{yFormat(s.points[hoverIdx!].value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex gap-4 text-[11px] text-slate-600 mb-1">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

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
  // 2026-09-14 ("add column to show ticker names") — the raw ticker
  // string each row's Close/chart link is actually built from (r.symbol,
  // same field _sa_trend_row already sets — "—" for the Ratios tab's
  // synthetic numerator/denominator rows, which have no single real
  // ticker). Shown as-is, Yahoo-style suffixes included (.NS/^prefix),
  // same convention Top 100 US Stocks' own Ticker column already uses.
  { key: "symbol", label: "Ticker", align: "left" },
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
  const { ready } = useScreeners(["strategicAlpha", "countryYields", "goldVsBenchmarks"]);
  const entry = bundle.momentum_screeners["strategicAlpha"];
  // 2026-09-22 — weekly Gold(USD)/Nifty50/US10Y-yield history for the
  // two new charts below. Indexing Gold/Nifty to 100 at the first
  // shared date happens here (not server-side) so it's always relative
  // to whatever window actually rendered, not a fixed base date baked
  // into the stored data.
  const goldHistRows: any[] = bundle.momentum_screeners["goldVsBenchmarks"]?.rows ?? [];
  const goldNiftyChart = useMemo(() => {
    const valid = goldHistRows.filter((r) => r.gold_usd != null && r.nifty50 != null);
    if (valid.length < 2) return null;
    const goldBase = valid[0].gold_usd;
    const niftyBase = valid[0].nifty50;
    return {
      gold: valid.map((r) => ({ date: r.date, value: (r.gold_usd / goldBase) * 100 })),
      nifty: valid.map((r) => ({ date: r.date, value: (r.nifty50 / niftyBase) * 100 })),
    };
  }, [goldHistRows]);
  // 2026-09-22 ("overlap gold and us 10yield, similar to nifty and
  // gold") — same indexed-to-100 treatment as goldNiftyChart above,
  // overlaid on one shared axis instead of the small-multiples version
  // this replaced. Indexing a YIELD this way is a slightly unusual
  // framing (a rate doesn't "compound" the way a price does), but it's
  // an honest one — both series start at the same point 100 by
  // construction, so the chart can't be skewed by axis-range choices
  // the way a dual-axis price+percentage chart could be; what it shows
  // is each series' own relative move from the same starting line.
  const goldRatesChart = useMemo(() => {
    const valid = goldHistRows.filter((r) => r.gold_usd != null && r.us10y_yield != null);
    if (valid.length < 2) return null;
    const goldBase = valid[0].gold_usd;
    const yieldBase = valid[0].us10y_yield;
    return {
      gold: valid.map((r) => ({ date: r.date, value: (r.gold_usd / goldBase) * 100 })),
      yield: valid.map((r) => ({ date: r.date, value: (r.us10y_yield / yieldBase) * 100 })),
    };
  }, [goldHistRows]);
  // 2026-09-14 ("want to [see actual rates for] other countries") —
  // separate small screener/table, not folded into the main GenericTable
  // above: countryYields is monthly-cadence FRED data (a "latest level +
  // change vs a year ago" shape), genuinely different from every other
  // row's daily trend/EMA shape, so it gets its own compact table
  // instead of forcing a mismatched shape into shared columns.
  const yieldsEntry = bundle.momentum_screeners["countryYields"];
  const yieldsRows: any[] = yieldsEntry?.rows ?? [];
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
  const [region, setRegion] = useState<"india" | "international" | "ratios" | "factor" | "rates">("india");
  const indiaRows = allRows.filter((r: any) => r.region === "India");
  const internationalRows = allRows.filter((r: any) => r.region === "International");
  const ratiosRows = allRows.filter((r: any) => r.region === "Ratios");
  const factorRows = allRows.filter((r: any) => r.region === "Factor");
  // 2026-09-14 ("add interest rates across countries (major)") — its
  // own tab rather than folded into International, so the inverse-
  // yield caveat below only needs to be said once, not repeated per row.
  const ratesRows = allRows.filter((r: any) => r.region === "Rates");
  const rows =
    region === "india" ? indiaRows : region === "international" ? internationalRows : region === "ratios" ? ratiosRows : region === "rates" ? ratesRows : factorRows;

  if (!ready) return <ScreenerLoading label="Strategic Alpha" />;

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
        <button
          onClick={() => setRegion("rates")}
          className={`text-xs px-3 py-1.5 rounded border ${region === "rates" ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}
        >
          📉 Rates ({ratesRows.length})
        </button>
      </div>

      <MethodologyNote>
        The <b>🇮🇳 India</b>/<b>🌍 International</b>/<b>📐 Ratios</b>/<b>🏭 Factor</b>/<b>📉 Rates</b> toggle above splits the same single
        dataset five ways — all refresh together on the same daily run, just filtered by which bucket each asset belongs to.{" "}
        <b>📉 Rates</b> is major-country interest rates, added 2026-09-14 — read <b>US 10Y Yield</b> normally (it's a real yield: rising =
        rates going up), but every OTHER row here is a government-bond ETF's PRICE, not a yield — Yahoo Finance simply carries no sovereign
        yield series for any country but the US (confirmed live: every direct ticker guessed 404s, and Yahoo's own symbol search returns
        nothing for "country 10 year bond yield" queries — the same dead end India's own 10Y attempt hit earlier). A bond's price moves{" "}
        <b>opposite</b> its yield, so for <b>Germany/Eurozone Govt Bonds</b>, <b>UK Gilts</b>, <b>Japan Govt Bonds</b>,{" "}
        <b>India 5Y G-Sec</b>, and <b>China Bonds</b>: <b>Bull</b> means the bond is rising in price, which means that country's yields are{" "}
        <b>falling</b> — the opposite sense Bull carries on every other row on this page. <b>🏭 Factor</b> is the "Factor
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
        screenshot. <b>US 10Y Yield</b> was added 2026-09-13 ("yields charts under strategic for US, INDIA") — this is the actual yield level
        (^TNX, confirmed live), a rising row means yields are rising, run through the same trend/return logic as every other row. An{" "}
        <b>India 10Y</b> row was attempted alongside it but dropped after two dead ends confirmed live: the real yield ticker (^IN10Y)
        returns no Yahoo data at all, and a price-index proxy (NIFTYGS10YR.NS) returns only a single current data point from Yahoo even on a
        2-year range request — neither can feed this screener's trend/return calculation. Not available via Yahoo through any route found.{" "}
        <b>Not built</b>: Market Breadth (% of NSE stocks above their 30-week MA), and "country rotation" (the video itself calls this an
        undisclosed proprietary system). <b>Actual 10Y Govt Bond Yields</b> (below, on the 📉 Rates tab) is a separate small table, added
        2026-09-14 — real yield LEVELS (not price, not a trend table) for the US plus every major country FRED (fred.stlouisfed.org, the
        St. Louis Fed's free public data service) actually carries one for: Germany, UK, Japan, and India, sourced from the OECD's own
        "long-term interest rate" series (defined as the 10-year government bond yield). US updates daily (Treasury's own series); the
        other four update monthly (OECD's own cadence, usually 2-3 months behind — see each row's own "as of"). China is not shown here —
        searched FRED directly and found no comparable 10-year series for it (only a short-term interbank rate, a different, non-comparable
        number), so it's left out rather than shown as something it isn't.
      </MethodologyNote>

      {/* 2026-09-22 ("add a chart of gold against nifty50 over last
          several years... also gold against interest rates") —
          page-level, not gated to a region tab, since both charts span
          what the tabs above split apart (Gold lives in International,
          Nifty 50 in India, US 10Y Yield in Rates). Chart 1 puts Gold
          and Nifty 50 on ONE shared axis (both indexed to 100 at the
          first date) since that's a valid single-axis comparison — two
          "growth of ₹100/$100 invested" curves. Chart 2 (Gold vs US 10Y
          Yield) originally used small multiples instead, since a price
          and a percentage are different units — changed 2026-09-22
          ("overlap gold and us 10yield, similar to nifty and gold") to
          the same indexed-to-100 overlay as Chart 1 on request. Indexing
          a yield this way is a slightly unusual framing (a rate doesn't
          "compound" the way a price does), but stays honest: both series
          start at the same point 100 by construction, so — unlike a
          dual-axis chart — it can't be skewed by choosing where each
          axis starts/ends. */}
      {goldNiftyChart && (
        <div className="mb-4 border border-slate-200 rounded-lg p-3">
          <div className="text-xs font-medium text-slate-600 mb-2">🥇 Gold vs Nifty 50 — indexed to 100 at {goldHistRows[0]?.date}</div>
          <ChartLegend items={[{ label: "Gold (USD)", color: CHART_BLUE }, { label: "Nifty 50", color: CHART_ORANGE }]} />
          <TimeSeriesChart
            series={[
              { label: "Gold (USD)", color: CHART_BLUE, points: goldNiftyChart.gold },
              { label: "Nifty 50", color: CHART_ORANGE, points: goldNiftyChart.nifty },
            ]}
            yFormat={(v) => v.toFixed(0)}
            yLabel="Index (100 = start)"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            Both series indexed to 100 at the earliest date in the fetched window — reads as "growth of 100 units invested", not absolute price levels
            (Gold is USD, Nifty 50 is INR index points — not directly comparable otherwise).
          </p>
        </div>
      )}
      {goldRatesChart && (
        <div className="mb-4 border border-slate-200 rounded-lg p-3">
          <div className="text-xs font-medium text-slate-600 mb-2">🥇 Gold vs US 10Y Treasury Yield — indexed to 100 at {goldHistRows[0]?.date}</div>
          <ChartLegend items={[{ label: "Gold (USD)", color: CHART_BLUE }, { label: "US 10Y Yield", color: CHART_ORANGE }]} />
          <TimeSeriesChart
            series={[
              { label: "Gold (USD)", color: CHART_BLUE, points: goldRatesChart.gold },
              { label: "US 10Y Yield", color: CHART_ORANGE, points: goldRatesChart.yield },
            ]}
            yFormat={(v) => v.toFixed(0)}
            yLabel="Index (100 = start)"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            Both series indexed to 100 at the earliest date in the fetched window — Gold's price and the 10Y yield's percentage are different units,
            so this reads as each series' own relative move from the same starting line, not a literal price-vs-yield-level comparison. The classic
            read: gold tends to do better when yields are falling, since it pays no interest itself.
          </p>
        </div>
      )}

      {region === "rates" && (
        <div className="mb-4 border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600 flex items-center gap-2">
            <span>
              Actual 10Y Govt Bond Yields {yieldsEntry?.as_of && <span className="text-slate-400 font-normal">— refreshed {yieldsEntry.as_of}</span>}
            </span>
            {/* 2026-09-14 — fred.stlouisfed.org blocks Vercel's serverless
                IP (confirmed live, see RunButton.tsx's own comment on
                this entry), so this has no daily cron — RunButton falls
                through to its LOCAL_ONLY_SCREENERS note here instead of
                a real "Run now" click. */}
            <span className="ml-auto">
              <RunButton screener="countryYields" />
            </span>
          </div>
          {yieldsRows.length === 0 ? (
            <div className="px-3 py-4 text-xs text-slate-400">No yield data yet — see the refresh note above.</div>
          ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="px-3 py-1.5 font-medium">Country</th>
                <th className="px-3 py-1.5 font-medium">Yield</th>
                <th className="px-3 py-1.5 font-medium">As of</th>
                <th className="px-3 py-1.5 font-medium">vs 1Y ago</th>
              </tr>
            </thead>
            <tbody>
              {yieldsRows.map((r) => (
                <tr key={r.country} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-1.5">{r.country}</td>
                  <td className="px-3 py-1.5 font-medium">{r.latest_yield_pct != null ? `${r.latest_yield_pct}%` : "—"}</td>
                  <td className="px-3 py-1.5 text-slate-400">{r.as_of}</td>
                  <td className={`px-3 py-1.5 ${r.chg_vs_1y_ago_bps > 0 ? "text-emerald-600" : r.chg_vs_1y_ago_bps < 0 ? "text-red-600" : ""}`}>
                    {r.chg_vs_1y_ago_bps != null ? `${r.chg_vs_1y_ago_bps > 0 ? "+" : ""}${r.chg_vs_1y_ago_bps} bps` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
      )}
      <GenericTable
        rows={rows}
        cols={COLS}
        navigate={(t) => navigate(`/company/${t}`)}
        emptyMessage="No Strategic Alpha data yet — click Run now above."
      />
    </div>
  );
}
