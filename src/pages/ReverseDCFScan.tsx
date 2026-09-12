import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import { lastActual } from "../lib/model";
import { solveReverseDcf } from "../lib/reverseDcf";
import { Col, GenericTable, MethodologyNote, Signed, fmtNum } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";

// Added 2026-09-12 — "found another way to calculate reverse dcf
// [Amit Chandan's webinar]... run this across all our stocks and
// create a list, will help to choose the stocks easily". Watched
// through that video's core sections (chapter markers + on-screen
// Excel model, since the transcript panel wouldn't load for this
// video) before building: it's the SAME 2-stage reverse DCF this app
// already has on /reverse-dcf — explicit growth for years 1-10, a
// terminal growth rate (his own default: ~3%, pegged to GDP), a
// discount rate, the identical PV formula, market cap as the target
// to solve backward from. The one real difference is a data-source
// detail, not a different method: he starts from trailing-12-month
// Free Cash Flow read straight off the cash flow statement, rather
// than reconstructing it via Revenue × Margin like this app's model
// does. Not worth a second calculator for that alone — so rather than
// duplicate the (already verified) math, this page reuses
// src/lib/reverseDcf.ts's solveReverseDcf across every company already
// in this app's ledger (bundle.stocks) and ranks them, which is the
// actual ask: a list to scan instead of checking one stock at a time.
//
// Every row uses the SAME default assumptions the single-stock
// /reverse-dcf page pre-fills (12% WACC, 5% terminal growth, 10-year
// projection, 0% net capex/ΔWC, tax/margin/net debt from each stock's
// own last actuals) — this is a screen, not a per-stock deep dive, so
// there's no per-row assumption editing here. Open a stock's own
// /reverse-dcf entry (linked per row) to adjust its assumptions.
const DEFAULT_WACC = 12;
const DEFAULT_TERMINAL_GROWTH = 5;
const DEFAULT_YEARS = 10;

function computeRow(ticker: string, stock: any) {
  const currentRevenueCr = lastActual(stock.revenue);
  const marketCapCr = stock.market_cap_cr ?? null;
  const netDebtCr = lastActual(stock.borrowings) ?? 0;
  const marginPct = lastActual(stock.opm_pct) ?? 15;
  const taxRatePct = lastActual(stock.tax_pct) ?? 25;
  const hist = (stock.revenue_growth_pct ?? []).filter((v: any): v is number => v !== null && v !== undefined);
  const avg3yGrowth = hist.length ? hist.slice(-3).reduce((s: number, v: number) => s + v, 0) / Math.min(3, hist.length) : null;

  if (currentRevenueCr === null || currentRevenueCr <= 0 || marketCapCr === null) return null;
  const targetEvCr = marketCapCr + netDebtCr;

  const { impliedGrowthPct } = solveReverseDcf({
    currentRevenueCr,
    sustainableMarginPct: marginPct,
    taxRatePct,
    waccPct: DEFAULT_WACC,
    years: DEFAULT_YEARS,
    terminalGrowthPct: DEFAULT_TERMINAL_GROWTH,
    netCapexPctOfRevenue: 0,
    wcPctOfIncrementalRevenue: 0,
    targetEvCr,
  });

  const gap = impliedGrowthPct !== null && avg3yGrowth !== null ? avg3yGrowth - impliedGrowthPct : null;
  const verdict = gap === null ? null : gap > 3 ? "conservative" : gap < -3 ? "aggressive" : "in line";

  return {
    symbol: ticker,
    name: stock.name ?? ticker,
    price: stock.current_price,
    marketCapCr,
    impliedGrowthPct,
    avg3yGrowth,
    gap,
    verdict,
  };
}

