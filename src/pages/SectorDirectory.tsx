import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useData, useScreeners } from "../App";
import { Col, GenericTable, MethodologyNote, PriceLink, ScreenerLoading, Signed, fmtNum } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";

// 2026-09-26 ("is it possible to add a page to list all stocks related
// to those sectors as per defined from NSDL or NSE or BSE") — prompted
// by FII Trend: a sector flagged 🔥 2FN Buying is only useful if you
// can see WHICH stocks are actually in it. No new backend screener —
// nseScreener's own rows (NSE's Total Market CSV, already fetched
// daily) carry an "Industry" field that's an EXACT match to the same
// 22-sector BSE classification NSDL's own FPI report uses (verified
// live: same 22 names, same spelling bar two commas), so this just
// groups data already being fetched every day.
//
// 2026-09-26 ("make sector directory page with format as on PF page
// (DENSE with all details)") — swapped the lean NSE_SCREENER_COLS for
// Portfolio Allocation's own dense column set (Market Cap, Day/1W/1M/
// 3M/6M %, % vs 200D/33W EMA, % from ATH/52W High), minus the
// holding-specific ones (Buy %/Avg Price/P&L %/Current %) that don't
// apply to a market-wide list — same exclusion already established for
// All Technicals' own "Technicals (Dense, NSE750)" group. Joins the
// same 3 screeners that group already reads: nseScreener (base +
// sector + Day %), nse750Fundamentals (Market Cap), nse750Technicals
// (everything else) — a smaller, targeted join than All Technicals'
// own 15-screener merge, since this page only ever needs these three.
function keyBy<T extends Record<string, any>>(rows: T[] | undefined): Map<string, T> {
  const map = new Map<string, T>();
  for (const r of rows ?? []) if (r.symbol) map.set(r.symbol, r);
  return map;
}

const DENSE_COLS: Col[] = [
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "name", label: "Name", align: "left" },
  { key: "sector", label: "Sector", align: "left" },
  { key: "market_cap_cr", label: "Market Cap (Cr)", render: (r) => (r.market_cap_cr == null ? <span className="text-slate-300">—</span> : `₹${fmtNum(r.market_cap_cr, 0)} Cr`) },
  { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
  { key: "day_change_pct", label: "Day %", groupStart: true, render: (r) => <Signed v={r.day_change_pct} digits={1} /> },
  { key: "pct_1w", label: "1W %", render: (r) => <Signed v={r.pct_1w} digits={1} /> },
  { key: "pct_1m", label: "1M %", render: (r) => <Signed v={r.pct_1m} digits={1} /> },
  { key: "pct_3m", label: "3M %", render: (r) => <Signed v={r.pct_3m} digits={1} /> },
  { key: "pct_6m", label: "6M %", render: (r) => <Signed v={r.pct_6m} digits={1} /> },
  { key: "pct_200d_ema", label: "% vs 200D EMA", groupStart: true, render: (r) => <Signed v={r.pct_200d_ema} digits={1} /> },
  { key: "pct_33w_ema", label: "% vs 33W EMA", render: (r) => <Signed v={r.pct_33w_ema} digits={1} /> },
  { key: "pct_from_ath", label: "% from ATH", groupStart: true, render: (r) => <Signed v={r.pct_from_ath} digits={1} /> },
  { key: "pct_from_52w_high", label: "% from 52W High", render: (r) => <Signed v={r.pct_from_52w_high} digits={1} /> },
];

