import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useData, useScreeners } from "../App";
import { lastActual } from "../lib/model";
import { computeStagedDcf, solveReverseDcf } from "../lib/reverseDcf";
import { getGrowthOverride } from "../lib/reverseDcfOverrides";
import { Col, GenericTable, MethodologyNote, ScreenerLoading, Signed, fmtNum, PriceLink } from "../components/ScreenerTable";
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
// src/lib/reverseDcf.ts across every company already in this app's
// ledger (bundle.stocks) and ranks them, which is the actual ask: a
// list to scan instead of checking one stock at a time.
//
// Every row uses the SAME default assumptions the single-stock
// /reverse-dcf page pre-fills (12% WACC, 5% terminal growth, 10-year
// projection, 0% net capex/ΔWC, tax/margin/net debt from each stock's
// own last actuals) — this is a screen, not a per-stock deep dive, so
// there's no per-row assumption editing here. Open a stock's own
// /reverse-dcf entry (linked per row) to adjust its assumptions.
//
// Rebuilt 2026-09-13 ("Reverse DCF Scan is not exactly as per logic we
// built later on Rev DCF Page") — the single-stock page moved on
// 2026-09-12 to a STAGED growth model (3 hand-edited stages, headline
// = implied price + undervalued/overvalued verdict), demoting the flat
// solved rate to a reference/seed value only. This page can't ask for
// 3 hand-tuned inputs per company at scan scale, so it applies ONE
// fixed, universal decay rule to every stock's own flat solved rate
// (confirmed with Harish before building, "fixed universal decay
// rule" over "keep flat" or "show both"):
//   stage 1 (yrs 1-3)  = the flat solved rate itself
//   stage 2 (yrs 4-6)  = 70% of the flat rate
//   stage 3 (yrs 7-10) = 40% of the flat rate, floored at the terminal
//                         growth rate (growth shouldn't realistically
//                         dip BELOW the perpetual rate right before
//                         hitting it)
// This is a genuinely new assumption (not something "already built"),
// worth sanity-checking against a few real stocks before trusting the
// resulting verdicts at scale — same spirit as every other bulk-scan
// default in this app.
const DEFAULT_WACC = 12;
const DEFAULT_TERMINAL_GROWTH = 5;
const DEFAULT_YEARS = 10;
const STAGE2_DECAY = 0.7;
const STAGE3_DECAY = 0.4;

