import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import { fmt, fmtSigned, lastActual } from "../lib/model";
import { evForGrowth, solveReverseDcf } from "../lib/reverseDcf";
import { MethodologyNote } from "../components/ScreenerTable";
import { bulkAddCompanies } from "../lib/bulkAdd";

// Added 2026-09-11 — "at 19th minute a concept discussed dcf, can we
// build exactly as its discussed a new page". Source confirmed after
// some back-and-forth on the wrong video: "Anatomy of Mispriced Stock
// | Anshul Saigal | Webinar" (CFA Society India), full transcript
// reviewed, plus the user's own screenshot of the actual slide. Saigal
// does a REVERSE discounted cash flow on Century Plyboards at two
// points in time — instead of forecasting cash flows to derive a fair
// value, hold the CURRENT price fixed and solve backward for what the
// market must be implicitly pricing in, then judge whether that's
// conservative (mispriced bet) or already-aggressive (no margin of
// safety). His slide shows 3 numbers per snapshot — 10yr sales growth,
// sustainable margin, implied terminal growth — sourced from
// Bloomberg's own reverse-DCF tool, whose actual inputs are never
// disclosed. See src/lib/reverseDcf.ts's own module comment for the
// full reasoning on why this page solves for ONE of those three
// (implied growth) while treating margin/terminal growth as
// user-adjustable assumptions, not something solvable from one
// equation — confirmed with Harish before building ("sensible
// defaults, user-adjustable" + "auto-fetch for any tracked company").

const NUM_STEP = "any";

