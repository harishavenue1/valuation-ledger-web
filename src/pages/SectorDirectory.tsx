import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useData, useScreeners } from "../App";
import { GenericTable, MethodologyNote, NSE_SCREENER_COLS, ScreenerLoading } from "../components/ScreenerTable";
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
export default function SectorDirectory() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const { ready } = useScreeners(["nseScreener"]);
  const rows: any[] = bundle.momentum_screeners.nseScreener?.rows ?? [];

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
        Same data as the All Technicals/Momentum tabs (nseScreener) — no separate fetch, just grouped by sector here.
        {bundle.momentum_screeners.nseScreener?.as_of && <> Base data as of {bundle.momentum_screeners.nseScreener.as_of}.</>}
      </p>

      <MethodologyNote>
        Sector comes from NSE's own Total Market CSV's "Industry" column — the same 22-sector BSE Common Industry Classification NSDL's
        own Fortnightly Sector-wise FPI report uses (see the <b>FII Trend</b> page), so a sector name means the same thing on both pages.
        Click a sector below to filter, or use the table's own "All sectors" dropdown — both stay in sync. The URL updates as you pick
        (<code>?sector=...</code>), so this page is linkable/bookmarkable to one sector directly.
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
        cols={NSE_SCREENER_COLS}
        navigate={(t) => navigate(`/company/${t}`)}
        watchlist={watchlist}
        initialSector={selectedSector}
        emptyMessage="No stock data yet — the nseScreener cron hasn't run."
      />
    </div>
  );
}
