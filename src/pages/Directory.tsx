import { lazy, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useData, useScreeners } from "../App";
import { Col, GenericTable, MethodologyNote, PriceLink, ScreenerLoading, Signed, fmtNum } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";

// 2026-10-04 ("small and micro are clearly outperforming, so we need a list of
// this index stocks under directory page, rename sectors page to directory and
// keep existing as it is and add a new list for small and micro" / "if possible
// add midcap also"). The Sector Directory is untouched (it is the "Sectors" tab);
// the three index lists read the daily NSE store via the indexDirectory screener
// (api/_bhav.py compute_index_directory) so they cover every constituent, not
// just the NSE-750.
const SectorDirectory = lazy(() => import("./SectorDirectory"));

const TABS = [
  { key: "sectors", label: "🗂️ Sectors" },
  { key: "midcap", label: "Midcap 150", index: "Midcap 150" },
  { key: "smallcap", label: "Smallcap 250", index: "Smallcap 250" },
  { key: "microcap", label: "Microcap 250", index: "Microcap 250" },
] as const;

const COLS: Col[] = [
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "name", label: "Name", align: "left" },
  { key: "sector", label: "Sector", align: "left" },
  { key: "market_cap_cr", label: "Market Cap (Cr)", render: (r) => (r.market_cap_cr == null ? <span className="text-slate-300">—</span> : `₹${fmtNum(r.market_cap_cr, 0)} Cr`) },
  { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
  { key: "change_pct", label: "Day %", groupStart: true, render: (r) => <Signed v={r.change_pct} digits={1} /> },
  { key: "weekly_pct", label: "1W %", render: (r) => <Signed v={r.weekly_pct} digits={1} /> },
  { key: "monthly_pct", label: "1M %", render: (r) => <Signed v={r.monthly_pct} digits={1} /> },
  { key: "three_month_pct", label: "3M %", render: (r) => <Signed v={r.three_month_pct} digits={1} /> },
  { key: "six_month_pct", label: "6M %", render: (r) => <Signed v={r.six_month_pct} digits={1} /> },
  { key: "yearly_pct", label: "1Y %", render: (r) => <Signed v={r.yearly_pct} digits={1} /> },
  { key: "pct_200d_ema", label: "% vs 200D EMA", groupStart: true, render: (r) => <Signed v={r.pct_200d_ema} digits={1} /> },
  { key: "pct_33w_ema", label: "% vs 33W EMA", render: (r) => <Signed v={r.pct_33w_ema} digits={1} /> },
  { key: "pct_from_ath", label: "% from ATH", groupStart: true, render: (r) => <Signed v={r.pct_from_ath} digits={1} /> },
  { key: "pct_from_52w_high", label: "% from 52W High", render: (r) => <Signed v={r.pct_from_52w_high} digits={1} /> },
  { key: "rsi_w", label: "Weekly RSI", render: (r) => fmtNum(r.rsi_w, 1) },
  { key: "deliv_pct", label: "Delivery %", render: (r) => fmtNum(r.deliv_pct, 1) },
];

// Smallcap 250 / Microcap 250 only: the Microcap Momentum score ((0.7 x 6M% + 0.3 x 1M%) / 63-session volatility) and the rank WITHIN that index
const MOM_COLS: Col[] = [
  { key: "mom_rank", label: "Mom Rank", groupStart: true, render: (r) => (r.mom_rank == null ? <span className="text-slate-300">—</span> : <span className="font-semibold">{r.mom_rank}</span>) },
  { key: "mom_score", label: "Mom Score", render: (r) => (r.mom_score == null ? <span className="text-slate-300">—</span> : fmtNum(r.mom_score, 2)) },
  { key: "vol3m", label: "3M Volatility %", render: (r) => fmtNum(r.vol3m, 1) },
];

