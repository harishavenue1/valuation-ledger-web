import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import RunButton from "../components/RunButton";
import { Col, fmtNum, GenericTable, MethodologyNote, NSE_SCREENER_COLS, PriceLink, Signed } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";

// F1-F3/C1-C3/score/verdict arrive pre-formatted as strings — same
// Viraj-style 6-rule scoring used by smeMomentum (sme_momentum_screener.py,
// a local script) and momentumPersonal (api/momentum_screeners.py's
// _run_momentum_personal, both added 2026-09-05). VirajScreen.tsx has
// its own near-identical Tick/verdict styling for its own dedicated
// page — duplicated here in miniature rather than shared, since these
// generic-table tabs don't otherwise share a component with that page
// and the styling is tiny.
function VirajTick({ v }: { v?: string }) {
  const cls = v === "✅" ? "bg-emerald-50 text-emerald-700" : v === "❌" ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-400";
  return <span className={`inline-flex items-center justify-center w-6 h-6 rounded ${cls}`}>{v ?? "—"}</span>;
}
// v can be undefined here even on a "new" row shape — a row pushed
// before this Viraj-column addition landed (stale cache, or a run that
// failed and left old data in place) simply won't carry a verdict
// field at all. A crash here (v.includes on undefined) takes down the
// WHOLE page, not just this cell — this app has no error boundary — so
// this must degrade to "—" rather than throw.
function VirajVerdict({ v }: { v?: string }) {
  if (!v) return <span className="text-slate-400">—</span>;
  const cls = v.includes("ENTRY READY")
    ? "bg-emerald-50 text-emerald-700 border-emerald-300"
    : v.includes("WATCHLIST")
      ? "bg-amber-50 text-amber-700 border-amber-300"
      : "bg-slate-100 text-slate-500 border-slate-300";
  return <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>{v}</span>;
}
function fmtMktCap(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
}
function fmtVol(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : v.toLocaleString("en-IN");
}

// Each of these 5 screeners now scans NSE 750 (Nifty Total Market) and
// pushes independently from its own local skill script — see
// api/momentum_screeners.py. Row shape differs per screener (its own
// columns), so each tab defines its own small column list rather than
// sharing one generic table.
const TABS: { key: string; label: string; emoji: string }[] = [
  { key: "myLongTermInvestingStrategy", label: "myLongTermInvestingStrategy", emoji: "📐" },
  { key: "weekendInvesting", label: "weekendInvesting", emoji: "🏁" },
  { key: "quantBollinger", label: "quantBollinger", emoji: "📊" },
  { key: "Nifty500RelativeStrength", label: "RS (NSE750)", emoji: "💪" },
  { key: "nseScreener", label: "NSE Screener", emoji: "📈" },
  { key: "sectorAlpha", label: "Sector Alpha", emoji: "🧭" },
  { key: "sectorStockAlpha", label: "Stocks vs Sector", emoji: "🎯" },
  { key: "maBreakout", label: "MA Breakout", emoji: "🚀" },
  { key: "valueRsiTurnaround", label: "Value RSI Turnaround", emoji: "💎" },
  { key: "grandfatherFatherSon", label: "Grandfather-Father-Son", emoji: "👴" },
  { key: "52wHigh", label: "52-Week High", emoji: "🏔️" },
  { key: "allTimeHigh", label: "All-Time High", emoji: "🗻" },
  { key: "momentumPersonal", label: "momentumPersonal", emoji: "🎯" },
  { key: "smeMomentum", label: "SME Momentum", emoji: "🌱" },
  { key: "volumeRockers", label: "Volume Rockers", emoji: "🚨" },
];