// Reworked 2026-09-13 ("we cant apply generic rates across we need
// specific, so its better you give a link from scan page to main
// page, were we can override and same can reflect back to scan
// page") — a blanket single growth path applied to every stock
// (shipped hours earlier the same session) is gone. Per-ticker
// instead: each row checks localStorage (getGrowthOverride, see
// src/lib/reverseDcfOverrides.ts) for a growth path YOU saved for
// THAT specific stock on its own /reverse-dcf page — present, it's
// staged straight from your 3 numbers; absent (the default for every
// stock until you explicitly save one), it's the existing fixed-decay
// rule off that stock's own market-implied rate, completely
// unchanged. The "✏️ Edit growth" link per row (below) is how you get
// to /reverse-dcf to set one.
function computeRow(ticker: string, stock: any) {
  const currentRevenueCr = lastActual(stock.revenue);
  const marketCapCr = stock.market_cap_cr ?? null;
  const price = stock.current_price ?? null;
  const netDebtCr = lastActual(stock.borrowings) ?? 0;
  const marginPct = lastActual(stock.opm_pct) ?? 15;
  const taxRatePct = lastActual(stock.tax_pct) ?? 25;
  const hist = (stock.revenue_growth_pct ?? []).filter((v: any): v is number => v !== null && v !== undefined);
  const avg3yGrowth = hist.length ? hist.slice(-3).reduce((s: number, v: number) => s + v, 0) / Math.min(3, hist.length) : null;

  if (currentRevenueCr === null || currentRevenueCr <= 0 || marketCapCr === null) return null;
  const targetEvCr = marketCapCr + netDebtCr;

  const stagedInputs = {
    currentRevenueCr,
    sustainableMarginPct: marginPct,
    taxRatePct,
    waccPct: DEFAULT_WACC,
    terminalGrowthPct: DEFAULT_TERMINAL_GROWTH,
    netCapexPctOfRevenue: 0,
    wcPctOfIncrementalRevenue: 0,
  };

  const { impliedGrowthPct: flatGrowthPct } = solveReverseDcf({ ...stagedInputs, years: DEFAULT_YEARS, targetEvCr });
  const customGrowth = getGrowthOverride(ticker);

  let valuationGapPct: number | null = null;
  let verdict: string | null = null;
  let impliedPricePerShare: number | null = null;
  // A saved per-ticker override doesn't need a solved flat rate at
  // all — it can stage straight from your 3 saved numbers, so it
  // still values a stock the market-implied path couldn't (e.g. a
  // negative-margin story where solveReverseDcf has nothing to
  // converge on). Auto-decay mode is unchanged, still gated on
  // flatGrowthPct !== null exactly as before.
  if (customGrowth !== null || flatGrowthPct !== null) {
    const staged = computeStagedDcf(
      customGrowth !== null
        ? { ...stagedInputs, ...customGrowth }
        : { ...stagedInputs, stage1Pct: flatGrowthPct!, stage2Pct: flatGrowthPct! * STAGE2_DECAY, stage3Pct: Math.max(flatGrowthPct! * STAGE3_DECAY, DEFAULT_TERMINAL_GROWTH) },
    );
    valuationGapPct = ((staged.totalEvCr - targetEvCr) / targetEvCr) * 100;
    verdict = valuationGapPct > 10 ? "undervalued" : valuationGapPct < -10 ? "overvalued" : "fairly valued";
    const sharesCr = price && price > 0 ? marketCapCr / price : null; // derived, not stored — always available wherever marketCap+price are
    const impliedEquityCr = staged.totalEvCr - netDebtCr;
    impliedPricePerShare = sharesCr && sharesCr > 0 ? impliedEquityCr / sharesCr : null;
  }

  return {
    symbol: ticker,
    name: stock.name ?? ticker,
    price,
    marketCapCr,
    impliedPricePerShare,
    valuationGapPct,
    verdict,
    flatGrowthPct,
    avg3yGrowth,
    usingCustomGrowth: customGrowth !== null,
  };
}

// 2026-09-13 ("its better you give a link from scan page to main
// page, were we can override and same can reflect back to scan
// page") — every row's way in to /reverse-dcf to set (or edit) that
// specific stock's own growth path. stopPropagation keeps this from
// also triggering GenericTable's own row-click-to-navigate-to-company
// behavior.
function GrowthLink({ symbol, usingCustomGrowth }: { symbol: string; usingCustomGrowth?: boolean }) {
  return (
    <Link
      to={`/reverse-dcf?ticker=${encodeURIComponent(symbol)}`}
      onClick={(e) => e.stopPropagation()}
      className={`text-[11px] whitespace-nowrap underline ${usingCustomGrowth ? "text-emerald-700 font-medium" : "text-slate-400"}`}
      title={usingCustomGrowth ? "Using your own saved growth for this stock — click to edit" : "Using auto-decayed market-implied growth — click to set your own"}
    >
      {usingCustomGrowth ? "✏️ custom" : "✏️ auto"}
    </Link>
  );
}