const COLS: Col[] = [
  { key: "rank", label: "Rank" },
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "name", label: "Name", align: "left" },
  { key: "price", label: "Price", render: (r) => fmtNum(r.price, 2) },
  { key: "marketCapCr", label: "Market Cap", render: (r) => (r.marketCapCr != null ? `${fmtNum(r.marketCapCr, 0)} Cr` : "—") },
  {
    key: "impliedGrowthPct",
    label: "Implied 10Y Growth",
    render: (r) => (r.impliedGrowthPct !== null ? <Signed v={r.impliedGrowthPct} digits={1} /> : "—"),
  },
  {
    key: "avg3yGrowth",
    label: "3Y Avg Growth",
    render: (r) => (r.avg3yGrowth !== null ? <Signed v={r.avg3yGrowth} digits={1} /> : "—"),
  },
  {
    key: "gap",
    label: "Gap (Avg − Implied)",
    render: (r) =>
      r.gap !== null ? (
        <span className={r.gap > 3 ? "text-emerald-700 font-semibold" : r.gap < -3 ? "text-red-600 font-semibold" : ""}>
          <Signed v={r.gap} digits={1} />
        </span>
      ) : (
        "—"
      ),
  },
  {
    key: "verdict",
    label: "Verdict",
    render: (r) =>
      r.verdict ? (
        <span
          className={`text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${
            r.verdict === "conservative"
              ? "bg-emerald-50 text-emerald-700 border-emerald-300"
              : r.verdict === "aggressive"
                ? "bg-red-50 text-red-600 border-red-300"
                : "bg-slate-100 text-slate-500 border-slate-300"
          }`}
        >
          {r.verdict}
        </span>
      ) : (
        <span className="text-slate-300">—</span>
      ),
  },
];

// 2026-09-12 ("also in dcf scan lets do it for all NSETop750Companies
// ... which should be obviously change to daily changes") — a second
// source: every stock across the NSE 750 (Nifty Total Market), pushed
// server-side by api/momentum_screeners.py's reverseDcfScanNse750
// (see that function's own module comment for the batched-cron design
// that makes a 750-stock daily refresh possible within Vercel's
// per-invocation time limit). Field names are snake_case here (the
// Python push's own JSON shape), unlike the ledger COLS above (which
// read the client-computed camelCase row shape) — kept as two
// separate Col arrays rather than reconciling the naming, since the
// two sources are genuinely different (one computed here in the
// browser from bundle.stocks, one computed server-side and pushed).
const NSE750_COLS: Col[] = [
  { key: "rank", label: "Rank" },
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "name", label: "Name", align: "left" },
  { key: "price", label: "Price", render: (r) => fmtNum(r.price, 2) },
  { key: "market_cap_cr", label: "Market Cap", render: (r) => (r.market_cap_cr != null ? `${fmtNum(r.market_cap_cr, 0)} Cr` : "—") },
  {
    key: "implied_growth_pct",
    label: "Implied 10Y Growth",
    render: (r) => (r.implied_growth_pct !== null && r.implied_growth_pct !== undefined ? <Signed v={r.implied_growth_pct} digits={1} /> : "—"),
  },
  {
    key: "avg_3y_growth_pct",
    label: "3Y Avg Growth",
    render: (r) => (r.avg_3y_growth_pct !== null && r.avg_3y_growth_pct !== undefined ? <Signed v={r.avg_3y_growth_pct} digits={1} /> : "—"),
  },
  {
    key: "gap",
    label: "Gap (Avg − Implied)",
    render: (r) =>
      r.gap !== null && r.gap !== undefined ? (
        <span className={r.gap > 3 ? "text-emerald-700 font-semibold" : r.gap < -3 ? "text-red-600 font-semibold" : ""}>
          <Signed v={r.gap} digits={1} />
        </span>
      ) : (
        "—"
      ),
  },
  {
    key: "verdict",
    label: "Verdict",
    render: (r) =>
      r.verdict ? (
        <span
          className={`text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${
            r.verdict === "conservative"
              ? "bg-emerald-50 text-emerald-700 border-emerald-300"
              : r.verdict === "aggressive"
                ? "bg-red-50 text-red-600 border-red-300"
                : "bg-slate-100 text-slate-500 border-slate-300"
          }`}
        >
          {r.verdict}
        </span>
      ) : (
        <span className="text-slate-300">—</span>
      ),
  },
  { key: "as_of", label: "As of", align: "left", render: (r) => <span className="text-xs text-slate-400">{r.as_of ?? "—"}</span> },
];

