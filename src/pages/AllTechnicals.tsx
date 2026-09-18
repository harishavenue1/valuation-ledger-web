import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import { Col, GenericTable, MethodologyNote, PriceLink, Signed, fmtNum } from "../components/ScreenerTable";
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
// Column-picker: always-visible core columns plus togglable GROUPS (by
// originating screener, not one flat 60-checkbox list) — persisted to
// localStorage so picks stick between visits.

const Y = <span className="text-emerald-600 font-semibold">Y</span>;
const DASH = <span className="text-slate-300">—</span>;
function boolCell(v: any) {
  return v ? Y : DASH;
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
  { key: "change_pct", label: "Day %", render: (r) => <Signed v={r.change_pct} digits={1} /> },
  { key: "weekly_pct", label: "Week %", render: (r) => <Signed v={r.weekly_pct} digits={1} /> },
  { key: "monthly_pct", label: "Month %", render: (r) => <Signed v={r.monthly_pct} digits={1} /> },
  { key: "three_month_pct", label: "3M %", render: (r) => <Signed v={r.three_month_pct} digits={1} /> },
  { key: "yearly_pct", label: "Year %", render: (r) => <Signed v={r.yearly_pct} digits={1} /> },
  { key: "rsi_d", label: "RSI(D)", render: (r) => fmtNum(r.rsi_d, 1) },
  { key: "rsi_w", label: "RSI(W)", render: (r) => fmtNum(r.rsi_w, 1) },
  { key: "rsi_m", label: "RSI(M)", render: (r) => fmtNum(r.rsi_m, 1) },
  { key: "three_week_green", label: "3W Green", render: (r) => boolCell(r.three_week_green) },
];

