import { useMemo } from "react";
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

export default function ReverseDCFScan() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const watchlist = useWatchlist();

  const rows = useMemo(() => {
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

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">📋 Reverse DCF Scan</h1>
        <span className="text-slate-500 text-sm">Every tracked company, ranked by implied-vs-actual growth gap</span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Runs the same <button className="underline" onClick={() => navigate("/reverse-dcf")}>Reverse DCF</button> math across every company
        already in this app's ledger, using default assumptions for all of them (no per-stock tuning here) — a first-pass screen, not a final
        answer for any one name.
      </p>

      <MethodologyNote>
        Same solver as the single-stock Reverse DCF page (see its own methodology note for the full FCFF/EV math) — every row here uses the
        SAME default assumptions (12% WACC, 5% terminal growth, 10-year projection, 0% net capex/ΔWorking Capital) rather than each stock's
        own tuned inputs, since this is meant as a first-pass scan across the whole ledger, not a per-stock verdict. <b>Gap</b> = 3-year
        average revenue growth minus implied growth — a large positive gap means the price is pricing in noticeably LESS growth than the
        business has actually delivered recently (worth a closer look on the single-stock page, with real assumptions for that specific
        company); a large negative gap means the price already assumes more growth than recent history, i.e. less margin for error. A stock
        with no computable gap (missing revenue history, or unresolvable EV) sorts to the bottom rather than being dropped, so the full
        ledger is always accounted for. Modeled on the same reverse-DCF concept Anshul Saigal's webinar and Amit Chandan's webinar both teach
        — see the single-stock page for that full background.
      </MethodologyNote>

      <GenericTable rows={rows} cols={COLS} navigate={(t) => navigate(`/company/${t}`)} watchlist={watchlist} emptyMessage="No companies in the ledger yet." />
    </div>
  );
}