export default function MomentumScreeners() {
  const { bundle, reload } = useData();
  const navigate = useNavigate();
  const [tab, setTab] = useState(TABS[0].key);
  const [refreshing, setRefreshing] = useState(false);
  const watchlist = useWatchlist();
  const entry = bundle.momentum_screeners[tab];
  const rows = entry?.rows ?? [];

  async function doRefresh() {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }

  const COLS: Record<string, Col[]> = {
    myLongTermInvestingStrategy: [
      { key: "symbol", label: "Symbol", align: "left" },
      { key: "name", label: "Name", align: "left" },
      { key: "sector", label: "Sector", align: "left" },
      { key: "close", label: "Close", render: (r) => <PriceLink symbol={r.symbol} value={r.close} /> },
      { key: "rsi14", label: "RSI(14)", render: (r) => fmtNum(r.rsi14, 1) },
      { key: "ema12", label: "12W EMA", render: (r) => fmtNum(r.ema12) },
      { key: "ema21", label: "21W EMA", render: (r) => fmtNum(r.ema21) },
      { key: "ema33", label: "33W EMA", render: (r) => fmtNum(r.ema33) },
      { key: "pct_above_ema33", label: "% vs 33W EMA", render: (r) => <Signed v={r.pct_above_ema33} digits={1} /> },
    ],
    weekendInvesting: [
      { key: "rank", label: "Rank" },
      { key: "symbol", label: "Symbol", align: "left" },
      { key: "name", label: "Name", align: "left" },
      { key: "sector", label: "Sector", align: "left" },
      { key: "close", label: "Close", render: (r) => <PriceLink symbol={r.symbol} value={r.close} /> },
      { key: "close_52w_ago", label: "Close 52W Ago", render: (r) => fmtNum(r.close_52w_ago) },
      { key: "roc_1y_pct", label: "1Y Return %", render: (r) => <Signed v={r.roc_1y_pct} digits={1} /> },
    ],
    quantBollinger: [
      { key: "symbol", label: "Symbol", align: "left" },
      { key: "name", label: "Name", align: "left" },
      { key: "sector", label: "Sector", align: "left" },
      { key: "close", label: "Close", render: (r) => <PriceLink symbol={r.symbol} value={r.close} /> },
      { key: "upper_band", label: "Upper Band", render: (r) => fmtNum(r.upper_band) },
      { key: "pct_above_band", label: "% Above Band", render: (r) => <Signed v={r.pct_above_band} digits={1} /> },
      { key: "rs55_pct", label: "55W RS %", render: (r) => <Signed v={r.rs55_pct} digits={1} /> },
      { key: "pct_vs_sma34", label: "% vs 34W SMA", render: (r) => <Signed v={r.pct_vs_sma34} digits={1} /> },
      { key: "chandelier_stop", label: "Chandelier Stop", render: (r) => fmtNum(r.chandelier_stop) },
    ],
    Nifty500RelativeStrength: [
      { key: "rank", label: "Rank" },
      { key: "symbol", label: "Symbol", align: "left" },
      { key: "name", label: "Name", align: "left" },
      { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
      { key: "r_1m", label: "1M %", render: (r) => <Signed v={r.r_1m} digits={1} /> },
      { key: "rs_1w", label: "RS 1W %", render: (r) => <Signed v={r.rs_1w} digits={1} /> },
      { key: "rs_1m", label: "RS 1M %", render: (r) => <Signed v={r.rs_1m} digits={1} /> },
      { key: "rs_3m", label: "RS 3M %", render: (r) => <Signed v={r.rs_3m} digits={1} /> },
      { key: "rs_6m", label: "RS 6M %", render: (r) => <Signed v={r.rs_6m} digits={1} /> },
      { key: "rs_score", label: "RS Score", render: (r) => <span className="font-semibold">{fmtNum(r.rs_score, 1)}</span> },
      { key: "rs_new_high", label: "New High?", render: (r) => (r.rs_new_high ? <span className="text-amber-600 font-semibold">Y</span> : "") },
    ],
    nseScreener: NSE_SCREENER_COLS,
    sectorAlpha: [
      { key: "rank", label: "Rank" },
      { key: "sector_name", label: "Sector", align: "left" },
      { key: "zone", label: "Zone", align: "left" },
      { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.ticker} value={r.price} /> },
      { key: "r_1m", label: "1M %", render: (r) => <Signed v={r.r_1m} digits={1} /> },
      { key: "rs_1w", label: "Alpha 1W %", render: (r) => <Signed v={r.rs_1w} digits={1} /> },
      { key: "rs_1m", label: "Alpha 1M %", render: (r) => <Signed v={r.rs_1m} digits={1} /> },
      { key: "rs_3m", label: "Alpha 3M %", render: (r) => <Signed v={r.rs_3m} digits={1} /> },
      { key: "rs_6m", label: "Alpha 6M %", render: (r) => <Signed v={r.rs_6m} digits={1} /> },
      { key: "rs_1y", label: "Alpha 1Y %", render: (r) => <Signed v={r.rs_1y} digits={1} /> },
      { key: "rs_score", label: "Alpha Score", render: (r) => <span className="font-semibold">{fmtNum(r.rs_score, 1)}</span> },
      { key: "rs_new_high", label: "New High?", render: (r) => (r.rs_new_high ? <span className="text-amber-600 font-semibold">Y</span> : "") },
    ],
    sectorStockAlpha: [
      { key: "rank", label: "Rank" },
      { key: "symbol", label: "Symbol", align: "left" },
      { key: "name", label: "Name", align: "left" },
      { key: "sector", label: "Sector", align: "left" },
      { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
      { key: "r_1m", label: "1M %", render: (r) => <Signed v={r.r_1m} digits={1} /> },
      { key: "alpha_1w", label: "Alpha 1W %", render: (r) => <Signed v={r.alpha_1w} digits={1} /> },
      { key: "alpha_1m", label: "Alpha 1M %", render: (r) => <Signed v={r.alpha_1m} digits={1} /> },
      { key: "alpha_3m", label: "Alpha 3M %", render: (r) => <Signed v={r.alpha_3m} digits={1} /> },
      { key: "alpha_6m", label: "Alpha 6M %", render: (r) => <Signed v={r.alpha_6m} digits={1} /> },
      { key: "alpha_1y", label: "Alpha 1Y %", render: (r) => <Signed v={r.alpha_1y} digits={1} /> },
      { key: "alpha_score", label: "Alpha Score", render: (r) => <span className="font-semibold">{fmtNum(r.alpha_score, 1)}</span> },
    ],
    maBreakout: [
      { key: "symbol", label: "Symbol", align: "left" },
      { key: "name", label: "Name", align: "left" },
      { key: "sector", label: "Sector", align: "left" },
      { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
      { key: "via", label: "Via", align: "left" },
      { key: "ema200d", label: "200D EMA", render: (r) => fmtNum(r.ema200d) },
      { key: "pct_above_200d", label: "% Above 200D", render: (r) => <Signed v={r.pct_above_200d} digits={1} /> },
      { key: "days_since_cross_200d", label: "Days Since Cross", render: (r) => (r.days_since_cross_200d === null || r.days_since_cross_200d === undefined ? "—" : r.days_since_cross_200d) },
      { key: "ema33w", label: "33W EMA", render: (r) => fmtNum(r.ema33w) },
      { key: "pct_above_33w", label: "% Above 33W", render: (r) => <Signed v={r.pct_above_33w} digits={1} /> },
      { key: "weeks_since_cross_33w", label: "Weeks Since Cross", render: (r) => (r.weeks_since_cross_33w === null || r.weeks_since_cross_33w === undefined ? "—" : r.weeks_since_cross_33w) },
      { key: "fresh_this_week", label: "Fresh This Week?", render: (r) => (r.fresh_this_week ? <span className="text-amber-600 font-semibold">Y</span> : "") },
    ],
    valueRsiTurnaround: [
      { key: "symbol", label: "Symbol", align: "left" },
      { key: "name", label: "Name", align: "left" },
      { key: "sector", label: "Sector", align: "left" },
      { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
      { key: "rsi_m", label: "Monthly RSI", render: (r) => <span className="font-semibold">{fmtNum(r.rsi_m, 1)}</span> },
      { key: "rsi_at_cross", label: "RSI at Cross", render: (r) => fmtNum(r.rsi_at_cross, 1) },
      { key: "months_since_cross", label: "Months Since Cross" },
      { key: "rsi_gain_since_cross", label: "RSI Gain Since Cross", render: (r) => <Signed v={r.rsi_gain_since_cross} digits={1} /> },
    ],
    grandfatherFatherSon: [
      { key: "symbol", label: "Symbol", align: "left" },
      { key: "name", label: "Name", align: "left" },
      { key: "sector", label: "Sector", align: "left" },
      { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
      { key: "monthly_rsi", label: "Monthly RSI", render: (r) => <span className="font-semibold">{fmtNum(r.monthly_rsi, 1)}</span> },
      { key: "weekly_rsi", label: "Weekly RSI", render: (r) => <span className="font-semibold">{fmtNum(r.weekly_rsi, 1)}</span> },
      { key: "daily_rsi", label: "Daily RSI", render: (r) => fmtNum(r.daily_rsi, 1) },
      { key: "daily_rsi_at_support", label: "RSI at Support", render: (r) => fmtNum(r.daily_rsi_at_support, 1) },
      { key: "days_since_support", label: "Days Since Support" },
      { key: "stop_loss", label: "Stop-Loss", render: (r) => fmtNum(r.stop_loss) },
    ],
    "52wHigh": [
      { key: "symbol", label: "Symbol", align: "left" },
      { key: "name", label: "Name", align: "left" },
      { key: "sector", label: "Sector", align: "left" },
      { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
      { key: "high_52w", label: "52W High", render: (r) => fmtNum(r.high_52w) },
      { key: "pct_off_high", label: "% Off High", render: (r) => <Signed v={r.pct_off_high} digits={1} /> },
      { key: "new_high", label: "New High?", render: (r) => (r.new_high ? <span className="text-amber-600 font-semibold">Y</span> : "") },
    ],
    allTimeHigh: [
      { key: "symbol", label: "Symbol", align: "left" },
      { key: "name", label: "Name", align: "left" },
      { key: "sector", label: "Sector", align: "left" },
      { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
      { key: "ath", label: "All-Time High", render: (r) => fmtNum(r.ath) },
      { key: "pct_off_ath", label: "% Off ATH", render: (r) => <Signed v={r.pct_off_ath} digits={1} /> },
      { key: "new_high", label: "New High?", render: (r) => (r.new_high ? <span className="text-amber-600 font-semibold">Y</span> : "") },
    ],
    momentumPersonal: [
      { key: "symbol", label: "Symbol", align: "left" },
      { key: "name", label: "Name", align: "left" },
      { key: "sector", label: "Sector", align: "left" },
      { key: "marketcap", label: "Mkt Cap", render: (r) => fmtMktCap(r.marketcap) },
      { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
      { key: "weekly_close", label: "Weekly Close", render: (r) => fmtNum(r.weekly_close) },
      { key: "high_52w", label: "52W High", render: (r) => fmtNum(r.high_52w) },
      { key: "ma20w", label: "20W MA", render: (r) => fmtNum(r.ma20w) },
      { key: "pct_above_ma20w", label: "% Above 20W MA", render: (r) => <Signed v={r.pct_above_ma20w} digits={1} /> },
      { key: "sales_g", label: "Sales G%" },
      { key: "ebit_g", label: "EBIT G%" },
      { key: "eps_g", label: "EPS G%" },
      { key: "dol", label: "DOL" },
      { key: "dfl", label: "DFL" },
      { key: "dcl", label: "DCL" },
      { key: "F1", label: "F1", render: (r) => <VirajTick v={r.F1} /> },
      { key: "F2", label: "F2", render: (r) => <VirajTick v={r.F2} /> },
      { key: "F3", label: "F3", render: (r) => <VirajTick v={r.F3} /> },
      { key: "C1", label: "C1", render: (r) => <VirajTick v={r.C1} /> },
      { key: "C2", label: "C2", render: (r) => <VirajTick v={r.C2} /> },
      { key: "C3", label: "C3", render: (r) => <VirajTick v={r.C3} /> },
      { key: "score", label: "Score" },
      { key: "verdict", label: "Verdict", render: (r) => <VirajVerdict v={r.verdict} /> },
    ],
    smeMomentum: [
      { key: "rank", label: "Rank" },
      { key: "symbol", label: "Symbol", align: "left" },
      { key: "name", label: "Name", align: "left" },
      { key: "marketcap", label: "Mkt Cap", render: (r) => fmtMktCap(r.marketcap) },
      { key: "close", label: "Close", render: (r) => <PriceLink symbol={r.symbol} value={r.close} /> },
      { key: "pct_30d", label: "30D %", render: (r) => <Signed v={r.pct_30d} digits={1} /> },
      { key: "roc_1y_pct", label: "1Y Return %", render: (r) => <Signed v={r.roc_1y_pct} digits={1} /> },
      { key: "year_high", label: "52W High", render: (r) => fmtNum(r.year_high) },
      { key: "year_low", label: "52W Low", render: (r) => fmtNum(r.year_low) },
      { key: "diff_from_high", label: "₹ Off High", render: (r) => fmtNum(r.diff_from_high) },
      { key: "pct_off_high", label: "% Off High", render: (r) => <Signed v={r.pct_off_high} digits={1} /> },
      { key: "sales_g", label: "Sales G%" },
      { key: "ebit_g", label: "EBIT G%" },
      { key: "eps_g", label: "EPS G%" },
      { key: "dol", label: "DOL" },
      { key: "dfl", label: "DFL" },
      { key: "dcl", label: "DCL" },
      { key: "F1", label: "F1", render: (r) => <VirajTick v={r.F1} /> },
      { key: "F2", label: "F2", render: (r) => <VirajTick v={r.F2} /> },
      { key: "F3", label: "F3", render: (r) => <VirajTick v={r.F3} /> },
      { key: "C1", label: "C1", render: (r) => <VirajTick v={r.C1} /> },
      { key: "C2", label: "C2", render: (r) => <VirajTick v={r.C2} /> },
      { key: "C3", label: "C3", render: (r) => <VirajTick v={r.C3} /> },
      { key: "score", label: "Score" },
      { key: "verdict", label: "Verdict", render: (r) => <VirajVerdict v={r.verdict} /> },
    ],
    volumeRockers: [
      { key: "rank", label: "Rank" },
      { key: "symbol", label: "Symbol", align: "left" },
      { key: "name", label: "Name", align: "left" },
      { key: "sector", label: "Sector", align: "left" },
      { key: "ltp", label: "LTP", render: (r) => <PriceLink symbol={r.symbol} value={r.ltp} /> },
      { key: "day_vol", label: "Day Vol.", render: (r) => fmtVol(r.day_vol) },
      { key: "month_vol_avg", label: "Month Vol. Avg", render: (r) => fmtVol(r.month_vol_avg) },
      { key: "turnover_cr", label: "Turnover (₹ Cr)", render: (r) => fmtNum(r.turnover_cr, 1) },
      { key: "day_chg_pct", label: "Day Chg %", render: (r) => <Signed v={r.day_chg_pct} digits={1} /> },
      { key: "vol_change_times", label: "Volume Change ×", render: (r) => <span className="font-semibold">{fmtNum(r.vol_change_times, 1)}×</span> },
    ],
  };

  // 2026-08-30, "add a note on how the calculation for score is
  // calculated or the logic behind this screener" — one per tab,
  // collapsed by default (MethodologyNote), matching exactly what
  // api/momentum_screeners.py actually computes for that screener, not
  // a marketing gloss on it.
  const METHODOLOGY: Record<string, React.ReactNode> = {
    myLongTermInvestingStrategy: (
      <>
        No numeric score — a stock either qualifies or it doesn't. <b>Signal</b> = weekly RSI(14) &gt; 66 <b>AND</b> price above the 12-week,
        21-week, <b>AND</b> 33-week EMA (full ribbon alignment, all three at once). RSI and EMAs are computed on weekly closes resampled from
        daily data. Only stocks currently meeting the signal are shown.
      </>
    ),
    weekendInvesting: (
      <>
        Pure rank, no benchmark and no fundamentals: every stock's trailing <b>1-year price return</b> (52 weeks back from the latest close),
        sorted highest to lowest. Top 20 = the buy list (5% each, equal weight), ranks 21-40 shown as a watchlist. A held stock would exit the
        moment it drops out of the top 20 on the next weekly re-rank.
      </>
    ),
    quantBollinger: (
      <>
        Signal = latest weekly close breaks above the <b>55-week SMA + 3.7 standard deviations</b> upper band. If more than 25 stocks signal in
        the same run, the excess is ranked by <b>55-week relative strength</b> (price now vs. price 55 weeks ago) and only the top 25 are kept —
        shown here already deduped down to that cap. 34-week SMA and the ATR(14)×1.8 chandelier stop are shown for context only, not used to
        filter or rank.
      </>
    ),
    Nifty500RelativeStrength: (
      <>
        <b>Alpha</b> = stock's own return minus NIFTY 500's return, over the same window (1W/1M/3M/6M). <b>RS Score</b> is a recency-weighted
        blend of those four alphas — 10% (1W) / 40% (1M) / 30% (3M) / 20% (6M) — so a stock just starting to rotate in shows up quickly, while
        longer windows stop one good week from topping the rank alone. <b>New High?</b> = the stock's price-to-NIFTY500 ratio is at its highest
        point in the fetched window — i.e. it's leading the market in relative terms, even if its own price isn't at a high.
      </>
    ),
    nseScreener: (
      <>
        Plain price/RSI screen — no alpha vs. any benchmark, no combined score. <b>Change / Weekly / Monthly / 3Month / Yearly %</b> are rolling
        trailing returns: today's close vs. the closest trading day roughly 1 / 5 / 30 / 90 / 365 days back — not calendar week/month
        boundaries. <b>RSI(D/W/M)</b> is Wilder's RSI(14) on daily/weekly/monthly closes. <b>3W Green</b> = the last 3 completed weekly candles
        each closed higher than the one before.
      </>
    ),
    sectorAlpha: (
      <>
        <b>Alpha</b> = a sector's ETF return minus NIFTY 500's return, over 1W/1M/3M/6M/1Y. <b>Alpha Score</b> is a recency-weighted blend — 10%
        (1W) / 35% (1M) / 30% (3M) / 15% (6M) / 10% (1Y). <b>Zone</b> = top third of the ranked list is "Leader", bottom third "Laggard", the
        rest "Middle". <b>New High?</b> = the sector's price-to-NIFTY500 ratio is at its highest point in the fetched window. 21 sectors are
        covered
        via their most liquid NSE-listed ETF, not the raw index (several raw NSE sector indices are stale on this data source) — Media, Consumer
        Durables, Chemicals, Energy, Services, and Capital Markets aren't included: either no liquid ETF exists, or it's too newly listed for a
        trustworthy 1-year number yet.
      </>
    ),
    sectorStockAlpha: (
      <>
        The drill-down under Sector Alpha: <b>Alpha</b> = a stock's own return minus <i>its sector's</i> return (not the market's). <b>Alpha
        Score</b> is a 10/35/30/15/10% weighted blend of the 1W/1M/3M/6M/1Y alpha columns, same weighting as Sector Alpha. "Sector" here is
        NSE's own industry classification (not the ETF
        list above) — each industry's return is computed bottom-up as the plain average of its own constituent stocks' returns, so every real
        industry is covered, not just the ones with a liquid ETF. Defence and Manufacturing also appear as separate theme rows, compared
        against <i>that theme's own ETF</i> return instead of an industry average, since those are cross-industry themes (not a single
        industry) — a stock can legitimately appear twice, once under its industry and once under a theme it also belongs to.
      </>
    ),
    maBreakout: (
      <>
        No numeric score — a stock either qualifies or it doesn't. Qualifies if it's <b>currently above</b> its 200-day EMA <b>or</b> its
        33-week EMA (shown under <b>Via</b>, both if it qualifies on each), the cross above that EMA happened within the{" "}
        <b>last 8 weeks</b> (not an old, already-established trend), <b>and</b> price hasn't run more than <b>20% past</b> that EMA yet —
        that 20% cap doubles as the "still consolidating, not extended" test, rather than a separate range/volatility check.{" "}
        <b>Fresh This Week?</b> = the cross happened in the most recent bar (this week for the 33W EMA, the last trading day for the 200D
        EMA). EMAs are computed on <b>OHLC4</b> ((Open+High+Low+Close)/4), not Close alone — but the above/below check and the %-above figure
        compare the real <b>Close</b> against that OHLC4-based EMA line. No market-cap filter: there's no bulk data source for it across all
        750 stocks, and this universe's own inclusion bar already excludes true microcaps in practice.
      </>
    ),
    valueRsiTurnaround: (
      <>
        No numeric score — a "value"/turnaround screen: monthly RSI(14) crossed <b>above 40</b> within the <b>last 3 completed monthly
        candles</b> (not an old, already-established recovery), and is <b>progressing</b> — today's RSI is net higher than it was the month it
        crossed (a flat or slightly lower month in between doesn't disqualify it, as long as the overall move since the cross is upward).
        Capped at <b>RSI 60</b>: past that it's arguably already a momentum stock, not a value/turnaround entry anymore. Uses a different RSI
        calculation than the NSE Screener tab's Monthly RSI column (same Wilder-family formula, different warm-up seeding) since this screen
        needs the full historical RSI series to find exactly when it crossed 40 — the two can show slightly different values for the same
        stock. No market-cap filter, same reasoning as MA Breakout.
      </>
    ),
    grandfatherFatherSon: (
      <>
        Vishal Malkan's "Grandfather-Father-Son" / "5-Star RSI" strategy. No numeric score — needs <b>all</b> of: Monthly RSI(14) &gt; 60{" "}
        <b>and</b> Weekly RSI(14) &gt; 60 (the "grandfather" and "father" timeframes confirming a genuinely strong, established uptrend), and
        the Daily RSI(14) (the "son") found a <b>bullish (green) candle</b> while sitting in the <b>35-45 support zone</b> within the last 10
        trading days — in a trend this strong, 40 tends to act as support on the daily chart rather than get broken. Today's Daily RSI must be
        at or above that trigger day's level (the bounce has actually started), and no day since has closed <b>below the trigger candle's
        low</b> (that would mean the setup already stopped out). <b>Stop-Loss</b> = the low of that trigger candle, per the strategy's own
        rule. The strategy's target is Daily RSI reaching back up to 60 — not a price level, so no price target is shown; judge the distance
        from the Daily RSI column itself. Uses the same RSI calculation as Value RSI Turnaround (not the NSE Screener tab's), for the same
        reason: needs the full historical series, not just the latest value.
      </>
    ),
    "52wHigh": (
      <>
        No numeric score — every stock currently trading within <b>3% of its own trailing 52-week closing high</b> is shown, closest-to-high
        first. "High" means the highest <b>daily Close</b> over the last ~52 weeks, not the intraday High — a stock can be within band on a
        closing basis while today's intraday high was further away. <b>New High?</b> = today's close is at or above every close in that
        window (a genuine new 52-week high today, not just close to one).
      </>
    ),
    allTimeHigh: (
      <>
        Same idea as 52-Week High, over the stock's <b>full listing history</b> instead of 52 weeks: every stock within <b>3% of its own
        all-time closing high</b> is shown, closest first. Computed on <b>weekly</b> closes (not daily) — a straight daily fetch back to each
        stock's listing date across 750 tickers risks Vercel's time limit, and weekly closes still find the right week — so "high" here means
        the highest <b>weekly closing</b> price on record, not the single highest daily close or intraday High; a one-day spike that never
        became that week's Friday close wouldn't be captured. Good for "is this near its all-time high", not for the exact record price to the
        rupee. <b>New High?</b> = this week's close is at or above every weekly close on record.
      </>
    ),
    momentumPersonal: (
      <>
        Reproduction of Hitesh Modi's (<a href="https://x.com/imhiteshmodi" target="_blank" rel="noreferrer" className="underline">@imhiteshmodi</a> on X) public
        "Momentum Portfolio Original Scan" — his live momentum portfolio is up <b>3.23×</b> since July 2022 vs. the Nifty Smallcap 250's 2.28× (self-reported, not
        independently audited). No numeric score — a stock either qualifies or it doesn't, on <b>weekly closes</b>: <b>this week's close is a fresh 52-week high</b>{" "}
        (above the 52-week-high reading from a week ago) <b>AND</b> none of the <b>prior 5 weeks</b> was already a new 52-week high (specifically the{" "}
        <b>first</b> breakout week, not a stock already 4-5 weeks into an extended new-high streak) <b>AND</b> market cap between ₹500 Cr and ₹50,000 Cr. Unlike
        every other tab here, this one doesn't recompute the rule against the NSE 750 universe — it queries his{" "}
        <a href="https://chartink.com/screener/mi50-originalkl-scan" target="_blank" rel="noreferrer" className="underline">actual Chartink scan</a> live (its
        exact filter, pulled from the page itself, not a paraphrase), since his scan runs on the full ~2,570-stock NSE cash segment — a universe this app's other
        screeners deliberately don't fetch in full. Price/52W High/20W MA are then looked up only for whatever Chartink returns that week. His own further steps
        are <b>not</b> replicated: he picks a personal "top 5" from the results and says to "avoid cyclicals" by eye — this tab shows Chartink's full qualifying
        list, not his actual picks. <b>20W MA / % Above</b> reflect his stated <i>exit</i> rule (sell when weekly close breaks below the 20-week moving average),
        shown for context — not used to filter or rank; ranked by furthest above its own 20W MA.
        <br /><br />
        <b>Mkt Cap / Sales G% / EBIT G% / EPS G% / DOL / DFL / DCL / F1-F3 / C1-C3 / Score / Verdict</b> are a separate layer, added on top of
        Hitesh Modi's own scan (not part of it) — the same Viraj Screen 6-rule check (see that tab's own methodology note for the exact rules),
        run against whichever names his scan returns that week. <b>F1</b> DOL &gt; 1.5, <b>F2</b> DFL &lt; 1.2, <b>F3</b> rising operating profit
        (from Screener.in), <b>C1</b> weekly RSI &gt; 66, <b>C2</b> price above 200-day EMA, <b>C3</b> 10/20-day EMA gap narrowing (both from
        Chartink, same as the Viraj tab). Unlike smeMomentum's version of this same check, Chartink's chart-check scans work fine here — this
        scan's own universe is main-board NSE stocks, not the SME segment Chartink doesn't reliably cover. A stock still shows{" "}
        <b>"NO DATA"</b> if Screener.in simply doesn't have its fundamentals.
      </>
    ),
    smeMomentum: (
      <>
        A separate universe from every other tab here: the <b>NSE Emerge (SME) platform</b>, not the NSE 750 main-board list — added after a
        YouTube video's case for SME-platform stocks as a source of better returns. Ranked the same way <b>weekendInvesting</b> ranks the main
        board — pure trailing <b>1-year price return</b>, no benchmark, no fundamentals — except the return itself is read straight off NSE's
        own Emerge live feed rather than computed from a yfinance price history fetch (unverified for these thinly-traded names). Unlike
        weekendInvesting's top-20 cap (which mirrors an actual 20-stock portfolio rule), there's no equivalent rule here — every scored stock
        is shown, full list, no cut line. A stock listed under a year (no trustworthy 1-year figure from NSE yet) is left out entirely rather
        than estimated from its 30-day number, which is shown for context only. <b>Read the risk side too, not just the
        return</b>: SME stocks trade in far lower volumes than main-board names, have looser disclosure requirements, and can move sharply on
        very little news — a return number here says nothing about how easily a position could actually be exited.
        {" "}<b>Unlike every other tab here, this doesn't refresh on a schedule</b> — NSE's SME data feed times out from Vercel, so this
        runs as a local script (the SmeMomentum skill) whenever it's asked for, not automatically.
        <br /><br />
        <b>Sales G% / EBIT G% / EPS G% / DOL / DFL / DCL / F1-F3 / C1-C3 / Score / Verdict</b> are the same 6-rule check the{" "}
        <b>Viraj Screen</b> tab uses (see its own methodology note for the exact rules) — <b>F1</b> DOL &gt; 1.5, <b>F2</b> DFL &lt; 1.2,{" "}
        <b>F3</b> rising operating profit (from Screener.in), <b>C1</b> weekly RSI &gt; 66, <b>C2</b> price above 200-day EMA,{" "}
        <b>C3</b> 10/20-day EMA gap narrowing (from Yahoo Finance's own price history, computed here — Chartink, which the Viraj tab uses for
        this, doesn't reliably cover the SME segment). Two real, checked-not-guessed coverage gaps: only <b>~77%</b> of SME stocks have real
        quarterly numbers on Screener.in (the rest show "—" for every fundamentals column, not a zero), and only <b>~43%</b> have price history
        on Yahoo Finance under their NSE ticker at all (the rest show "—" for C1-C3). A stock missing all of it shows <b>"NO DATA"</b> rather
        than a misleading score. <b>Mkt Cap / ₹ Off High</b> are new context columns — market cap from Screener.in (same ~77% coverage), and
        ₹ Off High is the rupee gap to the 52-week high (year_high − close), alongside the existing % Off High.
      </>
    ),
    volumeRockers: (
      <>
        Today's up-movers with the biggest volume spike vs. their own recent trading — same idea as a shared "Biggest Action of the Day / Top
        20 High Volume &amp; High Gain Stocks" reference table. Two conditions: <b>Day Chg %</b> must be positive (a gainer — this screen
        deliberately excludes decliners, even ones with a bigger volume spike), <b>and</b> there's enough history for a trailing baseline.
        Ranked by <b>Volume Change ×</b> = today's volume ÷ the average of the <b>prior 22 trading days'</b> volume (roughly one trading month,
        deliberately excluding today itself — including it would let a huge spike day inflate its own baseline and understate its own ratio).
        Top 20 shown. <b>Turnover (₹ Cr)</b> = today's volume × LTP, in crores — an approximation of true turnover (the sum of every trade's
        price × quantity through the day), which isn't recoverable from a single end-of-day bar; volume × close is the standard stand-in when
        only daily bars are available. No market-cap or minimum-volume floor, same reasoning as MA Breakout/Value RSI Turnaround elsewhere in
        this app: no bulk market-cap source across 750 stocks, and the NSE 750 universe's own inclusion bar already excludes true microcaps in
        practice.
      </>
    ),
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">📈 Momentum Screeners</h1>
        <span className="text-slate-500 text-sm">NSE 750 (Nifty Total Market)</span>
        <button
          onClick={doRefresh}
          disabled={refreshing}
          className="ml-auto text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "🔄 Refresh"}
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Four independent momentum strategies, refreshed automatically on Vercel (RS daily, the other 3 weekly) — "Run now" triggers an on-demand run from any machine.
      </p>

      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {TABS.map((t) => {
          const e = bundle.momentum_screeners[t.key];
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`text-sm px-3 py-2 border-b-2 -mb-px font-medium ${
                active ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.emoji} {t.label}
              {e?.rows?.length ? <span className="ml-1.5 text-[11px] text-slate-400">({e.rows.length})</span> : null}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 mb-3">
        {entry?.as_of && <span className="text-xs text-slate-400">as of {entry.as_of}</span>}
        {/* key={tab} — remounts fresh per tab so a "Running…"/"Done"
            status left over from another screener's run doesn't
            bleed into this one (RunButton keeps its own useState;
            without a per-tab key React reuses the same instance
            across tab switches instead of resetting it). */}
        <RunButton key={tab} screener={tab} />
      </div>

      <MethodologyNote>{METHODOLOGY[tab]}</MethodologyNote>

      {/* key={tab} — remounts fresh per tab so search/sector/sort
          state doesn't leak from one screener's filters into the
          next (e.g. a sector selection that doesn't exist there). */}
      <GenericTable key={tab} rows={rows} cols={COLS[tab]} navigate={(t) => navigate(`/company/${t}`)} watchlist={watchlist} />
    </div>
  );
}