const COLUMN_GROUPS: ColumnGroup[] = [
  {
    id: "rs",
    label: "Relative Strength",
    cols: [
      { key: "rs_1w", label: "RS 1W", render: (r) => <Signed v={r.rs_1w} digits={1} /> },
      { key: "rs_1m", label: "RS 1M", render: (r) => <Signed v={r.rs_1m} digits={1} /> },
      { key: "rs_3m", label: "RS 3M", render: (r) => <Signed v={r.rs_3m} digits={1} /> },
      { key: "rs_6m", label: "RS 6M", render: (r) => <Signed v={r.rs_6m} digits={1} /> },
      { key: "rs_score", label: "RS Score", render: (r) => fmtNum(r.rs_score, 1) },
      { key: "rs_new_high", label: "RS New High", render: (r) => boolCell(r.rs_new_high) },
    ],
  },
  {
    id: "alpha",
    label: "Sector Alpha",
    cols: [
      { key: "alpha_1w", label: "Alpha 1W", render: (r) => <Signed v={r.alpha_1w} digits={1} /> },
      { key: "alpha_1m", label: "Alpha 1M", render: (r) => <Signed v={r.alpha_1m} digits={1} /> },
      { key: "alpha_3m", label: "Alpha 3M", render: (r) => <Signed v={r.alpha_3m} digits={1} /> },
      { key: "alpha_6m", label: "Alpha 6M", render: (r) => <Signed v={r.alpha_6m} digits={1} /> },
      { key: "alpha_1y", label: "Alpha 1Y", render: (r) => <Signed v={r.alpha_1y} digits={1} /> },
      { key: "alpha_score", label: "Alpha Score", render: (r) => <Signed v={r.alpha_score} digits={1} /> },
    ],
  },
  {
    id: "high52w",
    label: "52W High",
    cols: [
      { key: "high52w_pct_off", label: "% off 52W High", render: (r) => <Signed v={r.high52w_pct_off} digits={1} /> },
      { key: "high52w_new", label: "New 52W High", render: (r) => boolCell(r.high52w_new) },
    ],
  },
  {
    id: "low52w",
    label: "52W Low",
    cols: [
      { key: "low52w_pct_off", label: "% off 52W Low", render: (r) => <Signed v={r.low52w_pct_off} digits={1} /> },
      { key: "low52w_new", label: "New 52W Low", render: (r) => (r.low52w_new ? <span className="text-red-600 font-semibold">Y</span> : DASH) },
    ],
  },
  {
    id: "ath",
    label: "All-Time High",
    cols: [
      { key: "ath_price", label: "ATH Price", render: (r) => fmtNum(r.ath_price, 1) },
      { key: "ath_pct_off", label: "% off ATH", render: (r) => <Signed v={r.ath_pct_off} digits={1} /> },
      { key: "ath_new", label: "New ATH", render: (r) => boolCell(r.ath_new) },
    ],
  },
  {
    id: "mab",
    label: "MA Breakout",
    cols: [
      { key: "mab_via", label: "Via", align: "left" },
      { key: "mab_pct_200d", label: "% vs 200D EMA", render: (r) => <Signed v={r.mab_pct_200d} digits={1} /> },
      { key: "mab_days_200d", label: "Days Since Cross (200D)", render: (r) => fmtNum(r.mab_days_200d, 0) },
      { key: "mab_pct_33w", label: "% vs 33W EMA", render: (r) => <Signed v={r.mab_pct_33w} digits={1} /> },
      { key: "mab_weeks_33w", label: "Weeks Since Cross (33W)", render: (r) => fmtNum(r.mab_weeks_33w, 0) },
      { key: "mab_fresh", label: "Fresh This Week", render: (r) => boolCell(r.mab_fresh) },
    ],
  },
  {
    id: "ribbon",
    label: "RSI+EMA Ribbon (LTIS / Weekly Signals)",
    cols: [
      { key: "ribbon_rsi14", label: "Weekly RSI14", render: (r) => fmtNum(r.ribbon_rsi14, 1) },
      { key: "ribbon_pct_33w", label: "% vs 33W EMA (wk)", render: (r) => <Signed v={r.ribbon_pct_33w} digits={1} /> },
      { key: "ribbon_buy", label: "LTIS Buy Signal", render: (r) => boolCell(r.ribbon_buy) },
      { key: "ws_rsi_cross", label: "Fresh RSI>66 Cross", render: (r) => boolCell(r.ws_rsi_cross) },
      { key: "ws_ema_breakdown", label: "Fresh 33W EMA Breakdown", render: (r) => (r.ws_ema_breakdown ? <span className="text-red-600 font-semibold">Y</span> : DASH) },
    ],
  },
  {
    id: "vrt",
    label: "Value RSI Turnaround",
    cols: [
      { key: "vrt_rsi", label: "Monthly RSI", render: (r) => fmtNum(r.vrt_rsi, 1) },
      { key: "vrt_rsi_at_cross", label: "RSI at Cross", render: (r) => fmtNum(r.vrt_rsi_at_cross, 1) },
      { key: "vrt_months", label: "Months Since Cross", render: (r) => fmtNum(r.vrt_months, 0) },
      {
        key: "vrt_gain",
        label: "RSI Gain Since Cross",
        render: (r) => {
          if (r.vrt_gain === null || r.vrt_gain === undefined) return DASH;
          const n = Number(r.vrt_gain);
          return <span className={n >= 0 ? "text-emerald-600" : "text-red-600"}>{n >= 0 ? "+" : ""}{n.toFixed(1)}</span>;
        },
      },
    ],
  },
  {
    id: "gfs",
    label: "Grandfather-Father-Son",
    cols: [
      { key: "gfs_monthly_rsi", label: "Monthly RSI", render: (r) => fmtNum(r.gfs_monthly_rsi, 1) },
      { key: "gfs_weekly_rsi", label: "Weekly RSI", render: (r) => fmtNum(r.gfs_weekly_rsi, 1) },
      { key: "gfs_daily_rsi", label: "Daily RSI", render: (r) => fmtNum(r.gfs_daily_rsi, 1) },
      { key: "gfs_support_rsi", label: "Daily RSI at Support", render: (r) => fmtNum(r.gfs_support_rsi, 1) },
      { key: "gfs_days_since", label: "Days Since Support", render: (r) => fmtNum(r.gfs_days_since, 0) },
      { key: "gfs_stop", label: "Stop Loss", render: (r) => fmtNum(r.gfs_stop, 1) },
    ],
  },
  {
    id: "momentum",
    label: "Momentum Personal",
    cols: [
      { key: "mp_high52w", label: "52W High", render: (r) => fmtNum(r.mp_high52w, 1) },
      { key: "mp_ma20w", label: "20W MA", render: (r) => fmtNum(r.mp_ma20w, 1) },
      { key: "mp_pct_ma20w", label: "% above 20W MA", render: (r) => <Signed v={r.mp_pct_ma20w} digits={1} /> },
      { key: "mp_sales_g", label: "Sales Growth", render: (r) => (r.mp_sales_g === null || r.mp_sales_g === undefined ? DASH : r.mp_sales_g) },
      { key: "mp_ebit_g", label: "EBIT Growth", render: (r) => (r.mp_ebit_g === null || r.mp_ebit_g === undefined ? DASH : r.mp_ebit_g) },
      { key: "mp_eps_g", label: "EPS Growth", render: (r) => (r.mp_eps_g === null || r.mp_eps_g === undefined ? DASH : r.mp_eps_g) },
      { key: "mp_score", label: "Score", render: (r) => (r.mp_score === null || r.mp_score === undefined ? DASH : r.mp_score) },
    ],
  },
  {
    id: "volume",
    label: "Volume Rockers",
    cols: [
      { key: "vr_day_vol", label: "Day Volume", render: (r) => fmtNum(r.vr_day_vol, 0) },
      { key: "vr_turnover", label: "Turnover ₹Cr", render: (r) => fmtNum(r.vr_turnover, 1) },
      { key: "vr_vol_change", label: "Vol Change ×", render: (r) => fmtNum(r.vr_vol_change, 1) },
      { key: "vr_day_chg", label: "Day %", render: (r) => <Signed v={r.vr_day_chg} digits={1} /> },
    ],
  },
  {
    id: "weekend",
    label: "Weekend Investing",
    cols: [{ key: "wi_roc_1y", label: "1Y ROC %", render: (r) => <Signed v={r.wi_roc_1y} digits={1} /> }],
  },
  {
    id: "bollinger",
    label: "Quant Bollinger",
    cols: [
      { key: "qb_signal", label: "Breakout Signal", render: (r) => boolCell(r.qb_signal) },
      { key: "qb_rs55", label: "RS55 %", render: (r) => <Signed v={r.qb_rs55} digits={1} /> },
      { key: "qb_pct_band", label: "% above Upper Band", render: (r) => <Signed v={r.qb_pct_band} digits={1} /> },
      { key: "qb_pct_sma34", label: "% vs 34W SMA", render: (r) => <Signed v={r.qb_pct_sma34} digits={1} /> },
      { key: "qb_atr_stop", label: "Chandelier Stop", render: (r) => fmtNum(r.qb_atr_stop, 1) },
    ],
  },
  {
    id: "smartmoney",
    label: "Smart Money",
    cols: [
      { key: "sm_pct_sma40", label: "% vs 40D SMA", render: (r) => <Signed v={r.sm_pct_sma40} digits={1} /> },
      { key: "sm_signal", label: "Signal", align: "left", render: (r) => (r.sm_signal ? r.sm_signal : DASH) },
    ],
  },
];

