import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData, useScreeners } from "../App";
import { Col, GenericTable, MethodologyNote, PriceLink, ScreenerLoading, Signed, fmtNum } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";

// 2026-09-19 — "let's start on all fundamentals page", the fundamentals
// counterpart to All Technicals (same "one table, client-side join,
// no new API calls" design).
//
// 2026-09-20 ("too many columns but lesser page width so provide
// option to select the columns to view") — switched from a per-GROUP
// picker to a per-COLUMN one: every column (including what used to be
// permanently "always visible" — Sector, Market Cap, Revenue, etc.) is
// now individually togglable, so the table can be trimmed much
// narrower than "on/off per group" allowed. Only Rank/Symbol/Name/
// Price stay mandatory (a row without at least those doesn't mean
// anything). Each column still carries a `source` tag for the
// existing "only show rows with data" filter — that logic is
// unchanged, it just now activates for whichever SOURCES have at
// least one of their own columns currently checked, rather than one
// checkbox per whole group.
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
// reverseDcfScanNse750/turtleWealth both read FROM that same cache, so
// a stock missing there is missing everywhere on this page.

const DASH = <span className="text-slate-300">—</span>;
function boolCell(v: any, positiveColor = "text-emerald-600") {
  return v ? <span className={`${positiveColor} font-semibold`}>Y</span> : DASH;
}

// 2026-09-19 ("under fundamental main requirement is to have last 6
// qtrs sales growth, opm%, epsGrowth") — a small inline sparkline over
// the last 6 quarters of one metric, same visual language as
// Summary.tsx's own TrendSparkline. `values` can carry the string "T"
// (turned profitable from a loss — same convention used elsewhere in
// this app) alongside numbers/null; "T" points are skipped from the
// LINE (nothing to plot a slope against) but still show up in the
// hover tooltip.
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

interface ColumnDef extends Col {
  group: string; // for organizing the picker UI
  source?: string; // maps to the row's _has_${source} flag for "only show rows with data"; omitted = mandatory/always-relevant, never filtered
  mandatory?: boolean; // always shown, not in the picker at all
}

const VERDICT_COLOR: Record<string, string> = {
  undervalued: "text-emerald-600",
  overvalued: "text-red-600",
  "fairly valued": "text-slate-500",
};

