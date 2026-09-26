import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useData, useScreeners } from "../App";
import RunButton from "../components/RunButton";
import { Col, GenericTable, MethodologyNote, ScreenerLoading, Signed, fmtSigned } from "../components/ScreenerTable";

// 2026-09-26 — from a YouTube video (ACEink — "FIIs sold ₹21,000 Cr
// but they're quietly buying THIS sector") stating a rule: one
// fortnight of FII buying in a sector "says nothing", but TWO
// CONSECUTIVE fortnights of buying is a strong signal. The video's own
// spreadsheet turned out to be from a paid tool, but the underlying
// data is NSDL's own free public "Fortnightly Sector-wise FPI
// Investment Data" report — see api/momentum_screeners.py's
// fiiSectorTrend module comment for the full sourcing/parsing story
// (including a real file-naming inconsistency that silently dropped a
// whole month before being fixed). Only the LAST 2 periods drive the
// signal (matching the video's own rule); more periods are shown as
// columns purely for visual trend context.
const VISIBLE_PERIODS = 6;

function signalFor(latest: number | null, prev: number | null): "buy" | "sell" | null {
  if (latest == null || prev == null) return null;
  if (latest > 0 && prev > 0) return "buy";
  if (latest < 0 && prev < 0) return "sell";
  return null;
}

function SignalBadge({ signal }: { signal: "buy" | "sell" | null }) {
  if (signal === "buy")
    return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap bg-emerald-50 text-emerald-700 border-emerald-300">🔥 2FN Buying</span>;
  if (signal === "sell")
    return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap bg-red-50 text-red-600 border-red-300">🔻 2FN Selling</span>;
  return <span className="text-slate-300">—</span>;
}

