import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData, useScreeners } from "../App";
import RunButton from "../components/RunButton";
import { Col, GenericTable, MethodologyNote, ScreenerLoading, Signed } from "../components/ScreenerTable";

// Added 2026-09-06 — "our currency and country level skill we have to
// built on page... which currency and country etfs are outperforming,
// on weekly, monthly, qtr, biannual, yearly basis". See
// api/momentum_screeners.py's globalCountryEtfs/globalCurrencies
// module comment for the full port-vs-original-skill rationale.
// key is "ticker_display", not "symbol" — GenericTable special-cases
// any column literally keyed "symbol" (adds a watchlist star + a nav
// button to /company/:symbol), which is wrong here: these are ETF
// tickers (EWJ, SPY, ...), not NSE stocks tracked in this app's own
// company database, and "watchlisting" one would silently do nothing
// useful with it.
// 2026-09-13 ("add a price column with a link to trading View... same
// to currency table as well") — the price cell IS the TradingView
// link, same click-the-price pattern Strategic Alpha already uses.
function PriceTvLink({ r }: { r: any }) {
  const text = r.close != null ? r.close.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—";
  return r.tradingview_url ? (
    <a href={r.tradingview_url} target="_blank" rel="noreferrer" className="text-indigo-600 underline whitespace-nowrap">
      {text}
    </a>
  ) : (
    <>{text}</>
  );
}

// 2026-09-28 ("update macro page with format as per alltechnical pge")
// — ported All Technicals' column-picker pattern: every non-core column
// individually togglable, grouped with a group-level checkbox, choice
// remembered per table via localStorage. Unlike All Technicals, both
// tables here are DENSE (globalCountryEtfs/globalCurrencies compute
// every column for every row, no sparse per-screener join) so there's
// no "only show rows with data" filter to port — nothing to filter on.
interface ColumnDef extends Col {
  group: string;
  mandatory?: boolean;
}

const ETF_ALL_COLUMNS: ColumnDef[] = [
  { key: "rank", label: "Rank", group: "Core", mandatory: true },
  {
    key: "ticker_display",
    label: "ETF",
    align: "left",
    group: "Core",
    mandatory: true,
    render: (r) => <span className="font-semibold text-slate-700">{r.symbol}</span>,
  },
  { key: "close", label: "Price", group: "Core", mandatory: true, render: (r) => <PriceTvLink r={r} /> },
  { key: "country", label: "Country", align: "left", group: "Core" },
  { key: "sector", label: "Region", align: "left", group: "Core" },
  { key: "r_1w", label: "1W %", group: "Returns", render: (r) => <Signed v={r.r_1w} digits={1} /> },
  { key: "r_1m", label: "1M %", group: "Returns", render: (r) => <Signed v={r.r_1m} digits={1} /> },
  { key: "r_3m", label: "3M %", group: "Returns", render: (r) => <Signed v={r.r_3m} digits={1} /> },
  { key: "r_6m", label: "6M %", group: "Returns", render: (r) => <Signed v={r.r_6m} digits={1} /> },
  { key: "r_1y", label: "1Y %", group: "Returns", render: (r) => <Signed v={r.r_1y} digits={1} /> },
  { key: "alpha_1w", label: "Alpha 1W", group: "Alpha vs India", render: (r) => <Signed v={r.alpha_1w} digits={1} /> },
  { key: "alpha_1m", label: "Alpha 1M", group: "Alpha vs India", render: (r) => <Signed v={r.alpha_1m} digits={1} /> },
  { key: "alpha_3m", label: "Alpha 3M", group: "Alpha vs India", render: (r) => <Signed v={r.alpha_3m} digits={1} /> },
  { key: "alpha_6m", label: "Alpha 6M", group: "Alpha vs India", render: (r) => <Signed v={r.alpha_6m} digits={1} /> },
  {
    key: "alpha_1y",
    label: "Alpha 1Y",
    group: "Alpha vs India",
    render: (r) => (
      <span className="font-semibold">
        <Signed v={r.alpha_1y} digits={1} />
      </span>
    ),
  },
  {
    key: "tag",
    label: "Tag",
    group: "Signal",
    render: (r) =>
      r.tag ? (
        <span
          className={`text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${
            r.tag === "Accelerating"
              ? "bg-emerald-50 text-emerald-700 border-emerald-300"
              : r.tag === "Cooling"
                ? "bg-red-50 text-red-600 border-red-300"
                : "bg-slate-100 text-slate-500 border-slate-300"
          }`}
        >
          {r.tag}
        </span>
      ) : (
        <span className="text-slate-300">—</span>
      ),
  },
];