function median(vals: number[]): number | null {
  const v = vals.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function IndexList({ index }: { index: string }) {
  const { bundle } = useData();
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const { ready } = useScreeners(["indexDirectory"]);
  const entry = bundle.momentum_screeners.indexDirectory;
  const withMom = index === "Smallcap 250" || index === "Microcap 250";
  const rows = useMemo(() => {
    const r = (entry?.rows ?? []).filter((x: any) => x.index === index);
    // momentum-ranked first for the lists that carry a score (unranked last)
    return withMom ? [...r].sort((a: any, b: any) => (a.mom_rank ?? 1e9) - (b.mom_rank ?? 1e9)) : r;
  }, [entry, index, withMom]);
  const cols = useMemo(() => (withMom ? [...COLS.slice(0, 3), ...MOM_COLS, ...COLS.slice(3)] : COLS), [withMom]);

  const stats = useMemo(() => {
    const pick = (k: string) => median(rows.map((r: any) => r[k]));
    const share = (pred: (r: any) => boolean) => (rows.length ? Math.round((rows.filter(pred).length / rows.length) * 100) : null);
    return {
      m1: pick("monthly_pct"),
      m3: pick("three_month_pct"),
      m6: pick("six_month_pct"),
      y1: pick("yearly_pct"),
      above200: share((r) => typeof r.pct_200d_ema === "number" && r.pct_200d_ema > 0),
      nearAth: share((r) => typeof r.pct_from_ath === "number" && r.pct_from_ath >= -10),
    };
  }, [rows]);

  if (!ready) return <ScreenerLoading label={`${index} directory`} />;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-3 text-xs text-slate-500">
        <span>
          <b className="text-slate-700">{rows.length}</b> stocks
        </span>
        <span>
          Median 1M <Signed v={stats.m1} digits={1} />
        </span>
        <span>
          3M <Signed v={stats.m3} digits={1} />
        </span>
        <span>
          6M <Signed v={stats.m6} digits={1} />
        </span>
        <span>
          1Y <Signed v={stats.y1} digits={1} />
        </span>
        <span>
          <b className="text-slate-700">{stats.above200 ?? "—"}%</b> above 200D EMA
        </span>
        <span>
          <b className="text-slate-700">{stats.nearAth ?? "—"}%</b> within 10% of ATH
        </span>
        {entry?.as_of && <span className="ml-auto text-slate-400">session {entry.as_of}</span>}
      </div>
      <MethodologyNote>
        Every constituent of the <b>Nifty {index}</b> index (NSE's own constituent file, refreshed weekly) with its latest technicals from our daily NSE store — so
        this covers all of them, not only the NSE-750. Returns: Day/1W/1M/3M/1Y are calendar-offset price changes; <b>6M</b> is a 26-weekly-bar change.
        % vs 200D/33W EMA use OHLC4; % from ATH/52W High come from the store's split-adjusted highs (ATH reaches back to 2020). Market cap is NSE close ×
        share count (blank where the share count isn't known yet). The strip above is the median stock, and the share of members above their 200D EMA / within
        10% of the all-time high — a quick read on how the whole index is behaving. Updates each trading evening.
        {withMom && (
          <>
            <br />
            <br />
            <b>Mom Rank / Mom Score</b> (Smallcap 250 and Microcap 250): the Microcap Momentum strategy's score — <code>(0.7 × 6M % + 0.3 × 1M %) ÷ annualised
            volatility of the last 63 sessions' daily returns</code> — ranked within this index (1 = strongest); the list opens sorted by it. The Microcap 250
            ranks here are the same as on the Momentum page's <b>Microcap Momentum</b> tab. A stock with under ~6 months of history, or no 1M figure, is unranked.
          </>
        )}
      </MethodologyNote>
      <GenericTable
        key={index}
        rows={rows}
        cols={cols}
        navigate={(t) => navigate(`/company/${t}`)}
        watchlist={watchlist}
        emptyMessage="No data yet — the evening NSE publish hasn't produced the index lists."
      />
    </div>
  );
}

export default function Directory() {
  const [params, setParams] = useSearchParams();
  // the Sectors tab keeps its own ?sector= deep links (FII Trend links to it), so it is the default and carries no tab param
  const tab = TABS.find((t) => t.key === params.get("tab"))?.key ?? "sectors";
  const active = TABS.find((t) => t.key === tab)!;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h1 className="text-xl font-semibold">📚 Directory</h1>
        <span className="text-slate-500 text-sm">Stocks by sector, and by NSE index</span>
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => (t.key === "sectors" ? setParams({}) : setParams({ tab: t.key }))}
            className={`text-sm px-3 py-1.5 rounded-full border whitespace-nowrap ${
              tab === t.key ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "sectors" ? <SectorDirectory /> : <IndexList index={(active as { index: string }).index} />}
    </div>
  );
}