const ALL_COLUMNS: ColumnDef[] = [
  { key: "rank", label: "#", group: "Core", mandatory: true },
  { key: "symbol", label: "Symbol", align: "left", group: "Core", mandatory: true },
  { key: "name", label: "Name", align: "left", group: "Core", mandatory: true },
  { key: "price", label: "Price", group: "Core", mandatory: true, render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
  { key: "sector", label: "Sector", align: "left", group: "Core", source: "core" },
  { key: "market_cap_cr", label: "Market Cap ₹Cr", group: "Core", source: "core", render: (r) => fmtNum(r.market_cap_cr, 0) },
  { key: "revenue_cr", label: "Revenue ₹Cr", group: "Core", source: "core", render: (r) => fmtNum(r.revenue_cr, 0) },
  { key: "opm_pct", label: "OPM % (Annual)", group: "Core", source: "core", render: (r) => <Signed v={r.opm_pct} digits={1} /> },
  { key: "tax_pct", label: "Tax %", group: "Core", source: "core", render: (r) => <Signed v={r.tax_pct} digits={1} /> },
  {
    key: "working_capital_days",
    label: "Working Capital Days",
    group: "Core",
    source: "core",
    render: (r) => (typeof r.working_capital_days === "number" ? fmtNum(r.working_capital_days, 0) : DASH),
  },

  {
    key: "q_sales_growth_latest",
    label: "Sales Gr % (Latest Qtr)",
    group: "Quarterly Trend (6Q)",
    source: "quarterly",
    render: (r) => (typeof r.q_sales_growth_latest === "number" ? <Signed v={r.q_sales_growth_latest} digits={1} /> : DASH),
  },
  {
    key: "q_sales_growth_trend",
    label: "Sales Gr Trend (6Q)",
    group: "Quarterly Trend (6Q)",
    source: "quarterly",
    render: (r) => <QuarterlySparkline labels={r.q_labels ?? []} values={r.q_sales_growth ?? []} />,
  },
  {
    // 2026-09-20 ("instead of OPM details, replace with Operating
    // profit growth and trend") — was raw OPM% (latest qtr + trend)
    // before; OPM% still lives above as an ANNUAL figure (Core group).
    key: "q_op_growth_latest",
    label: "Op Profit Gr % (Latest Qtr)",
    group: "Quarterly Trend (6Q)",
    source: "quarterly",
    render: (r) =>
      r.q_op_growth_latest === "T" ? (
        <span className="text-xs font-medium text-emerald-700" title="Year-ago quarter's Operating Profit was negative — turned profitable">
          Turned profitable
        </span>
      ) : typeof r.q_op_growth_latest === "number" ? (
        <Signed v={r.q_op_growth_latest} digits={1} />
      ) : (
        DASH
      ),
  },
  {
    key: "q_op_growth_trend",
    label: "Op Profit Gr Trend (6Q)",
    group: "Quarterly Trend (6Q)",
    source: "quarterly",
    render: (r) => <QuarterlySparkline labels={r.q_labels ?? []} values={r.q_op_growth ?? []} />,
  },
  {
    key: "q_eps_growth_latest",
    label: "EPS Gr % (Latest Qtr)",
    group: "Quarterly Trend (6Q)",
    source: "quarterly",
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
  {
    key: "q_eps_growth_trend",
    label: "EPS Gr Trend (6Q)",
    group: "Quarterly Trend (6Q)",
    source: "quarterly",
    render: (r) => <QuarterlySparkline labels={r.q_labels ?? []} values={r.q_eps_growth ?? []} />,
  },

  {
    key: "rdcf_implied_price",
    label: "Implied Price",
    group: "Reverse DCF",
    source: "rdcf",
    render: (r) => (r.rdcf_implied_price === null || r.rdcf_implied_price === undefined ? DASH : `₹${fmtNum(r.rdcf_implied_price, 1)}`),
  },
  { key: "rdcf_gap_pct", label: "Valuation Gap %", group: "Reverse DCF", source: "rdcf", render: (r) => <Signed v={r.rdcf_gap_pct} digits={1} /> },
  {
    key: "rdcf_verdict",
    label: "Verdict",
    align: "left",
    group: "Reverse DCF",
    source: "rdcf",
    render: (r) => (r.rdcf_verdict ? <span className={`font-medium ${VERDICT_COLOR[r.rdcf_verdict] ?? "text-slate-600"}`}>{r.rdcf_verdict}</span> : DASH),
  },
  { key: "rdcf_flat_growth", label: "Market-Implied Growth %", group: "Reverse DCF", source: "rdcf", render: (r) => <Signed v={r.rdcf_flat_growth} digits={1} /> },
  { key: "rdcf_avg3y_growth", label: "3Y Avg Growth %", group: "Reverse DCF", source: "rdcf", render: (r) => <Signed v={r.rdcf_avg3y_growth} digits={1} /> },

  { key: "tw_price_ath", label: "Price ATH", group: "Turtle Wealth (ATH Framework)", source: "turtle", render: (r) => boolCell(r.tw_price_ath) },
  { key: "tw_pct_off_ath", label: "% off Price ATH", group: "Turtle Wealth (ATH Framework)", source: "turtle", render: (r) => <Signed v={r.tw_pct_off_ath} digits={1} /> },
  { key: "tw_sales_ath", label: "Sales ATH", group: "Turtle Wealth (ATH Framework)", source: "turtle", render: (r) => boolCell(r.tw_sales_ath) },
  { key: "tw_profit_ath", label: "Profit ATH", group: "Turtle Wealth (ATH Framework)", source: "turtle", render: (r) => boolCell(r.tw_profit_ath) },
  {
    key: "tw_all_three",
    label: "All Three (Super Performer)",
    group: "Turtle Wealth (ATH Framework)",
    source: "turtle",
    render: (r) => boolCell(r.tw_all_three, "text-indigo-600"),
  },
  { key: "tw_alpha_52w", label: "Alpha vs NSE500 (52W)", group: "Turtle Wealth (ATH Framework)", source: "turtle", render: (r) => <Signed v={r.tw_alpha_52w} digits={1} /> },

  // 2026-09-23 ("add a new column for fixed asset change... and CWIP
  // change") — same nse750Fundamentals cache, no new fetch (see its
  // own fixed_assets_*/cwip_* comment for the Screener.in source).
  { key: "fixed_assets_1y_chg", label: "Fixed Asset Δ 1Yr", group: "Fixed Assets / CWIP", source: "capex", render: (r) => <Signed v={r.fixed_assets_1y_chg} digits={1} /> },
  { key: "fixed_assets_2y_chg", label: "Fixed Asset Δ 2Yr", group: "Fixed Assets / CWIP", source: "capex", render: (r) => <Signed v={r.fixed_assets_2y_chg} digits={1} /> },
  { key: "fixed_assets_3y_chg", label: "Fixed Asset Δ 3Yr", group: "Fixed Assets / CWIP", source: "capex", render: (r) => <Signed v={r.fixed_assets_3y_chg} digits={1} /> },
  { key: "cwip_1y_chg", label: "CWIP Δ 1Yr", group: "Fixed Assets / CWIP", source: "capex", render: (r) => <Signed v={r.cwip_1y_chg} digits={1} /> },
  { key: "cwip_2y_chg", label: "CWIP Δ 2Yr", group: "Fixed Assets / CWIP", source: "capex", render: (r) => <Signed v={r.cwip_2y_chg} digits={1} /> },
  { key: "cwip_3y_chg", label: "CWIP Δ 3Yr", group: "Fixed Assets / CWIP", source: "capex", render: (r) => <Signed v={r.cwip_3y_chg} digits={1} /> },
];

const COLUMN_GROUP_ORDER = Array.from(new Set(ALL_COLUMNS.map((c) => c.group)));
const OPTIONAL_COLUMNS = ALL_COLUMNS.filter((c) => !c.mandatory);
const MANDATORY_COLUMNS = ALL_COLUMNS.filter((c) => c.mandatory);

const STORAGE_KEY = "allFundamentalsColumns";
// A lean-but-useful starting point, not everything — "too many
// columns but lesser page width" was the whole point of this redesign.
const DEFAULT_ENABLED = ["sector", "market_cap_cr", "q_sales_growth_latest", "q_sales_growth_trend", "q_op_growth_latest", "q_op_growth_trend", "q_eps_growth_latest", "q_eps_growth_trend"];

function loadEnabledColumns(): Set<string> {
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
  const { ready } = useScreeners(["nseScreener", "nse750Fundamentals", "reverseDcfScanNse750", "turtleWealth"]);
  const ms = bundle.momentum_screeners;

  const [enabledCols, setEnabledCols] = useState<Set<string>>(() => loadEnabledColumns());
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(enabledCols)));
    } catch {
      // best-effort persistence only
    }
  }, [enabledCols]);

  function toggleCol(key: string) {
    setEnabledCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
        working_capital_days: fund?.working_capital_days ?? null,

        q_labels: fund?.q_labels ?? [],
        q_sales_growth: fund?.q_sales_growth ?? [],
        q_sales_growth_latest: latestNonNull(fund?.q_sales_growth),
        q_op_growth: fund?.q_op_growth ?? [],
        q_op_growth_latest: latestNonNull(fund?.q_op_growth),
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

        fixed_assets_1y_chg: fund?.fixed_assets_1y_chg ?? null,
        fixed_assets_2y_chg: fund?.fixed_assets_2y_chg ?? null,
        fixed_assets_3y_chg: fund?.fixed_assets_3y_chg ?? null,
        cwip_1y_chg: fund?.cwip_1y_chg ?? null,
        cwip_2y_chg: fund?.cwip_2y_chg ?? null,
        cwip_3y_chg: fund?.cwip_3y_chg ?? null,

        _has_core: !!fund,
        _has_quarterly: !!(fund?.q_labels && fund.q_labels.length > 0),
        _has_rdcf: !!rdcf,
        _has_turtle: !!tw,
        _has_capex: typeof fund?.fixed_assets_1y_chg === "number",
      };
    });
  }, [ms]);

  const cols: Col[] = useMemo(() => {
    const optional = OPTIONAL_COLUMNS.filter((c) => enabledCols.has(c.key));
    return [...MANDATORY_COLUMNS, ...optional];
  }, [enabledCols]);

  const activeSources = useMemo(() => new Set(OPTIONAL_COLUMNS.filter((c) => enabledCols.has(c.key) && c.source).map((c) => c.source!)), [enabledCols]);

  const [onlyMatches, setOnlyMatches] = useState(true);
  const displayedRows = useMemo(() => {
    const base =
      !onlyMatches || activeSources.size === 0 ? rows : rows.filter((r: any) => Array.from(activeSources).some((src) => r[`_has_${src}`]));
    return base.map((r: any, i: number) => ({ ...r, rank: i + 1 }));
  }, [rows, activeSources, onlyMatches]);

  const asOf = ms?.nse750Fundamentals?.as_of;

  if (!ready) return <ScreenerLoading label="All Fundamentals" />;

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
        Cap/Revenue/OPM%/Tax%/Working Capital Days). Unlike the technical screeners, a blank fundamentals cell here usually means
        Screener.in doesn't have clean numbers for that stock yet (a very recent IPO, an unparseable page) — <b>nse750Fundamentals</b> isn't
        100% of NSE750 the way <b>nseScreener</b> is. Reverse DCF/Turtle Wealth read from that SAME cache, so a stock missing core
        fundamentals is missing those too. <b>Working Capital Days</b> is Screener's own annual "Working Capital Days" row (latest
        year) — not derived from Debtor/Inventory/Payable Days here, that's Screener's own single figure. There is no{" "}
        <b>Gross Margin</b> column: Indian P&amp;L filings don't report a separate Cost-of-Goods-Sold line the way US filings do, so
        Screener.in has nothing to source a true gross margin from for any Indian company — <b>OPM%</b> (Operating Profit Margin, already
        above) is the closest real metric it publishes. <b>Quarterly Trend</b> shows the last 6 reported quarters' Sales/Operating
        Profit/EPS Growth% (all YoY, vs. the same quarter a year back) — a hover on the trend line shows all 6 quarters' labels and
        values; "Turned profitable" means the year-ago quarter's figure was negative, so no % would be honest against that base.
        Banks/NBFCs/HFCs show <b>—</b> for OPM%, Operating Profit Growth, and Working Capital Days specifically — Screener.in labels their
        margin "Financing Margin %" instead (a different line item this page doesn't attempt to reconcile) and has no "Operating Profit"
        row or working-capital cycle for them at all (Sales/EPS growth still show normally for these). <b>Reverse DCF</b> solves for the
        growth rate the market's current price already implies, then stages it down (see that tab's own methodology for the
        WACC/terminal-growth assumptions) to flag under/over/fairly valued. <b>Turtle Wealth</b> flags whether price/sales/profit are each
        at their own all-time high (per Screener's own multi-year table) — "All Three" is the closest this app gets to Turtle Wealth's own
        "Super Performer" bucket (their real framework also weighs Outperformance vs sector, not modeled here yet). <b>Fixed Asset Δ</b>/
        <b>CWIP Δ</b> are real % growth (not percentage-point change — these are ₹ Balance Sheet figures, not ratios) over 1/2/3 years;
        see the dedicated <b>Fixed Asset Δ</b> page for the same factor sorted/filtered on its own. Every column below
        (except #/Symbol/Name/Price) can be individually shown/hidden with the column picker — picks are remembered on this device.
      </MethodologyNote>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => setPickerOpen((v) => !v)}
          className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:border-slate-400 font-medium"
        >
          🎛️ Columns ({enabledCols.size} of {OPTIONAL_COLUMNS.length} shown) {pickerOpen ? "▲" : "▼"}
        </button>
        {activeSources.size > 0 && (
          <label
            className="flex items-center gap-2 text-sm cursor-pointer text-slate-600"
            title="With this on, only rows that actually have data in a currently-checked column are shown — otherwise stocks Screener.in has no fundamentals for yet show all-blank rows"
          >
            <input type="checkbox" checked={onlyMatches} onChange={(e) => setOnlyMatches(e.target.checked)} />
            Only show rows with data in the checked columns
          </label>
        )}
      </div>
      {pickerOpen && (
        <div className="mb-4 p-3 border border-slate-200 rounded-lg bg-slate-50 space-y-3">
          {COLUMN_GROUP_ORDER.map((group) => {
            const groupCols = OPTIONAL_COLUMNS.filter((c) => c.group === group);
            if (groupCols.length === 0) return null;
            return (
              <div key={group}>
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{group}</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {groupCols.map((c) => (
                    <label key={c.key} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={enabledCols.has(c.key)} onChange={() => toggleCol(c.key)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <GenericTable
        rows={displayedRows}
        cols={cols}
        navigate={(t) => navigate(`/company/${t}`)}
        watchlist={watchlist}
        emptyMessage={
          rows.length > 0
            ? "No stocks currently match the checked columns — try unchecking \"Only show rows with data\" or a different column."
            : "No fundamentals data yet — the nseScreener/nse750Fundamentals crons haven't run."
        }
      />
    </div>
  );
}