const CURRENCY_ALL_COLUMNS: ColumnDef[] = [
  { key: "rank", label: "Rank", group: "Core", mandatory: true },
  {
    key: "ticker_display",
    label: "Ticker",
    align: "left",
    group: "Core",
    mandatory: true,
    render: (r) => <span className="font-semibold text-slate-700">{r.symbol}</span>,
  },
  { key: "close", label: "Price", group: "Core", mandatory: true, render: (r) => <PriceTvLink r={r} /> },
  { key: "country", label: "Country", align: "left", group: "Core" },
  { key: "r_1w", label: "1W %", group: "Returns", render: (r) => <Signed v={r.r_1w} digits={2} /> },
  { key: "r_1m", label: "1M %", group: "Returns", render: (r) => <Signed v={r.r_1m} digits={2} /> },
  { key: "r_3m", label: "3M %", group: "Returns", render: (r) => <Signed v={r.r_3m} digits={2} /> },
  { key: "r_6m", label: "6M %", group: "Returns", render: (r) => <Signed v={r.r_6m} digits={2} /> },
  { key: "r_1y", label: "1Y %", group: "Returns", render: (r) => <Signed v={r.r_1y} digits={2} /> },
];

const ETF_STORAGE_KEY = "globalMacroEtfColumns";
const ETF_DEFAULT_ENABLED = ["country", "sector", "r_1m", "r_1y", "alpha_1y", "tag"];

const CURRENCY_STORAGE_KEY = "globalMacroCurrencyColumns";
const CURRENCY_DEFAULT_ENABLED = ["country", "r_1m", "r_1y"];

function useColumnPicker(storageKey: string, allColumns: ColumnDef[], defaultEnabled: string[]) {
  const mandatory = useMemo(() => allColumns.filter((c) => c.mandatory), [allColumns]);
  const optional = useMemo(() => allColumns.filter((c) => !c.mandatory), [allColumns]);
  const groupOrder = useMemo(() => Array.from(new Set(allColumns.map((c) => c.group))), [allColumns]);

  const [enabled, setEnabled] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return new Set(JSON.parse(raw));
    } catch {
      // localStorage unavailable/corrupt — fall through to default
    }
    return new Set(defaultEnabled);
  });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(enabled)));
    } catch {
      // best-effort persistence only
    }
  }, [enabled, storageKey]);

  function toggleCol(key: string) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleGroup(groupKeys: string[], allOn: boolean) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (allOn) groupKeys.forEach((k) => next.delete(k));
      else groupKeys.forEach((k) => next.add(k));
      return next;
    });
  }

  const cols: Col[] = useMemo(() => [...mandatory, ...optional.filter((c) => enabled.has(c.key))], [mandatory, optional, enabled]);

  return { optional, groupOrder, enabled, open, setOpen, toggleCol, toggleGroup, cols };
}

