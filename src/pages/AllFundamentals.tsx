import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import { Col, GenericTable, MethodologyNote, PriceLink, Signed, fmtNum } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";

// 2026-09-19 — "let's start on all fundamentals page", the fundamentals
// counterpart to All Technicals (same "one table, client-side join,
// no new API calls" design). Same interaction model too (a column
// picker with togglable groups, "only show matches" for sparse
// groups) — deliberately kept, even though there are only 2 groups
// here vs All Technicals' 14, so the two pages behave identically
// rather than teaching a second UI pattern for a smaller table.
//
// Base universe is nseScreener's own rows again (full unconditional
// NSE750 coverage, has name+sector — nse750Fundamentals itself has
// NEITHER of those fields, only symbol/price/marketcap/etc., since
// _run_nse750_fundamentals_cache never threads name_map/sector_map
// through). nse750Fundamentals coverage is NOT 100% of NSE750 either
// (a stock Screener.in has no clean numbers for yet — a very recent
// IPO, a parse failure — simply never lands in that cache), so the
// "core" fundamentals columns (Market Cap/Revenue/OPM/Tax) are blank
// for those, same disclosed-sparse pattern as All Technicals, just a
// coverage-gap reason instead of a "not currently triggered" one.
// Both toggle groups (Reverse DCF, Turtle Wealth) read FROM that same
// cache, so a stock missing there is missing everywhere on this page.

const DASH = <span className="text-slate-300">—</span>;
function boolCell(v: any, positiveColor = "text-emerald-600") {
  return v ? <span className={`${positiveColor} font-semibold`}>Y</span> : DASH;
}

// 2026-09-19 ("under fundamental main requirement is to have last 6
// qtrs sales growth, opm%, epsGrowth") — a small inline sparkline over
// the last 6 quarters of one metric (Sales Growth%/OPM%/EPS Growth%),
// same visual language as Summary.tsx's own TrendSparkline. `values`
// can carry the string "T" (EPS turned profitable from a loss —
// same convention used elsewhere in this app) alongside numbers/null;
// "T" points are skipped from the LINE (nothing to plot a slope
// against) but still show up in the hover tooltip.
function QuarterlySparkline({ labels, values }: { labels: string[]; values: (number | string | null)[] }) {
  const numeric = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => typeof x.v === "number");
  if (numeric.length < 2) return DASH;

  const W = 60;
  const H = 22;
  const PAD = 3;
  const vals = numeric.map((x) => x.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const step = (W - PAD * 2) / (Math.max(values.length, 2) - 1);
  const coords = numeric.map(({ v, i }) => {
    const x = PAD + i * step;
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
    return [x, y] as [number, number];
  });
  const up = vals[vals.length - 1] >= vals[0];
  const color = up ? "#16a34a" : "#dc2626";
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const title = labels.map((lb, i) => `${lb}: ${values[i] === null || values[i] === undefined ? "—" : values[i] === "T" ? "Turned profitable" : `${values[i]}%`}`).join(" → ");

  return (
    <span title={title}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function latestNonNull(values: (number | string | null | undefined)[] | undefined): number | string | null {
  if (!values) return null;
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null && values[i] !== undefined) return values[i] as number | string;
  }
  return null;
}

interface ColumnGroup {
  id: string;
  label: string;
  cols: Col[];
}

const ALWAYS_COLS: Col[] = [
  { key: "rank", label: "#" },
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "name", label: "Name", align: "left" },
  { key: "sector", label: "Sector", align: "left" },
  { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
  { key: "market_cap_cr", label: "Market Cap ₹Cr", render: (r) => fmtNum(r.market_cap_cr, 0) },
  { key: "revenue_cr", label: "Revenue ₹Cr", render: (r) => fmtNum(r.revenue_cr, 0) },
  { key: "opm_pct", label: "OPM %", render: (r) => <Signed v={r.opm_pct} digits={1} /> },
  { key: "tax_pct", label: "Tax %", render: (r) => <Signed v={r.tax_pct} digits={1} /> },
];

