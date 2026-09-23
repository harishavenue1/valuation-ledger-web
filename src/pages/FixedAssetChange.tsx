import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useData, useScreeners } from "../App";
import { Col, GenericTable, MethodologyNote, PriceLink, ScreenerLoading, Signed, fmtNum } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";

// 2026-09-23 ("under momentum a new page dedicated to only filter
// stocks with these details") — same "client-side join, no new fetch"
// design as AllFundamentals.tsx, reading the SAME nse750Fundamentals
// cache's fixed_assets_*/cwip_* fields (added the same day, piggybacked
// onto the Balance Sheet table _rdcf_fetch_fundamentals already opens
// for Borrowings/Equity Capital/Reserves — no extra Screener.in load).
// Unlike AllFundamentals' everything-shown-with-a-picker design, this
// page is narrowly scoped to just this one factor, filtered to stocks
// that actually have it and sorted highest-to-lowest by default (per
// "name its Fixed Asset Change, sort with Highest to Low").

function keyBy<T extends Record<string, any>>(rows: T[] | undefined): Map<string, T> {
  const map = new Map<string, T>();
  for (const r of rows ?? []) {
    if (r.symbol) map.set(r.symbol, r);
  }
  return map;
}

const DASH = <span className="text-slate-300">—</span>;
function chgCell(v: number | null | undefined) {
  return typeof v === "number" ? <Signed v={v} digits={1} /> : DASH;
}

const COLS: Col[] = [
  { key: "rank", label: "#", width: 4 },
  { key: "symbol", label: "Symbol", align: "left", width: 9 },
  { key: "name", label: "Name", align: "left", width: 13 },
  { key: "sector", label: "Sector", align: "left", width: 10 },
  { key: "price", label: "Price", width: 7, render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
  { key: "fixed_assets_cr", label: "Fixed Assets ₹Cr", width: 8, render: (r) => (typeof r.fixed_assets_cr === "number" ? fmtNum(r.fixed_assets_cr, 0) : DASH) },
  { key: "fixed_assets_1y_chg", label: "Fixed Asset Δ 1Yr", width: 7, render: (r) => chgCell(r.fixed_assets_1y_chg) },
  { key: "fixed_assets_2y_chg", label: "Fixed Asset Δ 2Yr", width: 7, render: (r) => chgCell(r.fixed_assets_2y_chg) },
  { key: "fixed_assets_3y_chg", label: "Fixed Asset Δ 3Yr", width: 7, render: (r) => chgCell(r.fixed_assets_3y_chg) },
  { key: "cwip_cr", label: "CWIP ₹Cr", width: 7, render: (r) => (typeof r.cwip_cr === "number" ? fmtNum(r.cwip_cr, 0) : DASH) },
  { key: "cwip_1y_chg", label: "CWIP Δ 1Yr", width: 7, render: (r) => chgCell(r.cwip_1y_chg) },
  { key: "cwip_2y_chg", label: "CWIP Δ 2Yr", width: 7, render: (r) => chgCell(r.cwip_2y_chg) },
  { key: "cwip_3y_chg", label: "CWIP Δ 3Yr", width: 7, render: (r) => chgCell(r.cwip_3y_chg) },
];

export default function FixedAssetChange() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const { ready } = useScreeners(["nseScreener", "nse750Fundamentals"]);
  const ms = bundle.momentum_screeners;

  const rows = useMemo(() => {
    const base = ms?.nseScreener?.rows ?? [];
    const fundMap = keyBy(ms?.nse750Fundamentals?.rows);

    const joined = base
      .map((b: any) => {
        const fund = fundMap.get(b.symbol);
        return {
          symbol: b.symbol,
          name: b.name,
          sector: b.sector,
          price: fund?.current_price ?? b.price,
          fixed_assets_cr: fund?.fixed_assets_cr ?? null,
          fixed_assets_1y_chg: fund?.fixed_assets_1y_chg ?? null,
          fixed_assets_2y_chg: fund?.fixed_assets_2y_chg ?? null,
          fixed_assets_3y_chg: fund?.fixed_assets_3y_chg ?? null,
          cwip_cr: fund?.cwip_cr ?? null,
          cwip_1y_chg: fund?.cwip_1y_chg ?? null,
          cwip_2y_chg: fund?.cwip_2y_chg ?? null,
          cwip_3y_chg: fund?.cwip_3y_chg ?? null,
        };
      })
      // Only stocks Screener.in actually has a "Fixed Assets" Balance
      // Sheet row with ≥2 years of history for — a bare listing with no
      // change figure isn't useful on a page built around this one factor.
      .filter((r) => typeof r.fixed_assets_1y_chg === "number");

    // Highest to lowest by default (page name is literally the sort
    // key) — GenericTable's own header click can still re-sort by any
    // other column from here.
    joined.sort((a, b) => (b.fixed_assets_1y_chg as number) - (a.fixed_assets_1y_chg as number));
    return joined.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [ms]);

  const asOf = ms?.nse750Fundamentals?.as_of;

  if (!ready) return <ScreenerLoading label="Fixed Asset Change" />;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">🏗️ Fixed Asset Change</h1>
        <span className="text-slate-500 text-sm">NSE750 stocks with a Fixed Assets figure, sorted by 1Yr change (highest first)</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Refreshed by the existing nse750Fundamentals cron — this page just joins what's already fetched, client-side.
        {asOf && <> Fundamentals data as of {asOf}.</>}
      </p>

      <MethodologyNote>
        <b>Fixed Assets</b>/<b>CWIP</b> are Screener.in's own Balance Sheet rows (in ₹ Cr), read off the same annual table{" "}
        <b>nse750Fundamentals</b> already opens for Borrowings/Equity Capital/Reserves — no extra fetch. <b>Δ 1Yr/2Yr/3Yr</b> is real %
        growth (not a percentage-point change — Fixed Assets/CWIP are ₹ figures, not ratios), computed from the end of each row so an
        early data gap (recent listing) doesn't shift which year "N years back" lands on. A rising <b>Fixed Assets</b> figure means capex
        already came online (capacity added, ready to earn a return); a rising <b>CWIP</b> means capex still under construction — capacity
        not yet earning anything, but signalling more Fixed Assets growth to come once it's commissioned. Only stocks with at least 2
        years of Fixed Assets history are shown (a change figure needs two points) — Screener.in has no clean Balance Sheet numbers yet
        for the rest (a very recent IPO, an unparseable page), same coverage gap <b>All Fundamentals</b> discloses for this cache.
      </MethodologyNote>

      <GenericTable
        rows={rows}
        cols={COLS}
        navigate={(t) => navigate(`/company/${t}`)}
        watchlist={watchlist}
        emptyMessage="No stocks with a Fixed Assets figure yet — the nse750Fundamentals cron hasn't populated this field."
      />
    </div>
  );
}