function NumberField({
  label,
  value,
  onChange,
  suffix,
  title,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  title?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600" title={title}>
      <span>{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          step={NUM_STEP}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm tabular-nums"
        />
        {suffix && <span className="text-slate-400 text-xs">{suffix}</span>}
      </div>
    </label>
  );
}

export default function ReverseDCF() {
  const { bundle, setBundle } = useData();
  const navigate = useNavigate();
  const tickers = useMemo(() => Object.keys(bundle.stocks).sort(), [bundle.stocks]);
  const [ticker, setTicker] = useState<string>(tickers[0] ?? "");
  const stock = bundle.stocks[ticker];

  // 2026-09-11 ("allow user to add more companies to Reverse DCF") —
  // same Screener.in fetch Companies.tsx/Watchlist.tsx already use
  // (bulkAddCompanies), so a ticker not yet in this app's ledger can
  // be pulled in without leaving this page. Newly-added company is
  // auto-selected once it lands.
  const [newTickerInput, setNewTickerInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  async function handleAddTicker() {
    const t = newTickerInput.trim().toUpperCase();
    if (!t) return;
    setAdding(true);
    setAddError("");
    try {
      const { successes, failures } = await bulkAddCompanies(t);
      if (successes.length) {
        const added = successes[0];
        setBundle((b) => ({ ...b, stocks: { ...b.stocks, [added.ticker]: added.stock } }));
        setTicker(added.ticker);
        setNewTickerInput("");
      } else {
        setAddError(failures[0]?.error ?? "Couldn't find that ticker on Screener.in");
      }
    } catch {
      setAddError("Fetch failed — check the ticker and try again");
    } finally {
      setAdding(false);
    }
  }

  // Company-panel state — 2026-09-11 ("allow to edit the details for
  // all fields"): originally read-only, straight off the stock
  // record. Now plain editable numbers like the Assumptions below,
  // pre-filled from the picked stock's own last actuals but fully
  // overridable — useful when Screener.in's numbers are stale, or you
  // want to model a "what if revenue/margin were X" scenario without
  // it silently reverting.
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [marketCapCr, setMarketCapCr] = useState<number | null>(null);
  const [currentRevenueCr, setCurrentRevenueCr] = useState<number | null>(null);
  const [avg3yGrowth, setAvg3yGrowth] = useState<number | null>(null);

  // Assumption state — pre-filled from the picked stock's own last
  // actuals where sensible, but every field is a plain editable
  // number (see the module comment above for why margin/terminal
  // growth/capex/WC are assumptions here, not solved).
  const [waccPct, setWaccPct] = useState(12);
  const [taxRatePct, setTaxRatePct] = useState<number | null>(null);
  const [years, setYears] = useState(10);
  const [marginPct, setMarginPct] = useState<number | null>(null);
  const [terminalGrowthPct, setTerminalGrowthPct] = useState(5);
  const [netCapexPct, setNetCapexPct] = useState(0);
  const [wcPct, setWcPct] = useState(0);
  const [netDebtCr, setNetDebtCr] = useState<number | null>(null);
  const [lastTicker, setLastTicker] = useState<string>("");

  // Re-seed every editable field from the newly-picked stock's own
  // last actuals, but only when the ticker actually changes — so
  // edits the user makes (to either the Company panel or Assumptions)
  // aren't silently clobbered on every re-render.
  if (ticker !== lastTicker && stock) {
    setLastTicker(ticker);
    setCurrentPrice(stock.current_price ?? 0);
    setMarketCapCr(stock.market_cap_cr ?? 0);
    setCurrentRevenueCr(lastActual(stock.revenue) ?? 0);
    const hist = (stock.revenue_growth_pct ?? []).filter((v): v is number => v !== null && v !== undefined);
    setAvg3yGrowth(hist.length ? hist.slice(-3).reduce((s, v) => s + v, 0) / Math.min(3, hist.length) : 0);
    setTaxRatePct(lastActual(stock.tax_pct) ?? 25);
    setMarginPct(lastActual(stock.opm_pct) ?? 15);
    setNetDebtCr(lastActual(stock.borrowings) ?? 0);
  }

  const targetEvCr = marketCapCr !== null && netDebtCr !== null ? marketCapCr + netDebtCr : null;

  const result = useMemo(() => {
    if (currentRevenueCr === null || currentRevenueCr <= 0 || targetEvCr === null || taxRatePct === null || marginPct === null) {
      return { impliedGrowthPct: null, evAtImpliedGrowth: null };
    }
    return solveReverseDcf({
      currentRevenueCr,
      sustainableMarginPct: marginPct,
      taxRatePct,
      waccPct,
      years,
      terminalGrowthPct,
      netCapexPctOfRevenue: netCapexPct,
      wcPctOfIncrementalRevenue: wcPct,
      targetEvCr,
    });
  }, [currentRevenueCr, targetEvCr, taxRatePct, marginPct, waccPct, years, terminalGrowthPct, netCapexPct, wcPct]);

  // avg3yGrowth is its own editable field now (see the re-seed block
  // above) — pre-filled from the stock's own revenue_growth_pct
  // history, same "conservative vs aggressive" comparison Saigal makes
  // against what the business has actually delivered, but overridable
  // (e.g. swap in an analyst estimate instead of raw history).
  const verdict =
    result.impliedGrowthPct !== null && avg3yGrowth !== null
      ? result.impliedGrowthPct < avg3yGrowth - 3
        ? "conservative"
        : result.impliedGrowthPct > avg3yGrowth + 3
          ? "aggressive"
          : "in line"
      : null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">🔄 Reverse DCF</h1>
        <span className="text-slate-500 text-sm">What growth is the current price already pricing in?</span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Modeled on{" "}
        <a href="https://www.youtube.com/watch?v=Quk32-WxE4Q" target="_blank" rel="noreferrer" className="underline">
          Anshul Saigal's "Anatomy of a Mispriced Stock"
        </a>{" "}
        (CFA Society India webinar) — hold today's price fixed, solve backward for the implied growth rate.
      </p>

      <MethodologyNote>
        Saigal's slide shows three numbers (10yr sales growth, sustainable margin, implied terminal growth) read off Bloomberg's own
        reverse-DCF tool — the actual inputs (WACC, tax rate, capex/working-capital treatment) are never disclosed, and solving for all
        three from one equation (today's price) isn't mathematically well-posed without more structure than that. So here, <b>Sustainable
        Margin</b> and <b>Terminal Growth</b> below are assumptions you set (pre-filled with sensible defaults — current OPM% and 5%), and
        this page solves for the one remaining unknown: the <b>constant annual revenue growth rate</b> over the projection period that
        makes a simplified DCF's enterprise value equal today's actual EV (Market Cap + Net Debt). FCFF = Revenue × Margin × (1 − Tax) −
        Net Capex − ΔWorking Capital, both as a % of revenue (default 0% — "capex ≈ depreciation, no net WC drag" — adjust if you know a
        company needs real growth capital). Net Debt defaults to the stock's latest Borrowings (Screener's simplified balance sheet
        doesn't reliably surface a Cash line for this app to net out automatically) — edit it if the company holds meaningful cash, which
        matters a lot here (a cash-rich company's true EV is lower than its market cap, so the price is pricing in LESS growth than it looks
        like at first glance — exactly the setup in Saigal's own Putney Computer example). This is a simplified, honestly-labeled proxy for
        Bloomberg's undisclosed model, not a claim to replicate it exactly.
      </MethodologyNote>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
        <div className="p-4 border border-slate-200 rounded-lg">
          <h2 className="text-sm font-medium text-slate-700 mb-3">Company</h2>
          <label className="flex flex-col gap-1 text-xs text-slate-600 mb-2">
            <span>Ticker</span>
            <select value={ticker} onChange={(e) => setTicker(e.target.value)} className="px-2 py-1.5 border border-slate-300 rounded text-sm">
              {tickers.map((t) => (
                <option key={t} value={t}>
                  {t} — {bundle.stocks[t].name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1 mb-3">
            <input
              type="text"
              value={newTickerInput}
              onChange={(e) => setNewTickerInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddTicker()}
              placeholder="Add a ticker not listed above…"
              className="flex-1 px-2 py-1 border border-slate-300 rounded text-xs"
            />
            <button
              onClick={handleAddTicker}
              disabled={adding || !newTickerInput.trim()}
              className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400 disabled:opacity-50 whitespace-nowrap"
            >
              {adding ? "Fetching…" : "+ Add"}
            </button>
          </div>
          {addError && <p className="text-xs text-red-600 mb-3">{addError}</p>}
          {stock && (
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Current Price" value={currentPrice ?? 0} onChange={setCurrentPrice} />
              <NumberField label="Market Cap" value={marketCapCr ?? 0} onChange={setMarketCapCr} suffix="Cr" />
              <NumberField label="Latest Revenue (annual)" value={currentRevenueCr ?? 0} onChange={setCurrentRevenueCr} suffix="Cr" />
              <NumberField
                label="3Y Avg Revenue Growth"
                value={avg3yGrowth ?? 0}
                onChange={setAvg3yGrowth}
                suffix="%"
                title="Pre-filled from Screener.in's own history — edit to compare against an analyst estimate instead"
              />
              <div className="col-span-2 flex justify-between text-sm pt-1 border-t border-slate-100">
                <span className="text-slate-500">Implied EV (Mkt Cap + Net Debt)</span>
                <span className="tabular-nums font-medium">{fmt(targetEvCr, 0, " Cr")}</span>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border border-slate-200 rounded-lg">
          <h2 className="text-sm font-medium text-slate-700 mb-3">Assumptions</h2>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="WACC / Discount Rate" value={waccPct} onChange={setWaccPct} suffix="%" />
            <NumberField label="Tax Rate" value={taxRatePct ?? 25} onChange={setTaxRatePct} suffix="%" />
            <NumberField label="Projection Years" value={years} onChange={(v) => setYears(Math.round(v))} />
            <NumberField
              label="Sustainable EBITDA Margin"
              value={marginPct ?? 15}
              onChange={setMarginPct}
              suffix="%"
              title="Held constant across the whole projection period — Saigal's own 'sustainable margins' line"
            />
            <NumberField label="Terminal Growth" value={terminalGrowthPct} onChange={setTerminalGrowthPct} suffix="%" title="Must be less than WACC" />
            <NumberField label="Net Debt" value={netDebtCr ?? 0} onChange={setNetDebtCr} suffix="Cr" title="Defaults to latest Borrowings — reduce this (even negative) if the company holds meaningful cash" />
            <NumberField label="Net Capex (Capex − D&A)" value={netCapexPct} onChange={setNetCapexPct} suffix="% of revenue" />
            <NumberField label="ΔWorking Capital" value={wcPct} onChange={setWcPct} suffix="% of Δrevenue" />
          </div>
        </div>
      </div>

      <div className="mt-6 p-6 border border-slate-200 rounded-lg text-center">
        <div className="text-xs text-slate-500 mb-1">Implied {years}-Year Revenue Growth (the market's own assumption, solved for)</div>
        {result.impliedGrowthPct !== null ? (
          <div className="text-4xl font-bold tabular-nums text-indigo-600">{fmtSigned(result.impliedGrowthPct, 1)}</div>
        ) : (
          <div className="text-2xl text-slate-400">
            Not solvable with these assumptions — try raising WACC above Terminal Growth, or check Market Cap/Revenue are non-zero.
          </div>
        )}
        {verdict && (
          <div className="mt-3 text-sm">
            vs. the stock's own <b>{fmtSigned(avg3yGrowth, 1)}</b> 3-year average revenue growth, this reads{" "}
            <span
              className={`font-semibold ${verdict === "conservative" ? "text-emerald-700" : verdict === "aggressive" ? "text-red-600" : "text-slate-600"}`}
            >
              {verdict}
            </span>
            {verdict === "conservative" && " — the market may be pricing in less growth than this business has recently delivered."}
            {verdict === "aggressive" && " — the price already assumes meaningfully faster growth than recent history, leaving less margin for error."}
            {verdict === "in line" && " — close to what the business has actually been doing."}
          </div>
        )}
      </div>

      {stock && (
        <p className="text-xs text-slate-400 mt-4 text-center">
          Not investment advice — same disclaimer Saigal's own slide carries: "this example is for illustrative purposes only." Full company detail:{" "}
          <button className="underline" onClick={() => navigate(`/company/${ticker}`)}>
            {ticker}
          </button>
        </p>
      )}
    </div>
  );
}