export default function SectorDirectory() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const { ready } = useScreeners(["nseScreener", "nse750Fundamentals", "nse750Technicals"]);
  const ms = bundle.momentum_screeners;

  const rows = useMemo(() => {
    const base = ms?.nseScreener?.rows ?? [];
    const fundMap = keyBy(ms?.nse750Fundamentals?.rows);
    const ntMap = keyBy(ms?.nse750Technicals?.rows);
    return base.map((b: any) => {
      const fund = fundMap.get(b.symbol);
      const nt = ntMap.get(b.symbol);
      return {
        symbol: b.symbol,
        name: b.name,
        sector: b.sector,
        price: b.price,
        // nse750Fundamentals' own pushed field is "marketcap" (no
        // underscore/suffix — _rdcf_fetch_fundamentals' own dict key,
        // spread as-is into push_rows), NOT "market_cap_cr" — that name
        // only exists on reverseDcfScanNse750/turtleWealth's OWN rows,
        // a different screener. Caught live 2026-09-26: this column
        // silently showed "—" for all 750 rows in production before
        // the mismatch was found.
        market_cap_cr: fund?.marketcap ?? null,
        day_change_pct: b.change_pct ?? null,
        pct_1w: nt?.pct_1w ?? null,
        pct_1m: nt?.pct_1m ?? null,
        pct_3m: nt?.pct_3m ?? null,
        pct_6m: nt?.pct_6m ?? null,
        pct_200d_ema: nt?.pct_200d_ema ?? null,
        pct_33w_ema: nt?.pct_33w_ema ?? null,
        pct_from_ath: nt?.pct_from_ath ?? null,
        pct_from_52w_high: nt?.pct_from_52w_high ?? null,
      };
    });
  }, [ms]);

  const [searchParams, setSearchParams] = useSearchParams();
  // Read once at mount (same pattern ReverseDCF's own ?ticker= link
  // uses) — arriving from a FII Trend sector link pre-selects that
  // sector instead of always defaulting to "All".
  const [selectedSector, setSelectedSector] = useState<string>(() => searchParams.get("sector") ?? "All");

  const sectorCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) if (r.sector) counts.set(r.sector, (counts.get(r.sector) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]); // biggest sector first
  }, [rows]);

  function selectSector(sector: string) {
    setSelectedSector(sector);
    if (sector === "All") setSearchParams({});
    else setSearchParams({ sector });
  }

  if (!ready) return <ScreenerLoading label="Sector Directory" />;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">🗂️ Sector Directory</h1>
        <span className="text-slate-500 text-sm">Every NSE750 stock, grouped by its BSE/NSDL sector</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        {bundle.momentum_screeners.nseScreener?.as_of && <>Base data as of {bundle.momentum_screeners.nseScreener.as_of}. </>}
        {bundle.momentum_screeners.nse750Technicals?.as_of && <>Technicals (Market Cap/1W-6M %/EMA/ATH/52W High) refresh weekly — as of {bundle.momentum_screeners.nse750Technicals.as_of}.</>}
      </p>

      <MethodologyNote>
        Sector comes from NSE's own Total Market CSV's "Industry" column — the same 22-sector BSE Common Industry Classification NSDL's
        own Fortnightly Sector-wise FPI report uses (see the <b>FII Trend</b> page), so a sector name means the same thing on both pages.
        Click a sector below to filter, or use the table's own "All sectors" dropdown — both stay in sync. The URL updates as you pick
        (<code>?sector=...</code>), so this page is linkable/bookmarkable to one sector directly.
        <br />
        <br />
        Columns match <b>Portfolio Allocation</b>'s own dense format, minus the holding-specific ones (Buy %/Avg Price/P&L %/Current %)
        that don't apply to a market-wide list — same exclusion as All Technicals' "Technicals (Dense, NSE750)" group. 1W/1M/3M/6M % are
        bar-count price changes (not calendar-exact); % vs 200D/33W EMA use OHLC4, not close alone; % from ATH/52W High are measured off
        weekly highs, so an intraweek spike that pulled back before the week's close still counts as touching a new high.
      </MethodologyNote>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => selectSector("All")}
          className={`text-xs px-3 py-1.5 rounded-full border whitespace-nowrap ${
            selectedSector === "All" ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"
          }`}
        >
          All ({rows.length})
        </button>
        {sectorCounts.map(([sector, count]) => (
          <button
            key={sector}
            onClick={() => selectSector(sector)}
            className={`text-xs px-3 py-1.5 rounded-full border whitespace-nowrap ${
              selectedSector === sector ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"
            }`}
          >
            {sector} ({count})
          </button>
        ))}
      </div>

      {/* key forces a remount when the sector changes via a chip click
          or a fresh deep link — GenericTable's own sector filter state
          is seeded once at mount (initialSector), not controlled, so
          this is how an external change actually takes effect. */}
      <GenericTable
        key={selectedSector}
        rows={rows}
        cols={DENSE_COLS}
        navigate={(t) => navigate(`/company/${t}`)}
        watchlist={watchlist}
        initialSector={selectedSector}
        emptyMessage="No stock data yet — the nseScreener cron hasn't run."
      />
    </div>
  );
}