const VERDICT_COLOR: Record<string, string> = {
  undervalued: "text-emerald-600",
  overvalued: "text-red-600",
  "fairly valued": "text-slate-500",
};

const COLUMN_GROUPS: ColumnGroup[] = [
  {
    id: "quarterly",
    label: "Quarterly Trend (6Q)",
    cols: [
      {
        key: "q_sales_growth_latest",
        label: "Sales Gr % (Latest Qtr)",
        render: (r) => (typeof r.q_sales_growth_latest === "number" ? <Signed v={r.q_sales_growth_latest} digits={1} /> : DASH),
      },
      { key: "q_sales_growth_trend", label: "Sales Gr Trend (6Q)", render: (r) => <QuarterlySparkline labels={r.q_labels ?? []} values={r.q_sales_growth ?? []} /> },
      {
        key: "q_opm_latest",
        label: "OPM % (Latest Qtr)",
        render: (r) => (typeof r.q_opm_latest === "number" ? <Signed v={r.q_opm_latest} digits={1} /> : DASH),
      },
      { key: "q_opm_trend", label: "OPM % Trend (6Q)", render: (r) => <QuarterlySparkline labels={r.q_labels ?? []} values={r.q_opm ?? []} /> },
      {
        key: "q_eps_growth_latest",
        label: "EPS Gr % (Latest Qtr)",
        render: (r) =>
          r.q_eps_growth_latest === "T" ? (
            <span className="text-xs font-medium text-emerald-700" title="Year-ago quarter was a loss — turned profitable">
              Turned profitable
            </span>
          ) : typeof r.q_eps_growth_latest === "number" ? (
            <Signed v={r.q_eps_growth_latest} digits={1} />
          ) : (
            DASH
          ),
      },
      { key: "q_eps_growth_trend", label: "EPS Gr Trend (6Q)", render: (r) => <QuarterlySparkline labels={r.q_labels ?? []} values={r.q_eps_growth ?? []} /> },
    ],
  },
  {
    id: "rdcf",
    label: "Reverse DCF",
    cols: [
      { key: "rdcf_implied_price", label: "Implied Price", render: (r) => (r.rdcf_implied_price === null || r.rdcf_implied_price === undefined ? DASH : `₹${fmtNum(r.rdcf_implied_price, 1)}`) },
      { key: "rdcf_gap_pct", label: "Valuation Gap %", render: (r) => <Signed v={r.rdcf_gap_pct} digits={1} /> },
      {
        key: "rdcf_verdict",
        label: "Verdict",
        align: "left",
        render: (r) => (r.rdcf_verdict ? <span className={`font-medium ${VERDICT_COLOR[r.rdcf_verdict] ?? "text-slate-600"}`}>{r.rdcf_verdict}</span> : DASH),
      },
      { key: "rdcf_flat_growth", label: "Market-Implied Growth %", render: (r) => <Signed v={r.rdcf_flat_growth} digits={1} /> },
      { key: "rdcf_avg3y_growth", label: "3Y Avg Growth %", render: (r) => <Signed v={r.rdcf_avg3y_growth} digits={1} /> },
    ],
  },
  {
    id: "turtle",
    label: "Turtle Wealth (ATH Framework)",
    cols: [
      { key: "tw_price_ath", label: "Price ATH", render: (r) => boolCell(r.tw_price_ath) },
      { key: "tw_pct_off_ath", label: "% off Price ATH", render: (r) => <Signed v={r.tw_pct_off_ath} digits={1} /> },
      { key: "tw_sales_ath", label: "Sales ATH", render: (r) => boolCell(r.tw_sales_ath) },
      { key: "tw_profit_ath", label: "Profit ATH", render: (r) => boolCell(r.tw_profit_ath) },
      { key: "tw_all_three", label: "All Three (Super Performer)", render: (r) => boolCell(r.tw_all_three, "text-indigo-600") },
      { key: "tw_alpha_52w", label: "Alpha vs NSE500 (52W)", render: (r) => <Signed v={r.tw_alpha_52w} digits={1} /> },
    ],
  },
];