export default function ReverseDCFScan() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const [source, setSource] = useState<"ledger" | "nse750">("ledger");

  const ledgerRows = useMemo(() => {
    const computed = Object.entries(bundle.stocks)
      .map(([ticker, stock]) => computeRow(ticker, stock))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    // Rank by Gap descending — the biggest "market is pricing in less
    // growth than this business has actually delivered" cases first,
    // the same read the single-stock page's own verdict text gives,
    // just sorted across the whole ledger instead of one stock at a
    // time. Rows with no computable gap (missing history) sort last.
    computed.sort((a, b) => {
      if (a.gap === null && b.gap === null) return 0;
      if (a.gap === null) return 1;
      if (b.gap === null) return -1;
      return b.gap - a.gap;
    });
    return computed.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [bundle.stocks]);

  const nse750Entry = bundle.momentum_screeners["reverseDcfScanNse750"];
  const nse750Rows = nse750Entry?.rows ?? [];

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">📋 Reverse DCF Scan</h1>
        <span className="text-slate-500 text-sm">Ranked by implied-vs-actual growth gap</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Runs the same <button className="underline" onClick={() => navigate("/reverse-dcf")}>Reverse DCF</button> math across a whole
        universe at once, using default assumptions for every stock (no per-stock tuning here) — a first-pass screen, not a final answer for
        any one name.
      </p>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setSource("ledger")}
          className={`text-xs px-3 py-1.5 rounded border ${source === "ledger" ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}
        >
          My Ledger ({ledgerRows.length})
        </button>
        <button
          onClick={() => setSource("nse750")}
          className={`text-xs px-3 py-1.5 rounded border ${source === "nse750" ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}
        >
          NSE 750 — daily ({nse750Rows.length})
        </button>
      </div>

      {source === "ledger" ? (
        <>
          <MethodologyNote>
            Every company already in this app's ledger, computed live in your browser from data already loaded — always fresh, but limited
            to whatever's been added to this app's own Companies list. Same default assumptions (12% WACC, 5% terminal growth, 10-year
            projection, 0% net capex/ΔWorking Capital) for every stock. <b>Gap</b> = 3-year average revenue growth minus implied growth — a
            large positive gap means the price is pricing in noticeably LESS growth than the business has actually delivered recently (worth
            a closer look on the single-stock page, with real assumptions for that specific company); a large negative gap means the price
            already assumes more growth than recent history. A stock with no computable gap sorts to the bottom rather than being dropped.
          </MethodologyNote>
          <GenericTable
            rows={ledgerRows}
            cols={COLS}
            navigate={(t) => navigate(`/company/${t}`)}
            watchlist={watchlist}
            emptyMessage="No companies in the ledger yet."
          />
        </>
      ) : (
        <>
          <MethodologyNote>
            Every stock across the NSE 750 (Nifty Total Market) — not just this app's own ledger. Refreshes DAILY, but not in one shot:
            fetching real fundamentals (revenue history, margin, tax, market cap, debt) needs one Screener.in request per stock, and 750 of
            those can't fit inside Vercel's 300-second function limit — so it runs as ~10 batches spread across the day (see the <b>As of</b>{" "}
            column), each covering its own slice of the universe. Every stock's own row is refreshed once per day, at its batch's scheduled
            time — the full list is always a complete, same-day picture by the time all batches have run. No manual "Run now" here (a
            single click would try to process all 750 at once and time out) — this is the same solver as the ledger view, just server-side
            and covering the whole market instead of only what you've added.
          </MethodologyNote>
          <GenericTable
            rows={nse750Rows}
            cols={NSE750_COLS}
            navigate={(t) => navigate(`/company/${t}`)}
            watchlist={watchlist}
            emptyMessage="No NSE 750 scan data yet — the daily batches haven't run for the first time yet."
          />
        </>
      )}
    </div>
  );
}
