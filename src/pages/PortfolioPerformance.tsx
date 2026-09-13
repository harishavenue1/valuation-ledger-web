import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import { api } from "../lib/api";
import { Col, GenericTable, MethodologyNote, Signed, fmtNum, fmtSigned } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";

// Added 2026-09-13 ("can we build this portfolio breakdown page on
// current portfolio holdings allocation, returns, alpha, and ranking
// based on alpha which vs NSE/BSE500 returns for the month") after
// the user shared a screenshot of a 3rd-party "Performance Breakdown"
// dashboard (Super-Perf./Performers/Under-Perf./Others tiers, each
// row showing Alloc/Return%/Alpha/a rank column, plus an overall
// weighted alpha figure). This replicates the DATA the user explicitly
// asked for — Allocation, Return (1M), Alpha vs NSE 500 (1M), ranked
// by alpha — as a plain table page in this app's own established
// style, not a pixel-for-pixel dashboard clone (no donut chart, tier
// icons, or "EM Rank" column — that screenshot's own undisclosed
// metric, nothing to honestly replicate). The 3-tier grouping
// (Outperforming/In-line/Underperforming) below IS kept, since it's
// the one piece of structure the user's own screenshot most clearly
// asked to see reused — but the cutoffs are this app's own simple,
// clearly-labeled ±3% bands, not a claim to reproduce that
// screenshot's own undisclosed thresholds.
//
// Pure client-side composition of 3 ALREADY-LIVE datasets, no new
// backend needed:
// - bundle.momentum_screeners.portfolioAllocation — current Kite
//   holdings + pct_of_portfolio (same live-Kite-holdings snapshot
//   the Portfolio Allocation page itself renders; on-request only,
//   same staleness this app already accepts everywhere else that
//   reads it).
// - bundle.momentum_screeners.nseScreener — each holding's own
//   monthly_pct (a ~1-calendar-month return, NOT literal
//   day-of-month-to-day-of-month "MTD" the way the screenshot's own
//   label implies — same rolling-window convention this app already
//   uses everywhere else it says "Monthly"). Holdings outside NSE
//   750 fall back to a live per-ticker yfinance fetch
//   (api/watchlist_detail.py), same pattern and same field name
//   (monthly_pct) the Watchlist page's own off-universe fallback
//   already uses.
// - bundle.momentum_screeners.strategicAlpha — the "Nifty 500" row's
//   own r_1m, as the NSE 500 benchmark return (Strategic Alpha
//   already tracks Nifty 500 daily via ^CRSLDX, refreshed with every
//   other Strategic Alpha row). Same ~1-month rolling convention as
//   monthly_pct above (both windowed off "today", not calendar-month
//   boundaries) — close enough for a fair like-for-like alpha, not
//   claimed to be bar-for-bar identical methodology. No BSE 500
//   equivalent is tracked anywhere in this app yet, so "vs NSE/BSE500"
//   resolves to NSE 500 only.
const TIER_BAND_PCT = 3; // this app's OWN simple cutoff, not a claimed replica of any external framework's thresholds

function toNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}

const COLS: Col[] = [
  { key: "rank", label: "Rank" },
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "name", label: "Name", align: "left" },
  { key: "sector", label: "Sector", align: "left" },
  { key: "pct_of_portfolio", label: "Allocation", render: (r) => <span className="font-semibold tabular-nums">{fmtNum(r.pct_of_portfolio, 1)}%</span> },
  { key: "return_1m", label: "Return (1M)", render: (r) => (r.return_1m !== null ? <Signed v={r.return_1m} digits={1} /> : "—") },
  { key: "alpha_1m", label: "Alpha vs NSE 500 (1M)", render: (r) => (r.alpha_1m !== null ? <Signed v={r.alpha_1m} digits={1} /> : "—") },
];

