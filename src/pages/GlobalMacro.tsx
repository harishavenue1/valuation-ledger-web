import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import RunButton from "../components/RunButton";
import { Col, GenericTable, MethodologyNote, Signed } from "../components/ScreenerTable";

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

const ETF_COLS: Col[] = [
  { key: "rank", label: "Rank" },
  { key: "country", label: "Country", align: "left" },
  { key: "ticker_display", label: "ETF", align: "left", render: (r) => <span className="font-semibold text-slate-700">{r.symbol}</span> },
  { key: "sector", label: "Region", align: "left" },
  { key: "close", label: "Price", render: (r) => <PriceTvLink r={r} /> },
  { key: "r_1w", label: "1W %", render: (r) => <Signed v={r.r_1w} digits={1} /> },
  { key: "r_1m", label: "1M %", render: (r) => <Signed v={r.r_1m} digits={1} /> },
  { key: "r_3m", label: "3M %", render: (r) => <Signed v={r.r_3m} digits={1} /> },
  { key: "r_6m", label: "6M %", render: (r) => <Signed v={r.r_6m} digits={1} /> },
  { key: "r_1y", label: "1Y %", render: (r) => <Signed v={r.r_1y} digits={1} /> },
  { key: "alpha_1w", label: "Alpha 1W", render: (r) => <Signed v={r.alpha_1w} digits={1} /> },
  { key: "alpha_1m", label: "Alpha 1M", render: (r) => <Signed v={r.alpha_1m} digits={1} /> },
  { key: "alpha_3m", label: "Alpha 3M", render: (r) => <Signed v={r.alpha_3m} digits={1} /> },
  { key: "alpha_6m", label: "Alpha 6M", render: (r) => <Signed v={r.alpha_6m} digits={1} /> },
  { key: "alpha_1y", label: "Alpha 1Y", render: (r) => <span className="font-semibold"><Signed v={r.alpha_1y} digits={1} /></span> },
  {
    key: "tag",
    label: "Tag",
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

const CURRENCY_COLS: Col[] = [
  { key: "rank", label: "Rank" },
  { key: "country", label: "Country", align: "left" },
  { key: "ticker_display", label: "Ticker", align: "left", render: (r) => <span className="font-semibold text-slate-700">{r.symbol}</span> },
  { key: "close", label: "Price", render: (r) => <PriceTvLink r={r} /> },
  { key: "r_1w", label: "1W %", render: (r) => <Signed v={r.r_1w} digits={2} /> },
  { key: "r_1m", label: "1M %", render: (r) => <Signed v={r.r_1m} digits={2} /> },
  { key: "r_3m", label: "3M %", render: (r) => <Signed v={r.r_3m} digits={2} /> },
  { key: "r_6m", label: "6M %", render: (r) => <Signed v={r.r_6m} digits={2} /> },
  { key: "r_1y", label: "1Y %", render: (r) => <Signed v={r.r_1y} digits={2} /> },
];

export default function GlobalMacro() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const etfEntry = bundle.momentum_screeners["globalCountryEtfs"];
  const currencyEntry = bundle.momentum_screeners["globalCurrencies"];

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
        ticker, so flag it if any specific one's chart link looks wrong.
      </MethodologyNote>
      <GenericTable
        rows={etfEntry?.rows ?? []}
        cols={ETF_COLS}
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
      <GenericTable
        rows={currencyEntry?.rows ?? []}
        cols={CURRENCY_COLS}
        navigate={(t) => navigate(`/company/${t}`)}
        emptyMessage="No Global Currencies data yet — click Run now above."
      />
    </div>
  );
}