export default function FIITrend() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const { ready } = useScreeners(["fiiSectorTrend"]);
  const entry = bundle.momentum_screeners.fiiSectorTrend;
  const allRows: any[] = entry?.rows ?? [];

  const { periods, sectorRows, totalLatest, totalPrev } = useMemo(() => {
    const periodMap = new Map<string, string>(); // period_end -> period_label
    for (const r of allRows) periodMap.set(r.period_end, r.period_label);
    const allPeriods = Array.from(periodMap.entries())
      .map(([period_end, period_label]) => ({ period_end, period_label }))
      .sort((a, b) => a.period_end.localeCompare(b.period_end));
    const periods = allPeriods.slice(-VISIBLE_PERIODS);

    const bySector = new Map<string, Record<string, number | null>>();
    for (const r of allRows) {
      if (r.sector === "__TOTAL__") continue;
      if (!bySector.has(r.sector)) bySector.set(r.sector, {});
      bySector.get(r.sector)![r.period_end] = r.equity_net_cr;
    }

    const latestPeriod = allPeriods[allPeriods.length - 1]?.period_end;
    const prevPeriod = allPeriods[allPeriods.length - 2]?.period_end;

    const sectorRows = Array.from(bySector.entries()).map(([sector, byPeriod]) => {
      const latest = latestPeriod ? (byPeriod[latestPeriod] ?? null) : null;
      const prev = prevPeriod ? (byPeriod[prevPeriod] ?? null) : null;
      const row: Record<string, any> = {
        name: sector,
        sector_name: sector,
        latest,
        signal: signalFor(latest, prev),
      };
      periods.forEach((p, i) => {
        row[`p${i}`] = byPeriod[p.period_end] ?? null;
      });
      return row;
    });
    // Default view order — biggest current-fortnight buyers first,
    // matching the video's own "who's FII buying right now" framing.
    // GenericTable's own header-click sort (still available) overrides
    // this the moment the user clicks a column.
    sectorRows.sort((a, b) => (b.latest ?? -Infinity) - (a.latest ?? -Infinity));

    const totalBy = new Map<string, number | null>();
    for (const r of allRows) if (r.sector === "__TOTAL__") totalBy.set(r.period_end, r.equity_net_cr);
    const totalLatest = latestPeriod ? (totalBy.get(latestPeriod) ?? null) : null;
    const totalPrev = prevPeriod ? (totalBy.get(prevPeriod) ?? null) : null;

    return { periods, sectorRows, totalLatest, totalPrev };
  }, [allRows]);

  const cols: Col[] = useMemo(() => {
    const periodCols: Col[] = periods.map((p, i) => ({
      key: `p${i}`,
      label: p.period_label.replace(/, \d{4}$/, ""), // drop the year — already shown in the header note
      width: 10,
      render: (r) => <Signed v={r[`p${i}`]} digits={0} />,
    }));
    return [
      { key: "sector_name", label: "Sector", align: "left", width: 100 - periodCols.length * 10 - 14, render: (r) => r.sector_name },
      ...periodCols,
      { key: "signal", label: "Signal", width: 14, render: (r) => <SignalBadge signal={r.signal} /> },
    ];
  }, [periods]);

  if (!ready) return <ScreenerLoading label="FII Trend" />;

  const latestLabel = periods[periods.length - 1]?.period_label;
  const prevLabel = periods[periods.length - 2]?.period_label;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">🌊 FII Trend</h1>
        <span className="text-slate-500 text-sm">Sector-wise FII net investment, fortnightly (NSDL)</span>
        <span className="ml-auto">
          <RunButton screener="fiiSectorTrend" />
        </span>
      </div>
      {entry?.as_of && <div className="text-xs text-slate-400 mb-2">as of {entry.as_of}</div>}

      <MethodologyNote>
        Sourced from NSDL's own free, public "Fortnightly Sector-wise FPI Investment Data" report (fpi.nsdl.co.in) — no login, same "zero
        stored credentials" principle as every other screener here. Each fortnight (1st-15th, 16th-month-end) gives every sector's{" "}
        <b>Equity</b> net investment in ₹ Crore — <b>positive = FIIs net bought</b> that sector, <b>negative = net sold</b>.
        <br />
        <br />
        <b>Signal</b> replicates a rule from a YouTube video (ACEink) that prompted this page: one fortnight of buying in a sector "says
        nothing", but <b>two consecutive fortnights of buying</b> is a strong signal — shown as 🔥. The mirror case (two consecutive
        fortnights of selling) is shown as 🔻. Backfilled since March 2026 (the user's own requested start); more fortnights accumulate
        automatically as NSDL publishes new ones. Only the last {VISIBLE_PERIODS} fortnights are shown as columns — older history still
        feeds the signal calculation via the underlying data, it's just not displayed. Sr.No 23 "Sovereign" (government debt) and 24
        "Others" (unclassified/non-equity) aren't real equity sectors, so they're excluded from the sector rows, but both ARE folded into
        the <b>Total FII Equity</b> headline below, matching NSDL's own published Grand Total.
      </MethodologyNote>

      {(totalLatest !== null || totalPrev !== null) && (
        <div className="mb-4 grid grid-cols-2 gap-4 max-w-xl">
          <div className="p-4 border border-slate-200 rounded-lg">
            <div className="text-xs text-slate-500 mb-1">Total FII Equity — {latestLabel}</div>
            <div className={`text-2xl font-semibold ${totalLatest != null && totalLatest >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              ₹{fmtSigned(totalLatest, 0)} Cr
            </div>
          </div>
          <div className="p-4 border border-slate-200 rounded-lg">
            <div className="text-xs text-slate-500 mb-1">Total FII Equity — {prevLabel}</div>
            <div className={`text-2xl font-semibold ${totalPrev != null && totalPrev >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              ₹{fmtSigned(totalPrev, 0)} Cr
            </div>
          </div>
        </div>
      )}

      <GenericTable
        rows={sectorRows}
        cols={cols}
        navigate={(t) => navigate(`/company/${t}`)}
        emptyMessage="No FII Trend data yet — click Run now above, or wait for the next scheduled cron (3rd/18th of the month)."
      />
    </div>
  );
}