export default function PortfolioPerformance() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const watchlist = useWatchlist();

  const holdingRows = bundle.momentum_screeners.portfolioAllocation?.rows ?? [];
  const nseBySymbol = useMemo(() => {
    const m = new Map<string, Record<string, any>>();
    for (const r of bundle.momentum_screeners.nseScreener?.rows ?? []) m.set(String(r.symbol), r);
    return m;
  }, [bundle.momentum_screeners.nseScreener]);
  const benchmarkR1m = useMemo(() => {
    const row = (bundle.momentum_screeners.strategicAlpha?.rows ?? []).find((r: any) => r.asset === "Nifty 500");
    return row?.r_1m ?? null;
  }, [bundle.momentum_screeners.strategicAlpha]);

  // Same off-universe live-fetch fallback Watchlist.tsx already uses —
  // a holding outside NSE 750 (below the Smallcap 100 cutoff, etc.)
  // still needs SOME 1-month return to compare, not a blank row.
  const [liveDetail, setLiveDetail] = useState<Record<string, Record<string, any>>>({});
  const lastFetchedKey = useRef("");
  const outsideNse750 = holdingRows.map((r: any) => String(r.symbol)).filter((sym: string) => !nseBySymbol.has(sym));
  const outsideKey = [...outsideNse750].sort().join(",");
  useEffect(() => {
    if (!outsideKey || outsideKey === lastFetchedKey.current) return;
    lastFetchedKey.current = outsideKey;
    const need = outsideKey.split(",").filter((t) => !liveDetail[t]);
    if (need.length === 0) return;
    api
      .fetchWatchlistDetail(need)
      .then(({ rows: fetched }) => setLiveDetail((prev) => ({ ...prev, ...fetched })))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outsideKey]);

  const allRows = useMemo(() => {
    const computed = holdingRows.map((h: any) => {
      const sym = String(h.symbol);
      const nse = nseBySymbol.get(sym);
      const return_1m = toNum(nse?.monthly_pct) ?? toNum(liveDetail[sym]?.monthly_pct);
      const alpha_1m = return_1m !== null && benchmarkR1m !== null ? Math.round((return_1m - benchmarkR1m) * 10) / 10 : null;
      return {
        symbol: sym,
        name: h.name ?? sym,
        sector: h.sector ?? "Unknown",
        pct_of_portfolio: h.pct_of_portfolio ?? 0,
        return_1m,
        alpha_1m,
      };
    });
    // Ranked by alpha descending — matches the user's own explicit ask
    // ("ranking based on alpha"). Rows with no computable alpha sort last.
    computed.sort((a, b) => {
      if (a.alpha_1m === null && b.alpha_1m === null) return 0;
      if (a.alpha_1m === null) return 1;
      if (b.alpha_1m === null) return -1;
      return b.alpha_1m - a.alpha_1m;
    });
    return computed.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [holdingRows, nseBySymbol, liveDetail, benchmarkR1m]);

  const outperforming = allRows.filter((r) => r.alpha_1m !== null && r.alpha_1m > TIER_BAND_PCT);
  const inLine = allRows.filter((r) => r.alpha_1m !== null && r.alpha_1m >= -TIER_BAND_PCT && r.alpha_1m <= TIER_BAND_PCT);
  const underperforming = allRows.filter((r) => r.alpha_1m !== null && r.alpha_1m < -TIER_BAND_PCT);
  const noAlpha = allRows.filter((r) => r.alpha_1m === null);

  const weightSum = allRows.reduce((s, r) => s + (r.alpha_1m !== null ? r.pct_of_portfolio : 0), 0);
  const overallAlpha = weightSum > 0 ? allRows.reduce((s, r) => s + (r.alpha_1m !== null ? r.pct_of_portfolio * r.alpha_1m : 0), 0) / weightSum : null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">📊 Portfolio Performance</h1>
        <span className="text-slate-500 text-sm">Current holdings, ranked by alpha vs NSE 500 — last 1 month</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Live Kite holdings (same snapshot as Portfolio Allocation), each holding's own ~1-month return, and alpha vs NSE 500's own 1-month
        return over the same window — {holdingRows.length} holdings, {allRows.length - noAlpha.length} with a computable alpha.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <div className="p-3 border border-slate-200 rounded-lg text-center">
          <div className="text-xs text-slate-500">Overall Alpha (allocation-weighted)</div>
          <div className={`text-2xl font-bold tabular-nums ${overallAlpha !== null && overallAlpha >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {overallAlpha !== null ? fmtSigned(overallAlpha, 2) : "—"}
          </div>
        </div>
        <div className="p-3 border border-slate-200 rounded-lg text-center">
          <div className="text-xs text-slate-500">NSE 500 Benchmark (1M)</div>
          <div className="text-2xl font-bold tabular-nums text-slate-700">{benchmarkR1m !== null ? fmtSigned(benchmarkR1m, 2) : "—"}</div>
        </div>
        <div className="p-3 border border-slate-200 rounded-lg text-center">
          <div className="text-xs text-slate-500">Outperforming / In-line / Underperforming</div>
          <div className="text-2xl font-bold tabular-nums text-slate-700">
            <span className="text-emerald-600">{outperforming.length}</span> / <span className="text-slate-500">{inLine.length}</span> /{" "}
            <span className="text-red-600">{underperforming.length}</span>
          </div>
        </div>
      </div>

      <MethodologyNote>
        <b>Return (1M)</b> is each holding's own trailing ~1-calendar-month price return — from Momentum Screeners' own NSE Screener tab where
        covered, live yfinance fallback (same as the Watchlist page's own off-universe handling) otherwise. NOT literal
        day-of-month-to-day-of-month "MTD" the way a broker's own dashboard might define it — a rolling window, same convention this app uses
        everywhere else it labels something "Monthly". <b>Alpha vs NSE 500 (1M)</b> = that return minus NSE 500's own 1-month return
        (Strategic Alpha's own tracked "Nifty 500" row, ^CRSLDX) over the same rolling window — not a bar-for-bar identical calculation to
        Return (1M)'s own (both are ~1-month windows computed independently, close enough for a fair comparison, not claimed to be exactly
        the same methodology). No BSE 500 equivalent is tracked anywhere in this app yet, so "vs NSE/BSE500" resolves to NSE 500 only.{" "}
        <b>Outperforming</b>/<b>In-line</b>/<b>Underperforming</b> below are this app's own simple ±{TIER_BAND_PCT}% alpha bands — not a claimed
        replica of any specific external framework's own (undisclosed) thresholds. <b>Overall Alpha</b> is the allocation-weighted average
        alpha across every holding with a computable one.
      </MethodologyNote>

      {holdingRows.length === 0 ? (
        <div className="text-slate-500 text-sm py-10 text-center border border-slate-200 rounded">
          No portfolio holdings loaded yet — refresh Portfolio Allocation first (Kite holdings need an interactive session).
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-1 mt-2">
            <h2 className="text-base font-semibold text-emerald-700">🟢 Outperforming ({outperforming.length})</h2>
          </div>
          <GenericTable rows={outperforming} cols={COLS} navigate={(t) => navigate(`/company/${t}`)} watchlist={watchlist} emptyMessage="None currently." />

          <div className="flex items-center gap-2 mb-1 mt-8">
            <h2 className="text-base font-semibold text-slate-600">🟡 In-line ({inLine.length})</h2>
          </div>
          <GenericTable rows={inLine} cols={COLS} navigate={(t) => navigate(`/company/${t}`)} watchlist={watchlist} emptyMessage="None currently." />

          <div className="flex items-center gap-2 mb-1 mt-8">
            <h2 className="text-base font-semibold text-red-600">🔴 Underperforming ({underperforming.length})</h2>
          </div>
          <GenericTable rows={underperforming} cols={COLS} navigate={(t) => navigate(`/company/${t}`)} watchlist={watchlist} emptyMessage="None currently." />

          {noAlpha.length > 0 && (
            <>
              <div className="flex items-center gap-2 mb-1 mt-8">
                <h2 className="text-base font-semibold text-slate-400">⚪ No return data yet ({noAlpha.length})</h2>
              </div>
              <GenericTable rows={noAlpha} cols={COLS} navigate={(t) => navigate(`/company/${t}`)} watchlist={watchlist} emptyMessage="None." />
            </>
          )}
        </>
      )}
    </div>
  );
}