const STORAGE_KEY = "allFundamentalsColumnGroups";
const DEFAULT_ENABLED = ["quarterly"]; // "under fundamental main requirement is to have last 6 qtrs sales growth, opm%, epsGrowth" — the flagship group, on by default

function loadEnabledGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {
    // localStorage unavailable/corrupt — fall through to default
  }
  return new Set(DEFAULT_ENABLED);
}

function keyBy<T extends Record<string, any>>(rows: T[] | undefined): Map<string, T> {
  const map = new Map<string, T>();
  for (const r of rows ?? []) {
    if (r.symbol) map.set(r.symbol, r);
  }
  return map;
}

export default function AllFundamentals() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const ms = bundle.momentum_screeners;

  const [enabledGroups, setEnabledGroups] = useState<Set<string>>(() => loadEnabledGroups());
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(enabledGroups)));
    } catch {
      // best-effort persistence only
    }
  }, [enabledGroups]);

  function toggleGroup(id: string) {
    setEnabledGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const rows = useMemo(() => {
    const base = ms?.nseScreener?.rows ?? [];
    const fundMap = keyBy(ms?.nse750Fundamentals?.rows);
    const rdcfMap = keyBy(ms?.reverseDcfScanNse750?.rows);
    const twMap = keyBy(ms?.turtleWealth?.rows);

    return base.map((b: any) => {
      const sym = b.symbol;
      const fund = fundMap.get(sym);
      const rdcf = rdcfMap.get(sym);
      const tw = twMap.get(sym);
      const revenue0 = fund?.revenue_hist?.length ? fund.revenue_hist[fund.revenue_hist.length - 1] : null;

      return {
        symbol: sym,
        name: b.name,
        sector: b.sector,
        price: fund?.current_price ?? b.price,
        market_cap_cr: fund?.marketcap ?? null,
        revenue_cr: revenue0,
        opm_pct: fund?.opm_pct ?? null,
        tax_pct: fund?.tax_pct ?? null,

        q_labels: fund?.q_labels ?? [],
        q_sales_growth: fund?.q_sales_growth ?? [],
        q_sales_growth_latest: latestNonNull(fund?.q_sales_growth),
        q_opm: fund?.q_opm ?? [],
        q_opm_latest: latestNonNull(fund?.q_opm),
        q_eps_growth: fund?.q_eps_growth ?? [],
        q_eps_growth_latest: latestNonNull(fund?.q_eps_growth),

        rdcf_implied_price: rdcf?.implied_price_per_share ?? null,
        rdcf_gap_pct: rdcf?.valuation_gap_pct ?? null,
        rdcf_verdict: rdcf?.verdict ?? null,
        rdcf_flat_growth: rdcf?.flat_growth_pct ?? null,
        rdcf_avg3y_growth: rdcf?.avg_3y_growth_pct ?? null,

        tw_price_ath: tw?.price_ath ?? false,
        tw_pct_off_ath: tw?.pct_off_ath ?? null,
        tw_sales_ath: tw?.sales_ath ?? false,
        tw_profit_ath: tw?.profit_ath ?? false,
        tw_all_three: tw?.all_three ?? false,
        tw_alpha_52w: tw?.alpha_52w ?? null,

        _has_quarterly: !!(fund?.q_labels && fund.q_labels.length > 0),
        _has_rdcf: !!rdcf,
        _has_turtle: !!tw,
      };
    });
  }, [ms]);

  const cols: Col[] = useMemo(() => {
    const active = COLUMN_GROUPS.filter((g) => enabledGroups.has(g.id)).flatMap((g) => g.cols);
    return [...ALWAYS_COLS, ...active];
  }, [enabledGroups]);

  const [onlyMatches, setOnlyMatches] = useState(true);
  const displayedRows = useMemo(() => {
    const base =
      !onlyMatches || enabledGroups.size === 0
        ? rows
        : rows.filter((r: any) => Array.from(enabledGroups).some((id) => r[`_has_${id}`]));
    return base.map((r: any, i: number) => ({ ...r, rank: i + 1 }));
  }, [rows, enabledGroups, onlyMatches]);

  const asOf = ms?.nse750Fundamentals?.as_of;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">📚 All Fundamentals</h1>
        <span className="text-slate-500 text-sm">Every NSE750 stock, every fundamentals screener, one table</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Refreshed by the existing per-screener crons (Momentum Screeners tabs) — this page just joins what's already fetched, client-side.
        {asOf && <> Fundamentals data as of {asOf}.</>}
      </p>

      <MethodologyNote>
        One row per NSE750 stock, sourced from <b>nseScreener</b> (name/sector/price) joined against <b>nse750Fundamentals</b> (Market
        Cap/Revenue/OPM%/Tax%). Unlike the technical screeners, a blank fundamentals cell here usually means Screener.in doesn't have
        clean numbers for that stock yet (a very recent IPO, an unparseable page) — <b>nse750Fundamentals</b> isn't 100% of NSE750 the way{" "}
        <b>nseScreener</b> is. All three toggle groups below read from that SAME cache, so a stock missing core fundamentals is missing all
        of them too. <b>Quarterly Trend</b> shows the last 6 reported quarters' Sales Growth% and EPS Growth% (both YoY, vs. the same
        quarter a year back) and OPM% (raw, not YoY) — a hover on the trend line shows all 6 quarters' labels and values; "Turned
        profitable" means the year-ago quarter's EPS was a loss, so no % would be honest against a negative base. Banks/NBFCs/HFCs show{" "}
        <b>—</b> for OPM% specifically — Screener.in labels their margin "Financing Margin %" instead, a different line item this page
        doesn't attempt to reconcile with OPM% (Sales/EPS growth still show normally for these). <b>Reverse DCF</b> solves for the growth
        rate the market's current price already implies, then stages it down (see that tab's own methodology for the WACC/terminal-growth
        assumptions) to flag under/over/fairly valued. <b>Turtle Wealth</b> flags whether price/sales/profit are each at their own
        all-time high (per Screener's own multi-year table) — "All Three" is the closest this app gets to Turtle Wealth's own "Super
        Performer" bucket (their real framework also weighs Outperformance vs sector, not modeled here yet). Use the column picker to
        show only what you care about — picks are remembered on this device.
      </MethodologyNote>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => setPickerOpen((v) => !v)}
          className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:border-slate-400 font-medium"
        >
          🎛️ Columns ({enabledGroups.size} of {COLUMN_GROUPS.length} groups shown) {pickerOpen ? "▲" : "▼"}
        </button>
        {enabledGroups.size > 0 && (
          <label
            className="flex items-center gap-2 text-sm cursor-pointer text-slate-600"
            title="With this on, only rows that actually have data in at least one checked group are shown — otherwise stocks Screener.in has no fundamentals for yet show all-blank rows"
          >
            <input type="checkbox" checked={onlyMatches} onChange={(e) => setOnlyMatches(e.target.checked)} />
            Only show rows with data in the checked columns
          </label>
        )}
      </div>
      {pickerOpen && (
        <div className="mb-4 p-3 border border-slate-200 rounded-lg bg-slate-50 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {COLUMN_GROUPS.map((g) => (
            <label key={g.id} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={enabledGroups.has(g.id)} onChange={() => toggleGroup(g.id)} />
              {g.label}
            </label>
          ))}
        </div>
      )}

      <GenericTable
        rows={displayedRows}
        cols={cols}
        navigate={(t) => navigate(`/company/${t}`)}
        watchlist={watchlist}
        emptyMessage={
          rows.length > 0
            ? "No stocks currently match the checked columns — try unchecking \"Only show rows with data\" or a different column group."
            : "No fundamentals data yet — the nseScreener/nse750Fundamentals crons haven't run."
        }
      />
    </div>
  );
}