const STORAGE_KEY = "allTechnicalsColumnGroups";
const DEFAULT_ENABLED = ["rs", "alpha", "high52w"]; // a reasonable, not-overwhelming default — everything else is one click away

function loadEnabledGroups(): Set<string> {
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

        // 2026-09-18 ("instead of only show records matching it show
        // all but results are none") — presence flags, one per
        // toggleable group, used ONLY to drive the "only matches"
        // filter below (never rendered as a column themselves).
        // Tracked as real map-lookup presence rather than inferred
        // from field nullness, since a group's own fields can
        // legitimately be null/false even when the row DID match
        // (e.g. quantBollinger only ever pushes true signals, so
        // presence in its map already means "matched" without needing
        // to null-check qb_signal itself).
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
    // rank recomputed here (1..N of what's actually shown), not baked in
    // earlier — filtering down to e.g. 25 Quant Bollinger matches out of
    // 750 should read as "1..25", not gappy original-universe positions.
    return base.map((r: any, i: number) => ({ ...r, rank: i + 1 }));
  }, [rows, enabledGroups, onlyMatches]);

  const asOf = ms?.nseScreener?.as_of;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">🔬 All Technicals</h1>
        <span className="text-slate-500 text-sm">Every NSE750 stock, every technical screener, one table</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Refreshed by the existing per-screener crons (Momentum Screeners tabs) — this page just joins what's already fetched, client-side.
        {asOf && <> Base data as of {asOf}.</>}
      </p>

      <MethodologyNote>
        One row per NSE750 stock, sourced from <b>nseScreener</b> (the only technical screener with unconditional full coverage). Every
        other column here comes from a DIFFERENT screener that only ever covers a filtered SUBSET of the universe by design — e.g.{" "}
        <b>MA Breakout</b> only shows stocks with a fresh EMA cross this week, <b>Quant Bollinger</b> only current breakout signals,{" "}
        <b>52W High/Low</b> only stocks within a % band of their high/low. A blank cell in any of those columns means "not currently
        triggered", not missing data. Use the column picker below to show only what you care about — your picks are remembered on this
        device. No new data is fetched for this page — every column reads the exact same screener data its own tab already shows; refresh
        any of those tabs (or wait for their cron) to update this one.
      </MethodologyNote>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => setPickerOpen((v) => !v)}
          className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:border-slate-400 font-medium"
        >
          🎛️ Columns ({enabledGroups.size} of {COLUMN_GROUPS.length} groups shown) {pickerOpen ? "▲" : "▼"}
        </button>
        {enabledGroups.size > 0 && (
          <label className="flex items-center gap-2 text-sm cursor-pointer text-slate-600" title="With this on, only rows that actually have data in at least one checked group are shown — otherwise a sparse screener like Quant Bollinger shows all 750 rows blank">
            <input type="checkbox" checked={onlyMatches} onChange={(e) => setOnlyMatches(e.target.checked)} />
            Only show rows with data in the checked columns
          </label>
        )}
      </div>
      {pickerOpen && (
        <div className="mb-4 p-3 border border-slate-200 rounded-lg bg-slate-50 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
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
            ? "No stocks currently match the checked columns (e.g. Quant Bollinger can legitimately have zero current breakout signals) — try unchecking \"Only show rows with data\" or a different column group."
            : "No technical data yet — the nseScreener cron hasn't run."
        }
      />
    </div>
  );
}