const COLS: Col[] = [
  { key: "rank", label: "Rank" },
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "name", label: "Name", align: "left" },
  { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
  { key: "marketCapCr", label: "Market Cap", render: (r) => (r.marketCapCr != null ? `${fmtNum(r.marketCapCr, 0)} Cr` : "—") },
  {
    key: "impliedPricePerShare",
    label: "Implied Price (staged)",
    render: (r) => (r.impliedPricePerShare !== null ? fmtNum(r.impliedPricePerShare, 2) : "—"),
  },
  {
    key: "valuationGapPct",
    label: "Valuation Gap",
    render: (r) =>
      r.valuationGapPct !== null ? (
        <span className={r.valuationGapPct > 10 ? "text-emerald-700 font-semibold" : r.valuationGapPct < -10 ? "text-red-600 font-semibold" : ""}>
          <Signed v={r.valuationGapPct} digits={1} />
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
            r.verdict === "undervalued"
              ? "bg-emerald-50 text-emerald-700 border-emerald-300"
              : r.verdict === "overvalued"
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
  {
    key: "flatGrowthPct",
    label: "Flat Implied Growth (ref)",
    render: (r) => (r.flatGrowthPct !== null ? <Signed v={r.flatGrowthPct} digits={1} /> : "—"),
  },
  { key: "growthLink", label: "Growth", render: (r) => <GrowthLink symbol={r.symbol} usingCustomGrowth={r.usingCustomGrowth} /> },
  {
    key: "avg3yGrowth",
    label: "3Y Avg Growth (ref)",
    render: (r) => (r.avg3yGrowth !== null ? <Signed v={r.avg3yGrowth} digits={1} /> : "—"),
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
  { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
  { key: "market_cap_cr", label: "Market Cap", render: (r) => (r.market_cap_cr != null ? `${fmtNum(r.market_cap_cr, 0)} Cr` : "—") },
  {
    key: "implied_price_per_share",
    label: "Implied Price (staged)",
    render: (r) => (r.implied_price_per_share !== null && r.implied_price_per_share !== undefined ? fmtNum(r.implied_price_per_share, 2) : "—"),
  },
  {
    key: "valuation_gap_pct",
    label: "Valuation Gap",
    render: (r) =>
      r.valuation_gap_pct !== null && r.valuation_gap_pct !== undefined ? (
        <span className={r.valuation_gap_pct > 10 ? "text-emerald-700 font-semibold" : r.valuation_gap_pct < -10 ? "text-red-600 font-semibold" : ""}>
          <Signed v={r.valuation_gap_pct} digits={1} />
          {r.growthOverrideUnavailable && (
            <span title="Your growth override isn't applied to this row yet — raw inputs haven't been backfilled by its daily batch. Showing market-implied instead." className="text-amber-500 ml-1 cursor-help">
              *
            </span>
          )}
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
            r.verdict === "undervalued"
              ? "bg-emerald-50 text-emerald-700 border-emerald-300"
              : r.verdict === "overvalued"
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
  {
    key: "flat_growth_pct",
    label: "Flat Implied Growth (ref)",
    render: (r) => (r.flat_growth_pct !== null && r.flat_growth_pct !== undefined ? <Signed v={r.flat_growth_pct} digits={1} /> : "—"),
  },
  { key: "growthLink", label: "Growth", render: (r) => <GrowthLink symbol={r.symbol} usingCustomGrowth={r.usingCustomGrowth} /> },
  {
    key: "avg_3y_growth_pct",
    label: "3Y Avg Growth (ref)",
    render: (r) => (r.avg_3y_growth_pct !== null && r.avg_3y_growth_pct !== undefined ? <Signed v={r.avg_3y_growth_pct} digits={1} /> : "—"),
  },
  { key: "as_of", label: "As of", align: "left", render: (r) => <span className="text-xs text-slate-400">{r.as_of ?? "—"}</span> },
];

// Reworked 2026-09-13 (see computeRow's own comment above for the
// full "why") — recomputes ONE NSE750 row's staged valuation
// client-side against a per-ticker override YOU saved on that stock's
// own /reverse-dcf page, reusing the exact same computeStagedDcf()
// the ledger tab and single-stock page both call. Needs the 4 raw
// inputs (revenue_cr/margin_pct/tax_pct/net_debt_cr) the server has
// pushed alongside every NSE750 row since this same change — a row
// from BEFORE that backend deploy (or not yet re-scanned by its own
// daily batch) won't have them yet, so falls back to the server's own
// market-implied figures for that row rather than silently showing
// nothing (flagged via growthOverrideUnavailable, see NSE750_COLS'
// Valuation Gap column).
function recomputeNse750Row(row: any) {
  const customGrowth = getGrowthOverride(row.symbol);
  if (customGrowth === null) return { ...row, usingCustomGrowth: false };
  if (row.revenue_cr == null || row.margin_pct == null || row.tax_pct == null) return { ...row, usingCustomGrowth: false, growthOverrideUnavailable: true };
  const netDebtCr = row.net_debt_cr ?? 0;
  const targetEvCr = (row.market_cap_cr ?? 0) + netDebtCr;
  const staged = computeStagedDcf({
    currentRevenueCr: row.revenue_cr,
    sustainableMarginPct: row.margin_pct,
    taxRatePct: row.tax_pct,
    waccPct: DEFAULT_WACC,
    terminalGrowthPct: DEFAULT_TERMINAL_GROWTH,
    netCapexPctOfRevenue: 0,
    wcPctOfIncrementalRevenue: 0,
    ...customGrowth,
  });
  const valuation_gap_pct = targetEvCr > 0 ? ((staged.totalEvCr - targetEvCr) / targetEvCr) * 100 : null;
  const verdict = valuation_gap_pct === null ? null : valuation_gap_pct > 10 ? "undervalued" : valuation_gap_pct < -10 ? "overvalued" : "fairly valued";
  const price = row.price;
  const sharesCr = price && price > 0 ? (row.market_cap_cr ?? 0) / price : null;
  const impliedEquityCr = staged.totalEvCr - netDebtCr;
  const implied_price_per_share = sharesCr && sharesCr > 0 ? impliedEquityCr / sharesCr : null;
  return { ...row, implied_price_per_share, valuation_gap_pct, verdict, usingCustomGrowth: true };
}

export default function ReverseDCFScan() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const [source, setSource] = useState<"ledger" | "nse750">("ledger");
  // Only fetches the NSE750 scan data once you actually switch to that
  // tab — the "My Ledger" default needs nothing beyond bundle.stocks.
  const { ready: nse750Ready } = useScreeners(source === "nse750" ? ["reverseDcfScanNse750"] : []);

  const ledgerRows = useMemo(() => {
    const computed = Object.entries(bundle.stocks)
      .map(([ticker, stock]) => computeRow(ticker, stock))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    // Rank by Valuation Gap descending — most-undervalued-by-the-staged-
    // DCF first, matching the single-stock page's own verdict logic
    // just applied across the whole ledger instead of one stock at a
    // time. Rows with no computable gap (missing fundamentals) sort last.
    computed.sort((a, b) => {
      if (a.valuationGapPct === null && b.valuationGapPct === null) return 0;
      if (a.valuationGapPct === null) return 1;
      if (b.valuationGapPct === null) return -1;
      return b.valuationGapPct - a.valuationGapPct;
    });
    return computed.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [bundle.stocks]);

  const nse750Entry = bundle.momentum_screeners["reverseDcfScanNse750"];
  const nse750Rows = useMemo(() => {
    // Re-sort every time (cheap even at 750 rows) rather than only when
    // some override exists — a saved per-ticker override only ever
    // perturbs its own row's gap, so this is the simplest correct
    // approach rather than tracking whether anything actually changed.
    const recomputed = (nse750Entry?.rows ?? []).map((r: any) => recomputeNse750Row(r));
    recomputed.sort((a: any, b: any) => {
      if (a.valuation_gap_pct == null && b.valuation_gap_pct == null) return 0;
      if (a.valuation_gap_pct == null) return 1;
      if (b.valuation_gap_pct == null) return -1;
      return b.valuation_gap_pct - a.valuation_gap_pct;
    });
    return recomputed.map((r: any, i: number) => ({ ...r, rank: i + 1 }));
  }, [nse750Entry]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">📋 Reverse DCF Scan</h1>
        <span className="text-slate-500 text-sm">Ranked by staged-DCF valuation gap</span>
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

      {/* 2026-09-13 ("we cant apply generic rates across we need
          specific, so its better you give a link from scan page to
          main page, were we can override and same can reflect back
          to scan page") — replaces the earlier same-day blanket
          override (one growth path for every row) with a per-row
          "✏️ Growth" link (in the table below) to that specific
          stock's own /reverse-dcf page, where a saved override
          reflects straight back here. No page-level toggle needed
          anymore — every row already shows whether it's using a
          saved custom path ("✏️ custom") or the default auto-decay
          ("✏️ auto"). */}

      {source === "ledger" ? (
        <>
          <MethodologyNote>
            Every company already in this app's ledger, computed live in your browser from data already loaded — always fresh, but limited
            to whatever's been added to this app's own Companies list. Same default assumptions (12% WACC, 5% terminal growth, 10-year
            projection, 0% net capex/ΔWorking Capital) for every stock, matching the single-stock <b>/reverse-dcf</b> page's own defaults.
            Since a scan can't ask for 3 hand-tuned growth stages per company, each stock's own flat solved rate is decayed by ONE fixed rule
            applied uniformly: <b>years 1-3</b> = the flat rate, <b>years 4-6</b> = 70% of it, <b>years 7-10</b> = 40% of it (floored at the
            5% terminal growth rate). <b>Implied Price (staged)</b> and <b>Valuation Gap</b>/<b>Verdict</b> come from that staged calculation
            — the same framing the single-stock page now uses, just with an automatic decay instead of your own hand-picked stages. The{" "}
            <b>Flat Implied Growth</b> and <b>3Y Avg Growth</b> columns are reference only, same as on the single-stock page. Click a row's{" "}
            <b>✏️ Growth</b> link to open that specific company's own /reverse-dcf page and set a real, hand-tuned growth path for it —
            (2026-09-13, "we cant apply generic rates across we need specific... link from scan page to main page, were we can override and
            same can reflect back to scan page") — it saves to your browser and this row picks it up automatically, showing{" "}
            <b>✏️ custom</b> instead of <b>✏️ auto</b> from then on. Every OTHER row keeps using the auto-decay untouched — this is a
            per-company override, not a blanket one. A stock with no computable gap sorts to the bottom rather than being dropped.
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
            single click would try to process all 750 at once and time out). Same staged-DCF/fixed-decay logic as the ledger view (see that
            tab's own note for the exact decay rule) — server-side, covering the whole market instead of only what you've added.{" "}
            The per-row <b>✏️ Growth</b> override works here too — recomputed live in your browser off the same raw inputs (revenue/margin/
            tax/net debt) the server already fetched, no extra requests. A row from BEFORE 2026-09-13 that hasn't been re-scanned by its own
            daily batch yet won't have those raw inputs backfilled — a saved override for it falls back to showing the server's own
            market-implied figures instead of silently going blank (flagged with a small <span className="text-amber-500">*</span> next to
            its Valuation Gap so it doesn't read as "your growth applied" when it didn't), and catches up automatically once its next
            scheduled batch runs.
          </MethodologyNote>
          {nse750Ready ? (
            <GenericTable
              rows={nse750Rows}
              cols={NSE750_COLS}
              navigate={(t) => navigate(`/company/${t}`)}
              watchlist={watchlist}
              emptyMessage="No NSE 750 scan data yet — the daily batches haven't run for the first time yet."
            />
          ) : (
            <ScreenerLoading label="NSE 750 scan data" />
          )}
        </>
      )}
    </div>
  );
}
