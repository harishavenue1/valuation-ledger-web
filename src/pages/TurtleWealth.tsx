import { useNavigate } from "react-router-dom";
import { useData, useScreeners } from "../App";
import { Col, GenericTable, MethodologyNote, ScreenerLoading, Signed, fmtNum, PriceLink } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";

// Added 2026-09-13 ("lets build one more page turtleWealth on main
// page logic is very simple NSE750 Universe, ALL TIME PRICE, SALES,
// PROFIT") after the user shared screenshots of Turtle Wealth's own
// "Stock Selection Process" slide (turtlewealth.in, a SEBI-registered
// Portfolio Manager INP000006758 / RA INH000019868 — full framework
// at turtlewealth.in/turtle-quant-process/). Their real process is 5
// pillars: All-Time-High Price (Technical) -> All-Time-High Profit
// (Fundamental) -> All-Time-High Outperformance (Momentum) ->
// Pre-Decided Exit (Downside Protection) -> Dynamic Risk Allocation
// (Risk Control), plus a scoring slide (ADD/HOLD/EXIT by how many of
// ATH Price / ATH Profit / Outperformance-vs-sector-and-BSE500 a
// stock meets). This page is DELIBERATELY only the first slice: ATH
// PRICE + ATH SALES + ATH PROFIT, exactly what was asked for — no
// Outperformance/Exit/Risk-Allocation legs yet (Outperformance-vs-
// sector and a "Turtle Exit Price" rule aren't defined anywhere
// public, so there's nothing concrete to replicate for those without
// guessing at Turtle Wealth's own proprietary thresholds).
//
// Server-side, batched across ~10 daily cron runs (api/
// momentum_screeners.py's _run_turtle_wealth_nse750) — same design as
// reverseDcfScanNse750, for the same reason: 750 stocks' annual P&L
// history each needs its own rate-limited Screener.in request, which
// can't fit inside Vercel's per-invocation time limit in one shot. No
// manual "Run now" here for the same reason that screener has none.

const COLS: Col[] = [
  { key: "rank", label: "Rank" },
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "name", label: "Name", align: "left" },
  { key: "sector", label: "Sector", align: "left" },
  { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
  { key: "pct_off_ath", label: "% Off ATH", render: (r) => (r.pct_off_ath !== null && r.pct_off_ath !== undefined ? <Signed v={r.pct_off_ath} digits={1} /> : "—") },
  {
    key: "price_ath",
    label: "ATH Price",
    render: (r) => (r.price_ath === true ? <span className="text-emerald-600 font-semibold">✓</span> : r.price_ath === false ? <span className="text-slate-300">—</span> : <span className="text-slate-300">?</span>),
  },
  { key: "latest_sales_cr", label: "Latest Sales", render: (r) => (r.latest_sales_cr != null ? `${fmtNum(r.latest_sales_cr, 0)} Cr` : "—") },
  {
    key: "sales_ath",
    label: "ATH Sales",
    render: (r) => (r.sales_ath === true ? <span className="text-emerald-600 font-semibold">✓</span> : r.sales_ath === false ? <span className="text-slate-300">—</span> : <span className="text-slate-300">?</span>),
  },
  { key: "latest_profit_cr", label: "Latest Profit", render: (r) => (r.latest_profit_cr != null ? `${fmtNum(r.latest_profit_cr, 0)} Cr` : "—") },
  {
    key: "profit_ath",
    label: "ATH Profit",
    render: (r) => (r.profit_ath === true ? <span className="text-emerald-600 font-semibold">✓</span> : r.profit_ath === false ? <span className="text-slate-300">—</span> : <span className="text-slate-300">?</span>),
  },
  {
    key: "alpha_52w",
    label: "Alpha (52W vs NSE500)",
    render: (r) => (r.alpha_52w !== null && r.alpha_52w !== undefined ? <Signed v={r.alpha_52w} digits={1} /> : "—"),
  },
  {
    key: "all_three",
    label: "All 3",
    render: (r) =>
      r.all_three ? (
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap bg-emerald-50 text-emerald-700 border-emerald-300">ADD</span>
      ) : (
        <span className="text-slate-300">—</span>
      ),
  },
  { key: "as_of", label: "As of", align: "left", render: (r) => <span className="text-xs text-slate-400">{r.as_of ?? "—"}</span> },
];

export default function TurtleWealth() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const { ready } = useScreeners(["turtleWealth"]);

  const entry = bundle.momentum_screeners["turtleWealth"];
  const rows = entry?.rows ?? [];
  const allThreeCount = rows.filter((r: any) => r.all_three).length;

  if (!ready) return <ScreenerLoading label="Turtle Wealth" />;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">🐢 Turtle Wealth</h1>
        <span className="text-slate-500 text-sm">All-Time-High Price + Sales + Profit, across NSE 750</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Modeled on{" "}
        <a href="https://turtlewealth.in/turtle-quant-process/" target="_blank" rel="noreferrer" className="underline">
          Turtle Wealth's own Stock Selection Process
        </a>{" "}
        (turtlewealth.in — SEBI Portfolio Manager INP000006758 / RA INH000019868) — the first 2 of their 5 pillars (All-Time-High Price,
        All-Time-High Profit), plus All-Time-High Sales alongside profit. {allThreeCount} of {rows.length} stocks currently meet all three.
      </p>

      <MethodologyNote>
        <b>ATH Price</b> reuses this app's own All-Time High screener logic: at/within 3% of the highest weekly close in however much yfinance
        weekly history is available (at least ~1 year required). <b>ATH Sales</b>/<b>ATH Profit</b> check whether the LATEST annual figure in
        Screener.in's own P&L table (however many years back that table goes — typically ~10-12) is the highest value in that table — not a
        claim to verify the company's literal entire listed history beyond what Screener's table shows. <b>Alpha (52W vs NSE500)</b>{" "}
        (2026-09-13) is the stock's own trailing 52-week return minus NIFTY 500's (^CRSLDX, same house benchmark
        Nifty500RelativeStrength/sectorStockAlpha already use) over the identical window — a step toward Turtle Wealth's 3rd pillar,
        All-Time-High Outperformance, but not the full thing: it's a single 52-week snapshot vs one broad index, not an all-time-high
        Outperformance check vs both sector AND BSE500 the way their own ADD/HOLD/EXIT scoring slide defines it. Reference only — not
        currently part of the <b>All 3</b>/"ADD" tag below. <b>All 3</b> = "ADD" tags every stock meeting ATH Price + ATH Sales + ATH Profit
        at once, Turtle Wealth's own "Super Performers" bucket minus the Outperformance-vs-sector-and-BSE500 leg (not replicated here — their
        exact thresholds for that, and for their "Turtle Exit Price" downside rule and dynamic risk allocation, aren't published anywhere
        public to replicate honestly). Refreshes across ~10 batched daily runs (same reason and design as the Reverse DCF
        Scan's own NSE 750 tab — 750 stocks' annual financials each need their own rate-limited Screener.in fetch, which can't fit inside one
        Vercel invocation) — see each row's own <b>As of</b> date. No manual "Run now" for the same reason.
      </MethodologyNote>

      <GenericTable
        rows={rows}
        cols={COLS}
        navigate={(t) => navigate(`/company/${t}`)}
        watchlist={watchlist}
        emptyMessage="No Turtle Wealth scan data yet — the daily batches haven't run for the first time yet."
      />
    </div>
  );
}
