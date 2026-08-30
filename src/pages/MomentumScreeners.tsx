import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import RunButton from "../components/RunButton";
import { Col, fmtNum, GenericTable, MethodologyNote, NSE_SCREENER_COLS, PriceLink, Signed } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";

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
        <b>Alpha</b> = a sector's ETF return minus NIFTY 500's return, over 1M/3M/6M/1Y. <b>Alpha Score</b> is a recency-weighted blend — 40%
        (1M) / 30% (3M) / 20% (6M) / 10% (1Y). <b>Zone</b> = top third of the ranked list is "Leader", bottom third "Laggard", the rest
        "Middle". <b>New High?</b> = the sector's price-to-NIFTY500 ratio is at its highest point in the fetched window. 21 sectors are covered
        via their most liquid NSE-listed ETF, not the raw index (several raw NSE sector indices are stale on this data source) — Media, Consumer
        Durables, Chemicals, Energy, Services, and Capital Markets aren't included: either no liquid ETF exists, or it's too newly listed for a
        trustworthy 1-year number yet.
      </>
    ),
    sectorStockAlpha: (
      <>
        The drill-down under Sector Alpha: <b>Alpha</b> = a stock's own return minus <i>its sector's</i> return (not the market's), same
        1M/3M/6M/1Y windows and 40/30/20/10% weighting as Sector Alpha. "Sector" here is NSE's own industry classification (not the ETF list
        above) — each industry's return is computed bottom-up as the plain average of its own constituent stocks' returns, so every real
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
        <RunButton screener={tab} />
      </div>

      <MethodologyNote>{METHODOLOGY[tab]}</MethodologyNote>

      {/* key={tab} — remounts fresh per tab so search/sector/sort
          state doesn't leak from one screener's filters into the
          next (e.g. a sector selection that doesn't exist there). */}
      <GenericTable key={tab} rows={rows} cols={COLS[tab]} navigate={(t) => navigate(`/company/${t}`)} watchlist={watchlist} />
    </div>
  );
}