function ColumnPicker({
  label,
  groupOrder,
  optional,
  enabled,
  open,
  onToggleOpen,
  onToggleCol,
  onToggleGroup,
}: {
  label: string;
  groupOrder: string[];
  optional: ColumnDef[];
  enabled: Set<string>;
  open: boolean;
  onToggleOpen: () => void;
  onToggleCol: (key: string) => void;
  onToggleGroup: (groupKeys: string[], allOn: boolean) => void;
}) {
  return (
    <div className="mb-3">
      <button onClick={onToggleOpen} className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:border-slate-400 font-medium">
        🎛️ {label} ({enabled.size} of {optional.length} shown) {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="mt-2 p-3 border border-slate-200 rounded-lg bg-slate-50 space-y-3">
          {groupOrder.map((group) => {
            const groupCols = optional.filter((c) => c.group === group);
            if (groupCols.length === 0) return null;
            const groupKeys = groupCols.map((c) => c.key);
            const enabledCount = groupKeys.filter((k) => enabled.has(k)).length;
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
                    onChange={() => onToggleGroup(groupKeys, allOn)}
                  />
                  {group}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {groupCols.map((c) => (
                    <label key={c.key} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={enabled.has(c.key)} onChange={() => onToggleCol(c.key)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function GlobalMacro() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const { ready } = useScreeners(["globalCountryEtfs", "globalCurrencies"]);
  const etfEntry = bundle.momentum_screeners["globalCountryEtfs"];
  const currencyEntry = bundle.momentum_screeners["globalCurrencies"];

  const etfPicker = useColumnPicker(ETF_STORAGE_KEY, ETF_ALL_COLUMNS, ETF_DEFAULT_ENABLED);
  const currencyPicker = useColumnPicker(CURRENCY_STORAGE_KEY, CURRENCY_ALL_COLUMNS, CURRENCY_DEFAULT_ENABLED);

  if (!ready) return <ScreenerLoading label="Global Macro" />;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">🌍 Global Macro</h1>
        <span className="text-slate-500 text-sm">Country ETFs &amp; currencies — 1W/1M/3M/6M/1Y</span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Ported from the MacroRegimeRadar skill (yfinance only, no auth — same as most tabs on this app) — refreshes daily on Vercel.
      </p>

      <div className="flex items-center gap-2 mb-1 mt-6">
        <h2 className="text-base font-semibold">🌐 Country ETFs — Alpha vs India</h2>
        <span className="ml-auto">
          <RunButton screener="globalCountryEtfs" />
        </span>
      </div>
      {etfEntry?.as_of && <div className="text-xs text-slate-400 mb-2">as of {etfEntry.as_of}</div>}
      <MethodologyNote>
        51 country/region ETFs (real tradable tickers — EWJ, EWZ, SPY, etc.), ranked by <b>Alpha 1Y</b> = the ETF's own 1-year return minus
        India's (INDA's) 1-year return over the same window — same for every other timeframe column. <b>Tag</b>: "Accelerating" if 3M alpha ≥
        +5pp, "Cooling" if 3M alpha is negative, "Steady" otherwise — only assigned at all when 1Y alpha is at least +20pp (below that, not a
        meaningful enough alpha generator to tag either way, shown as "—"). This is <b>raw return alpha</b>, not the Technical Summary page's
        per-stock alpha vs sector — a different, market-level question ("which country is beating India") using a different universe (country
        ETFs, not NSE stocks). <b>Price</b> is the ETF's own last close (USD) and is itself the TradingView link — assumed listed on NYSE Arca
        (TradingView's "AMEX" code), same convention already used for other US ETFs elsewhere in this app; not individually verified per
        ticker, so flag it if any specific one's chart link looks wrong. Rank/ETF/Price always show — every other column can be individually
        shown or hidden with the column picker below; picks are remembered on this device.
      </MethodologyNote>
      <ColumnPicker
        label="Columns"
        groupOrder={etfPicker.groupOrder}
        optional={etfPicker.optional}
        enabled={etfPicker.enabled}
        open={etfPicker.open}
        onToggleOpen={() => etfPicker.setOpen((v) => !v)}
        onToggleCol={etfPicker.toggleCol}
        onToggleGroup={etfPicker.toggleGroup}
      />
      <GenericTable
        rows={etfEntry?.rows ?? []}
        cols={etfPicker.cols}
        navigate={(t) => navigate(`/company/${t}`)}
        emptyMessage="No Global Country ETFs data yet — click Run now above."
      />

      <div className="flex items-center gap-2 mb-1 mt-8">
        <h2 className="text-base font-semibold">💱 Currencies vs USD</h2>
        <span className="ml-auto">
          <RunButton screener="globalCurrencies" />
        </span>
      </div>
      {currencyEntry?.as_of && <div className="text-xs text-slate-400 mb-2">as of {currencyEntry.as_of}</div>}
      <MethodologyNote>
        12 currencies vs. USD — positive means the local currency is <b>appreciating</b> against the dollar over that window, negative means
        it's <b>depreciating</b>. Ranked by 1M change. Pairs quoted as "USD per 1 local unit" (EUR, GBP, AUD) are read directly; pairs quoted
        as "local units per 1 USD" (INR, BRL, JPY, and the rest) are inverted so a positive number always means the same thing across every
        row — local-currency strength, not a quoting-convention artifact. <b>Price</b> is the RAW quoted rate (not direction-adjusted like the
        % columns) — exactly what the ticker itself shows, and itself the TradingView link (FX_IDC, TradingView's free FX data provider).
      </MethodologyNote>
      <ColumnPicker
        label="Columns"
        groupOrder={currencyPicker.groupOrder}
        optional={currencyPicker.optional}
        enabled={currencyPicker.enabled}
        open={currencyPicker.open}
        onToggleOpen={() => currencyPicker.setOpen((v) => !v)}
        onToggleCol={currencyPicker.toggleCol}
        onToggleGroup={currencyPicker.toggleGroup}
      />
      <GenericTable
        rows={currencyEntry?.rows ?? []}
        cols={currencyPicker.cols}
        navigate={(t) => navigate(`/company/${t}`)}
        emptyMessage="No Global Currencies data yet — click Run now above."
      />
    </div>
  );
}
