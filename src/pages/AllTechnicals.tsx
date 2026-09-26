import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData, useScreeners } from "../App";
import { Col, GenericTable, MethodologyNote, PriceLink, ScreenerLoading, Signed, fmtNum } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";

// 2026-09-18 — "design for technical and fundamental in intention to
// speed up the app and reduce redundant info across pages" -> "let's
// start on all technicals page". One row per NSE750 stock, joining
// every technical screener's own already-fetched data client-side
// (bundle.momentum_screeners[...] — no new API calls, no new crons;
// the backend/cron side of "speed up" was handled separately, see the
// technical cron consolidation). Base universe is nseScreener's own
// rows (the only technical screener with full, unconditional NSE750
// coverage) — every other screener here is inherently SPARSE by
// design (maBreakout only shows stocks with a fresh cross this week,
// quantBollinger only current breakout signals, etc.), so most of the
// optional columns are blank for most rows most of the time — that's
// the screener saying "not currently triggered", not missing data.
//
// 2026-09-20 ("too many columns but lesser page width so provide
// option to select the columns to view") — switched from a per-GROUP
// picker to a per-COLUMN one: every column (including what used to be
// permanently "always visible" — Sector, Day/Week/Month/3M/Year %,
// every RSI) is now individually togglable, so the table can be
// trimmed much narrower than "on/off per group" allowed. Only Rank/
// Symbol/Name/Price stay mandatory. Each column still carries a
// `source` tag for the existing "only show rows with data" filter —
// unchanged logic, it just now activates for whichever SOURCES have
// at least one of their own columns currently checked.

const Y = <span className="text-emerald-600 font-semibold">Y</span>;
const DASH = <span className="text-slate-300">—</span>;
function boolCell(v: any) {
  return v ? Y : DASH;
}

interface ColumnDef extends Col {
  group: string; // for organizing the picker UI
  source?: string; // maps to the row's _has_${source} flag for "only show rows with data"; omitted = mandatory/always-relevant, never filtered
  mandatory?: boolean; // always shown, not in the picker at all
}

const ALL_COLUMNS: ColumnDef[] = [
  { key: "rank", label: "#", group: "Core", mandatory: true },
  { key: "symbol", label: "Symbol", align: "left", group: "Core", mandatory: true },
  { key: "name", label: "Name", align: "left", group: "Core", mandatory: true },
  { key: "price", label: "Price", group: "Core", mandatory: true, render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
  { key: "sector", label: "Sector", align: "left", group: "Core", source: "core" },
  { key: "change_pct", label: "Day %", group: "Core", source: "core", render: (r) => <Signed v={r.change_pct} digits={1} /> },
  { key: "weekly_pct", label: "Week %", group: "Core", source: "core", render: (r) => <Signed v={r.weekly_pct} digits={1} /> },
  { key: "monthly_pct", label: "Month %", group: "Core", source: "core", render: (r) => <Signed v={r.monthly_pct} digits={1} /> },
  { key: "three_month_pct", label: "3M %", group: "Core", source: "core", render: (r) => <Signed v={r.three_month_pct} digits={1} /> },
  { key: "yearly_pct", label: "Year %", group: "Core", source: "core", render: (r) => <Signed v={r.yearly_pct} digits={1} /> },
  { key: "rsi_d", label: "RSI(D)", group: "Core", source: "core", render: (r) => fmtNum(r.rsi_d, 1) },
  { key: "rsi_w", label: "RSI(W)", group: "Core", source: "core", render: (r) => fmtNum(r.rsi_w, 1) },
  { key: "rsi_m", label: "RSI(M)", group: "Core", source: "core", render: (r) => fmtNum(r.rsi_m, 1) },
  { key: "three_week_green", label: "3W Green", group: "Core", source: "core", render: (r) => boolCell(r.three_week_green) },

  { key: "rs_1w", label: "RS 1W", group: "Relative Strength", source: "rs", render: (r) => <Signed v={r.rs_1w} digits={1} /> },
  { key: "rs_1m", label: "RS 1M", group: "Relative Strength", source: "rs", render: (r) => <Signed v={r.rs_1m} digits={1} /> },
  { key: "rs_3m", label: "RS 3M", group: "Relative Strength", source: "rs", render: (r) => <Signed v={r.rs_3m} digits={1} /> },
  { key: "rs_6m", label: "RS 6M", group: "Relative Strength", source: "rs", render: (r) => <Signed v={r.rs_6m} digits={1} /> },
  { key: "rs_score", label: "RS Score", group: "Relative Strength", source: "rs", render: (r) => fmtNum(r.rs_score, 1) },
  { key: "rs_new_high", label: "RS New High", group: "Relative Strength", source: "rs", render: (r) => boolCell(r.rs_new_high) },

  { key: "alpha_1w", label: "Alpha 1W", group: "Sector Alpha", source: "alpha", render: (r) => <Signed v={r.alpha_1w} digits={1} /> },
  { key: "alpha_1m", label: "Alpha 1M", group: "Sector Alpha", source: "alpha", render: (r) => <Signed v={r.alpha_1m} digits={1} /> },
  { key: "alpha_3m", label: "Alpha 3M", group: "Sector Alpha", source: "alpha", render: (r) => <Signed v={r.alpha_3m} digits={1} /> },
  { key: "alpha_6m", label: "Alpha 6M", group: "Sector Alpha", source: "alpha", render: (r) => <Signed v={r.alpha_6m} digits={1} /> },
  { key: "alpha_1y", label: "Alpha 1Y", group: "Sector Alpha", source: "alpha", render: (r) => <Signed v={r.alpha_1y} digits={1} /> },
  { key: "alpha_score", label: "Alpha Score", group: "Sector Alpha", source: "alpha", render: (r) => <Signed v={r.alpha_score} digits={1} /> },

  { key: "high52w_pct_off", label: "% off 52W High", group: "52W High", source: "high52w", render: (r) => <Signed v={r.high52w_pct_off} digits={1} /> },
  { key: "high52w_new", label: "New 52W High", group: "52W High", source: "high52w", render: (r) => boolCell(r.high52w_new) },

  { key: "low52w_pct_off", label: "% off 52W Low", group: "52W Low", source: "low52w", render: (r) => <Signed v={r.low52w_pct_off} digits={1} /> },
  {
    key: "low52w_new",
    label: "New 52W Low",
    group: "52W Low",
    source: "low52w",
    render: (r) => (r.low52w_new ? <span className="text-red-600 font-semibold">Y</span> : DASH),
  },

  { key: "ath_price", label: "ATH Price", group: "All-Time High", source: "ath", render: (r) => fmtNum(r.ath_price, 1) },
  { key: "ath_pct_off", label: "% off ATH", group: "All-Time High", source: "ath", render: (r) => <Signed v={r.ath_pct_off} digits={1} /> },
  { key: "ath_new", label: "New ATH", group: "All-Time High", source: "ath", render: (r) => boolCell(r.ath_new) },

  { key: "mab_via", label: "Via", align: "left", group: "MA Breakout", source: "mab" },
  { key: "mab_pct_200d", label: "% vs 200D EMA", group: "MA Breakout", source: "mab", render: (r) => <Signed v={r.mab_pct_200d} digits={1} /> },
  { key: "mab_days_200d", label: "Days Since Cross (200D)", group: "MA Breakout", source: "mab", render: (r) => fmtNum(r.mab_days_200d, 0) },
  { key: "mab_pct_33w", label: "% vs 33W EMA", group: "MA Breakout", source: "mab", render: (r) => <Signed v={r.mab_pct_33w} digits={1} /> },
  { key: "mab_weeks_33w", label: "Weeks Since Cross (33W)", group: "MA Breakout", source: "mab", render: (r) => fmtNum(r.mab_weeks_33w, 0) },
  { key: "mab_fresh", label: "Fresh This Week", group: "MA Breakout", source: "mab", render: (r) => boolCell(r.mab_fresh) },

  { key: "ribbon_rsi14", label: "Weekly RSI14", group: "RSI+EMA Ribbon (LTIS / Weekly Signals)", source: "ribbon", render: (r) => fmtNum(r.ribbon_rsi14, 1) },
  {
    key: "ribbon_pct_33w",
    label: "% vs 33W EMA (wk)",
    group: "RSI+EMA Ribbon (LTIS / Weekly Signals)",
    source: "ribbon",
    render: (r) => <Signed v={r.ribbon_pct_33w} digits={1} />,
  },
  { key: "ribbon_buy", label: "LTIS Buy Signal", group: "RSI+EMA Ribbon (LTIS / Weekly Signals)", source: "ribbon", render: (r) => boolCell(r.ribbon_buy) },
  { key: "ws_rsi_cross", label: "Fresh RSI>66 Cross", group: "RSI+EMA Ribbon (LTIS / Weekly Signals)", source: "ribbon", render: (r) => boolCell(r.ws_rsi_cross) },
  {
    key: "ws_ema_breakdown",
    label: "Fresh 33W EMA Breakdown",
    group: "RSI+EMA Ribbon (LTIS / Weekly Signals)",
    source: "ribbon",
    render: (r) => (r.ws_ema_breakdown ? <span className="text-red-600 font-semibold">Y</span> : DASH),
  },

  { key: "vrt_rsi", label: "Monthly RSI", group: "Value RSI Turnaround", source: "vrt", render: (r) => fmtNum(r.vrt_rsi, 1) },
  { key: "vrt_rsi_at_cross", label: "RSI at Cross", group: "Value RSI Turnaround", source: "vrt", render: (r) => fmtNum(r.vrt_rsi_at_cross, 1) },
  { key: "vrt_months", label: "Months Since Cross", group: "Value RSI Turnaround", source: "vrt", render: (r) => fmtNum(r.vrt_months, 0) },
  {
    key: "vrt_gain",
    label: "RSI Gain Since Cross",
    group: "Value RSI Turnaround",
    source: "vrt",
    render: (r) => {
      if (r.vrt_gain === null || r.vrt_gain === undefined) return DASH;
      const n = Number(r.vrt_gain);
      return (
        <span className={n >= 0 ? "text-emerald-600" : "text-red-600"}>
          {n >= 0 ? "+" : ""}
          {n.toFixed(1)}
        </span>
      );
    },
  },

  { key: "gfs_monthly_rsi", label: "Monthly RSI", group: "Grandfather-Father-Son", source: "gfs", render: (r) => fmtNum(r.gfs_monthly_rsi, 1) },
  { key: "gfs_weekly_rsi", label: "Weekly RSI", group: "Grandfather-Father-Son", source: "gfs", render: (r) => fmtNum(r.gfs_weekly_rsi, 1) },
  { key: "gfs_daily_rsi", label: "Daily RSI", group: "Grandfather-Father-Son", source: "gfs", render: (r) => fmtNum(r.gfs_daily_rsi, 1) },
  { key: "gfs_support_rsi", label: "Daily RSI at Support", group: "Grandfather-Father-Son", source: "gfs", render: (r) => fmtNum(r.gfs_support_rsi, 1) },
  { key: "gfs_days_since", label: "Days Since Support", group: "Grandfather-Father-Son", source: "gfs", render: (r) => fmtNum(r.gfs_days_since, 0) },
  { key: "gfs_stop", label: "Stop Loss", group: "Grandfather-Father-Son", source: "gfs", render: (r) => fmtNum(r.gfs_stop, 1) },

  { key: "mp_high52w", label: "52W High", group: "Momentum Personal", source: "momentum", render: (r) => fmtNum(r.mp_high52w, 1) },
  { key: "mp_ma20w", label: "20W MA", group: "Momentum Personal", source: "momentum", render: (r) => fmtNum(r.mp_ma20w, 1) },
  { key: "mp_pct_ma20w", label: "% above 20W MA", group: "Momentum Personal", source: "momentum", render: (r) => <Signed v={r.mp_pct_ma20w} digits={1} /> },
  { key: "mp_sales_g", label: "Sales Growth", group: "Momentum Personal", source: "momentum", render: (r) => (r.mp_sales_g === null || r.mp_sales_g === undefined ? DASH : r.mp_sales_g) },
  { key: "mp_ebit_g", label: "EBIT Growth", group: "Momentum Personal", source: "momentum", render: (r) => (r.mp_ebit_g === null || r.mp_ebit_g === undefined ? DASH : r.mp_ebit_g) },
  { key: "mp_eps_g", label: "EPS Growth", group: "Momentum Personal", source: "momentum", render: (r) => (r.mp_eps_g === null || r.mp_eps_g === undefined ? DASH : r.mp_eps_g) },
  { key: "mp_score", label: "Score", group: "Momentum Personal", source: "momentum", render: (r) => (r.mp_score === null || r.mp_score === undefined ? DASH : r.mp_score) },

  { key: "vr_day_vol", label: "Day Volume", group: "Volume Rockers", source: "volume", render: (r) => fmtNum(r.vr_day_vol, 0) },
  { key: "vr_turnover", label: "Turnover ₹Cr", group: "Volume Rockers", source: "volume", render: (r) => fmtNum(r.vr_turnover, 1) },
  { key: "vr_vol_change", label: "Vol Change ×", group: "Volume Rockers", source: "volume", render: (r) => fmtNum(r.vr_vol_change, 1) },
  { key: "vr_day_chg", label: "Day %", group: "Volume Rockers", source: "volume", render: (r) => <Signed v={r.vr_day_chg} digits={1} /> },

  { key: "wi_roc_1y", label: "1Y ROC %", group: "Weekend Investing", source: "weekend", render: (r) => <Signed v={r.wi_roc_1y} digits={1} /> },

  { key: "qb_signal", label: "Breakout Signal", group: "Quant Bollinger", source: "bollinger", render: (r) => boolCell(r.qb_signal) },
  { key: "qb_rs55", label: "RS55 %", group: "Quant Bollinger", source: "bollinger", render: (r) => <Signed v={r.qb_rs55} digits={1} /> },
  { key: "qb_pct_band", label: "% above Upper Band", group: "Quant Bollinger", source: "bollinger", render: (r) => <Signed v={r.qb_pct_band} digits={1} /> },
  { key: "qb_pct_sma34", label: "% vs 34W SMA", group: "Quant Bollinger", source: "bollinger", render: (r) => <Signed v={r.qb_pct_sma34} digits={1} /> },
  { key: "qb_atr_stop", label: "Chandelier Stop", group: "Quant Bollinger", source: "bollinger", render: (r) => fmtNum(r.qb_atr_stop, 1) },

  { key: "sm_pct_sma40", label: "% vs 40D SMA", group: "Smart Money", source: "smartmoney", render: (r) => <Signed v={r.sm_pct_sma40} digits={1} /> },
  { key: "sm_signal", label: "Signal", align: "left", group: "Smart Money", source: "smartmoney", render: (r) => (r.sm_signal ? r.sm_signal : DASH) },

  // 2026-09-20 — see the roce_1y_chg field comment above for the research
  // behind this group. Sourced from nse750Fundamentals, which refreshes
  // WEEKLY (not daily like every other column here — fundamentals don't
  // move day to day) per "I only need technical part on daily basis" /
  // "ROCE stays weekly" — as_of shown separately below, same pattern the
  // rest of the app already uses for weekly-sourced data on a mostly-daily
  // page.
  { key: "roce_1y_chg", label: "ROCE 1Y Δ", group: "Quality (ROCE)", source: "quality", render: (r) => (r.roce_1y_chg == null ? DASH : <Signed v={r.roce_1y_chg} digits={1} />) },
  { key: "roce_pct", label: "ROCE %", group: "Quality (ROCE)", source: "quality", render: (r) => fmtNum(r.roce_pct, 1) },

  // 2026-09-26 ("replicate similar pf page structure on to all technical
  // page, except for Buy % Avg Price P&L %" / "alos current %") — brings
  // Portfolio Allocation's dense per-stock technical block (computed for
  // EVERY holding, every run) to the full NSE750 universe here. Everything
  // else on this page reusing an existing screener is SPARSE by design
  // (see the module comment up top) — MA Breakout/ATH/52W High only
  // populate for a stock with a signal event that week. This is a
  // genuinely new backend screener (nse750Technicals, weekly batched cron,
  // same merge-on-write pattern as nse750Fundamentals) computed for all
  // ~750 stocks every run, not aliased off the sparse detectors above.
  // Deliberately excludes Buy %/Avg Price/P&L %/Current % — those only
  // make sense for an actual holding, not a market-wide screener.
  { key: "nt_market_cap", label: "Market Cap (Cr)", group: "Technicals (Dense, NSE750)", source: "nt", render: (r) => fmtNum(r.nt_market_cap, 0) },
  { key: "nt_1w_pct", label: "1W %", group: "Technicals (Dense, NSE750)", source: "nt", render: (r) => <Signed v={r.nt_1w_pct} digits={1} /> },
  { key: "nt_1m_pct", label: "1M %", group: "Technicals (Dense, NSE750)", source: "nt", render: (r) => <Signed v={r.nt_1m_pct} digits={1} /> },
  { key: "nt_3m_pct", label: "3M %", group: "Technicals (Dense, NSE750)", source: "nt", render: (r) => <Signed v={r.nt_3m_pct} digits={1} /> },
  { key: "nt_6m_pct", label: "6M %", group: "Technicals (Dense, NSE750)", source: "nt", render: (r) => <Signed v={r.nt_6m_pct} digits={1} /> },
  { key: "nt_pct_200d_ema", label: "% vs 200D EMA", group: "Technicals (Dense, NSE750)", source: "nt", render: (r) => <Signed v={r.nt_pct_200d_ema} digits={1} /> },
  { key: "nt_pct_33w_ema", label: "% vs 33W EMA", group: "Technicals (Dense, NSE750)", source: "nt", render: (r) => <Signed v={r.nt_pct_33w_ema} digits={1} /> },
  { key: "nt_pct_from_ath", label: "% from ATH", group: "Technicals (Dense, NSE750)", source: "nt", render: (r) => <Signed v={r.nt_pct_from_ath} digits={1} /> },
  { key: "nt_pct_from_52w_high", label: "% from 52W High", group: "Technicals (Dense, NSE750)", source: "nt", render: (r) => <Signed v={r.nt_pct_from_52w_high} digits={1} /> },
];

const COLUMN_GROUP_ORDER = Array.from(new Set(ALL_COLUMNS.map((c) => c.group)));
const OPTIONAL_COLUMNS = ALL_COLUMNS.filter((c) => !c.mandatory);
const MANDATORY_COLUMNS = ALL_COLUMNS.filter((c) => c.mandatory);

const STORAGE_KEY = "allTechnicalsColumns";
// A lean default — a handful of Core columns plus the single headline
// number from each of the two full-coverage screeners (RS Score,
// Alpha Score), not whole groups. "too many columns but lesser page
// width" was the whole point of this redesign. Technicals (Dense,
// NSE750) is the one exception — 2026-09-26 ("by default Technicals
// (Dense, NSE750) be the concept on opening page"), its whole group
// ships enabled out of the box since it's the page's newest and most
// complete-coverage addition.
const DEFAULT_ENABLED = [
  "sector",
  "change_pct",
  "weekly_pct",
  "monthly_pct",
  "rsi_w",
  "rs_score",
  "alpha_score",
  "roce_1y_chg",
  ...ALL_COLUMNS.filter((c) => c.group === "Technicals (Dense, NSE750)").map((c) => c.key),
];

function loadEnabledColumns(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {
    // localStorage unavailable/corrupt — fall through to default
  }
  return new Set(DEFAULT_ENABLED);
}

function keyBy<T extends Record<string, any>>(rows: T[] | undefined, dedupeFirst = false): Map<string, T> {
  const map = new Map<string, T>();
  for (const r of rows ?? []) {
    const sym = r.symbol;
    if (!sym) continue;
    if (dedupeFirst && map.has(sym)) continue; // keep the first (highest-ranked) occurrence for screeners that legitimately push a symbol twice
    map.set(sym, r);
  }
  return map;
}

export default function AllTechnicals() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const { ready } = useScreeners([
    "nseScreener",
    "Nifty500RelativeStrength",
    "sectorStockAlpha",
    "52wHigh",
    "52wLow",
    "allTimeHigh",
    "maBreakout",
    "myLongTermInvestingStrategy",
    "weeklySignals",
    "valueRsiTurnaround",
    "grandfatherFatherSon",
    "momentumPersonal",
    "volumeRockers",
    "weekendInvesting",
    "quantBollinger",
    "smartMoney",
    "nse750Fundamentals",
    "nse750Technicals",
  ]);
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

  // 2026-09-26 ("allow check box at concept level as well") — toggles
  // every column in a group together. All-on -> all-off; anything else
  // (none or partial) -> all-on, so one click from a partial state
  // completes the group rather than clearing it.
  function toggleGroup(groupKeys: string[], allOn: boolean) {
    setEnabledCols((prev) => {
      const next = new Set(prev);
      if (allOn) groupKeys.forEach((k) => next.delete(k));
      else groupKeys.forEach((k) => next.add(k));
      return next;
    });
  }

  const rows = useMemo(() => {
    const base = ms?.nseScreener?.rows ?? [];
    const rsMap = keyBy(ms?.Nifty500RelativeStrength?.rows);
    const alphaMap = keyBy(ms?.sectorStockAlpha?.rows, true); // a stock can appear twice (industry + theme) — sorted best-alpha-first at the push, keep the first
    const high52wMap = keyBy(ms?.["52wHigh"]?.rows);
    const low52wMap = keyBy(ms?.["52wLow"]?.rows);
    const athMap = keyBy(ms?.allTimeHigh?.rows);
    const mabMap = keyBy(ms?.maBreakout?.rows);
    const ltisMap = keyBy(ms?.myLongTermInvestingStrategy?.rows);
    const wsRsiMap = new Map<string, boolean>();
    const wsEmaMap = new Map<string, boolean>();
    for (const r of ms?.weeklySignals?.rows ?? []) {
      if (r.signal === "RSI>66 Cross") wsRsiMap.set(r.symbol, true);
      if (r.signal === "33W EMA Breakdown") wsEmaMap.set(r.symbol, true);
    }
    const vrtMap = keyBy(ms?.valueRsiTurnaround?.rows);
    const gfsMap = keyBy(ms?.grandfatherFatherSon?.rows);
    const mpMap = keyBy(ms?.momentumPersonal?.rows);
    const vrMap = keyBy(ms?.volumeRockers?.rows);
    const wiMap = keyBy(ms?.weekendInvesting?.rows);
    const qbMap = keyBy(ms?.quantBollinger?.rows);
    const smMap = keyBy(ms?.smartMoney?.rows);
    const fundMap = keyBy(ms?.nse750Fundamentals?.rows);
    const ntMap = keyBy(ms?.nse750Technicals?.rows);

    return base.map((b: any) => {
      const sym = b.symbol;
      const rs = rsMap.get(sym);
      const alpha = alphaMap.get(sym);
      const high52w = high52wMap.get(sym);
      const low52w = low52wMap.get(sym);
      const ath = athMap.get(sym);
      const mab = mabMap.get(sym);
      const ltis = ltisMap.get(sym);
      const vrt = vrtMap.get(sym);
      const gfs = gfsMap.get(sym);
      const mp = mpMap.get(sym);
      const vr = vrMap.get(sym);
      const wi = wiMap.get(sym);
      const qb = qbMap.get(sym);
      const sm = smMap.get(sym);
      const fund = fundMap.get(sym);
      const nt = ntMap.get(sym);

      return {
        symbol: sym,
        name: b.name,
        sector: b.sector,
        price: b.price,
        change_pct: b.change_pct,
        weekly_pct: b.weekly_pct,
        monthly_pct: b.monthly_pct,
        three_month_pct: b.three_month_pct,
        yearly_pct: b.yearly_pct,
        rsi_d: b.rsi_d,
        rsi_w: b.rsi_w,
        rsi_m: b.rsi_m,
        three_week_green: b.three_week_green,

        rs_1w: rs?.rs_1w ?? null,
        rs_1m: rs?.rs_1m ?? null,
        rs_3m: rs?.rs_3m ?? null,
        rs_6m: rs?.rs_6m ?? null,
        rs_score: rs?.rs_score ?? null,
        rs_new_high: rs?.rs_new_high ?? false,

        alpha_1w: alpha?.alpha_1w ?? null,
        alpha_1m: alpha?.alpha_1m ?? null,
        alpha_3m: alpha?.alpha_3m ?? null,
        alpha_6m: alpha?.alpha_6m ?? null,
        alpha_1y: alpha?.alpha_1y ?? null,
        alpha_score: alpha?.alpha_score ?? null,

        high52w_pct_off: high52w?.pct_off_high ?? null,
        high52w_new: high52w?.new_high ?? false,

        low52w_pct_off: low52w?.pct_off_low ?? null,
        low52w_new: low52w?.new_low ?? false,

        ath_price: ath?.ath ?? null,
        ath_pct_off: ath?.pct_off_ath ?? null,
        ath_new: ath?.new_high ?? false,

        mab_via: mab?.via ?? null,
        mab_pct_200d: mab?.pct_above_200d ?? null,
        mab_days_200d: mab?.days_since_cross_200d ?? null,
        mab_pct_33w: mab?.pct_above_33w ?? null,
        mab_weeks_33w: mab?.weeks_since_cross_33w ?? null,
        mab_fresh: mab?.fresh_this_week ?? false,

        ribbon_rsi14: ltis?.rsi14 ?? null,
        ribbon_pct_33w: ltis?.pct_above_ema33 ?? null,
        ribbon_buy: ltis?.signal ?? false,
        ws_rsi_cross: wsRsiMap.get(sym) ?? false,
        ws_ema_breakdown: wsEmaMap.get(sym) ?? false,

        vrt_rsi: vrt?.rsi_m ?? null,
        vrt_rsi_at_cross: vrt?.rsi_at_cross ?? null,
        vrt_months: vrt?.months_since_cross ?? null,
        vrt_gain: vrt?.rsi_gain_since_cross ?? null,

        gfs_monthly_rsi: gfs?.monthly_rsi ?? null,
        gfs_weekly_rsi: gfs?.weekly_rsi ?? null,
        gfs_daily_rsi: gfs?.daily_rsi ?? null,
        gfs_support_rsi: gfs?.daily_rsi_at_support ?? null,
        gfs_days_since: gfs?.days_since_support ?? null,
        gfs_stop: gfs?.stop_loss ?? null,

        mp_high52w: mp?.high_52w ?? null,
        mp_ma20w: mp?.ma20w ?? null,
        mp_pct_ma20w: mp?.pct_above_ma20w ?? null,
        mp_sales_g: mp?.sales_g ?? null,
        mp_ebit_g: mp?.ebit_g ?? null,
        mp_eps_g: mp?.eps_g ?? null,
        mp_score: mp?.score ?? null,

        vr_day_vol: vr?.day_vol ?? null,
        vr_turnover: vr?.turnover_cr ?? null,
        vr_vol_change: vr?.vol_change_times ?? null,
        vr_day_chg: vr?.day_chg_pct ?? null,

        wi_roc_1y: wi?.roc_1y_pct ?? null,

        qb_signal: qb?.signal ?? false,
        qb_rs55: qb?.rs55_pct ?? null,
        qb_pct_band: qb?.pct_above_band ?? null,
        qb_pct_sma34: qb?.pct_vs_sma34 ?? null,
        qb_atr_stop: qb?.chandelier_stop ?? null,

        sm_pct_sma40: sm?.pct_vs_sma40 ?? null,
        sm_signal: sm?.signal ?? null,

        // 2026-09-20 ("what is the one point or param which makes a
        // strong run") — of everything tested against a year of NSE750
        // returns (working capital days/trend, ROE level/trend, ROCE
        // level, operating margin), ROCE's own 1-year point change was
        // the standout: Spearman rho=0.23 vs 0.02-0.06 for working
        // capital, and a clean monotonic quintile spread (-11pp to
        // +14pp median sector-relative excess return, worst-to-best
        // ROCE improvers). roce_pct (the level) kept for context only —
        // it was NOT the strong factor on its own.
        roce_pct: fund?.roce_pct ?? null,
        roce_1y_chg: fund?.roce_1y_chg ?? null,

        nt_market_cap: fund?.market_cap_cr ?? null,
        nt_1w_pct: nt?.pct_1w ?? null,
        nt_1m_pct: nt?.pct_1m ?? null,
        nt_3m_pct: nt?.pct_3m ?? null,
        nt_6m_pct: nt?.pct_6m ?? null,
        nt_pct_200d_ema: nt?.pct_200d_ema ?? null,
        nt_pct_33w_ema: nt?.pct_33w_ema ?? null,
        nt_pct_from_ath: nt?.pct_from_ath ?? null,
        nt_pct_from_52w_high: nt?.pct_from_52w_high ?? null,

        // 2026-09-18 ("instead of only show records matching it show
        // all but results are none") — presence flags, one per
        // originating screener, used ONLY to drive the "only matches"
        // filter below (never rendered as a column themselves).
        // Tracked as real map-lookup presence rather than inferred
        // from field nullness, since a group's own fields can
        // legitimately be null/false even when the row DID match
        // (e.g. quantBollinger only ever pushes true signals, so
        // presence in its map already means "matched" without needing
        // to null-check qb_signal itself).
        _has_core: true, // nseScreener already covers the full universe — never filtered out
        _has_rs: !!rs,
        _has_alpha: !!alpha,
        _has_high52w: !!high52w,
        _has_low52w: !!low52w,
        _has_ath: !!ath,
        _has_mab: !!mab,
        _has_ribbon: !!ltis || wsRsiMap.has(sym) || wsEmaMap.has(sym),
        _has_vrt: !!vrt,
        _has_gfs: !!gfs,
        _has_momentum: !!mp,
        _has_volume: !!vr,
        _has_weekend: !!wi,
        _has_bollinger: !!qb,
        _has_smartmoney: !!sm,
        _has_quality: fund?.roce_1y_chg != null,
        _has_nt: !!nt,
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
    // rank recomputed here (1..N of what's actually shown), not baked in
    // earlier — filtering down to e.g. 25 Quant Bollinger matches out of
    // 750 should read as "1..25", not gappy original-universe positions.
    return base.map((r: any, i: number) => ({ ...r, rank: i + 1 }));
  }, [rows, activeSources, onlyMatches]);

  const asOf = ms?.nseScreener?.as_of;
  const fundAsOf = ms?.nse750Fundamentals?.as_of;
  const ntAsOf = ms?.nse750Technicals?.as_of;

  if (!ready) return <ScreenerLoading label="All Technicals" />;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">🔬 All Technicals</h1>
        <span className="text-slate-500 text-sm">Every NSE750 stock, every technical screener, one table</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Refreshed by the existing per-screener crons (Momentum Screeners tabs) — this page just joins what's already fetched, client-side.
        {asOf && <> Base data as of {asOf}.</>}
        {fundAsOf && (
          <>
            {" "}
            <b>Quality (ROCE)</b> columns refresh weekly, not daily (fundamentals don't move day to day) — as of {fundAsOf}.
          </>
        )}
        {ntAsOf && (
          <>
            {" "}
            <b>Technicals (Dense, NSE750)</b> columns also refresh weekly — as of {ntAsOf}.
          </>
        )}
      </p>

      <MethodologyNote>
        One row per NSE750 stock, sourced from <b>nseScreener</b> (the only technical screener with unconditional full coverage). Every
        other column here comes from a DIFFERENT screener that only ever covers a filtered SUBSET of the universe by design — e.g.{" "}
        <b>MA Breakout</b> only shows stocks with a fresh EMA cross this week, <b>Quant Bollinger</b> only current breakout signals,{" "}
        <b>52W High/Low</b> only stocks within a % band of their high/low. A blank cell in any of those columns means "not currently
        triggered", not missing data. Every column (except #/Symbol/Name/Price) can be individually shown/hidden with the column picker —
        picks are remembered on this device. No new data is fetched for this page — every column reads the exact same screener data its
        own tab already shows; refresh any of those tabs (or wait for their cron) to update this one.
        <br />
        <br />
        <b>Quality (ROCE)</b> — added 2026-09-20 after testing which fundamental factor actually predicts NSE750 stock performance
        (working capital days/trend, ROE level/trend, ROCE level, operating margin, all checked against a year of returns). <b>ROCE 1Y Δ</b>{" "}
        (this year's ROCE minus last year's, in percentage points — NOT the level, NOT ROE) was the clear winner: Spearman ρ=0.23 vs
        0.02-0.06 for working capital, with a clean, roughly linear spread from -11pp (worst ROCE-decliners) to +14pp (best ROCE-improvers)
        median sector-relative return by quintile. <b>ROCE %</b> (the raw level) is shown alongside for context only — it was NOT itself a
        strong factor. Sourced from <b>nse750Fundamentals</b>, which refreshes weekly rather than daily.
        <br />
        <br />
        <b>Technicals (Dense, NSE750)</b> — added 2026-09-26, replicating the Portfolio Allocation page's per-stock technical block across
        the full universe rather than just current holdings (excludes Buy %/Avg Price/P&L %/Current %, which only make sense for an actual
        position). Unlike every other optional column on this page, this group is <b>dense</b>: computed for all ~750 stocks every run, not
        just the ones with a signal event this week. Sourced from a new weekly-batched screener (<b>nse750Technicals</b>) — 1W/1M/3M/6M %
        are bar-count price changes, % vs 200D/33W EMA use OHLC4 (not close alone), and % from ATH/52W High are measured off weekly highs
        (not closes), so an intraweek spike that pulled back before the week's close still counts as touching a new high.
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
            title="With this on, only rows that actually have data in a currently-checked column are shown — otherwise a sparse screener like Quant Bollinger shows all 750 rows blank"
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
            const groupKeys = groupCols.map((c) => c.key);
            const enabledCount = groupKeys.filter((k) => enabledCols.has(k)).length;
            const allOn = enabledCount === groupKeys.length;
            const someOn = enabledCount > 0 && !allOn;
            return (
              <div key={group}>
                <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allOn}
                    ref={(el) => {
                      if (el) el.indeterminate = someOn;
                    }}
                    onChange={() => toggleGroup(groupKeys, allOn)}
                  />
                  {group}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
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
            ? "No stocks currently match the checked columns (e.g. Quant Bollinger can legitimately have zero current breakout signals) — try unchecking \"Only show rows with data\" or a different column."
            : "No technical data yet — the nseScreener cron hasn't run."
        }
      />
    </div>
  );
}
