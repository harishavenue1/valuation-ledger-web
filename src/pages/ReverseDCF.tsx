import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import { fmt, fmtSigned, lastActual } from "../lib/model";
import { computeStagedDcf, solveReverseDcf } from "../lib/reverseDcf";
import { MethodologyNote, Signed } from "../components/ScreenerTable";
import { bulkAddCompanies } from "../lib/bulkAdd";

const PROJECTION_YEARS = 10; // fixed — matches the 3 stages below (1-3 / 4-6 / 7-10)

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
// safety).
//
// Redesigned 2026-09-12 ("show the calculation table, also the growth
// rate should be editable, as a company cant grow at same rate for
// 10yrs, so 1-3 high, 3-6 medium, 6-10 low teens and then terminal can
// be low single digits") — a single flat solved growth number was the
// right SOLVE target but a poor thing to hand-edit (real growth
// decelerates). The page now shows the market's flat implied rate as
// a REFERENCE only (still solved via src/lib/reverseDcf.ts's
// solveReverseDcf, used to seed a sensible starting point), and the
// actual interactive model is three editable growth stages (years
// 1-3 / 4-6 / 7-10) plus the full year-by-year calculation table
// (computeStagedDcf) — editing a stage recomputes fair value FORWARD
// from that assumption and shows the resulting over/undervalued gap
// vs today's price, rather than solving backward for one number.
// Sustainable Margin and Terminal Growth remain fixed assumptions
// (Saigal's own framing — see reverseDcf.ts's module comment for why
// solving all of growth+margin+terminal-growth from one equation
// isn't well-posed).

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
  const [marginPct, setMarginPct] = useState<number | null>(null);
  const [terminalGrowthPct, setTerminalGrowthPct] = useState(5);
  const [netCapexPct, setNetCapexPct] = useState(0);
  const [wcPct, setWcPct] = useState(0);
  const [netDebtCr, setNetDebtCr] = useState<number | null>(null);
  const [lastTicker, setLastTicker] = useState<string>("");

  // 2026-09-12 ("the growth rate should be editable, as a company
  // can't grow at same rate for 10yrs, so 1-3 high, 3-6 medium, 6-10
  // low teens") — three editable stages instead of one flat solved
  // number (see computeStagedDcf's own module comment in
  // reverseDcf.ts for the full reasoning). Seeded from the flat SOLVED
  // rate below on ticker change (a sensible single starting point),
  // then freely editable — "↺ Match flat rate" re-syncs all three on
  // demand without fighting the user's edits on every keystroke.
  const [stage1Pct, setStage1Pct] = useState<number | null>(null);
  const [stage2Pct, setStage2Pct] = useState<number | null>(null);
  const [stage3Pct, setStage3Pct] = useState<number | null>(null);

  // Re-seed every editable field from the newly-picked stock's own
  // last actuals, but only when the ticker actually changes — so
  // edits the user makes (to either the Company panel or Assumptions)
  // aren't silently clobbered on every re-render. The three growth
  // stages are seeded HERE too, from a flat solve computed with local
  // consts (not the taxRatePct/marginPct/currentRevenueCr STATE
  // variables) — those state setters above don't take effect until
  // the next render, so reading the state back in this same pass
  // would seed from the PREVIOUS ticker's stale numbers.
  if (ticker !== lastTicker && stock) {
    setLastTicker(ticker);
    setCurrentPrice(stock.current_price ?? 0);
    const mcap = stock.market_cap_cr ?? 0;
    setMarketCapCr(mcap);
    const rev = lastActual(stock.revenue) ?? 0;
    setCurrentRevenueCr(rev);
    const hist = (stock.revenue_growth_pct ?? []).filter((v): v is number => v !== null && v !== undefined);
    // 2026-09-12 ("why alot of decimals for 3yr avg growth") — plain
    // division left a float like 7.233333333333334 sitting in the
    // editable field; round to 1 decimal, same precision as every
    // other %-field seeded on this page (tax/margin/etc via NumberField).
    setAvg3yGrowth(hist.length ? Math.round((hist.slice(-3).reduce((s, v) => s + v, 0) / Math.min(3, hist.length)) * 10) / 10 : 0);
    const tax = lastActual(stock.tax_pct) ?? 25;
    setTaxRatePct(tax);
    const margin = lastActual(stock.opm_pct) ?? 15;
    setMarginPct(margin);
    const netDebt = lastActual(stock.borrowings) ?? 0;
    setNetDebtCr(netDebt);

    const targetEv = mcap + netDebt;
    const seed =
      rev > 0 && targetEv > 0
        ? solveReverseDcf({
            currentRevenueCr: rev,
            sustainableMarginPct: margin,
            taxRatePct: tax,
            waccPct,
            years: PROJECTION_YEARS,
            terminalGrowthPct,
            netCapexPctOfRevenue: netCapexPct,
            wcPctOfIncrementalRevenue: wcPct,
            targetEvCr: targetEv,
          }).impliedGrowthPct
        : null;
    const g = seed !== null ? Math.round(seed * 10) / 10 : 10;
    setStage1Pct(g);
    setStage2Pct(g);
    setStage3Pct(g);
  }

  const targetEvCr = marketCapCr !== null && netDebtCr !== null ? marketCapCr + netDebtCr : null;

  // The flat SOLVED rate — kept purely as a reference/reset target for
  // the three stages now (see module comment above); no longer the
  // page's own headline number. Safe to read live state here since
  // this only recomputes reactively after the render above has
  // already settled — no staleness risk for a plain useMemo.
  const flatResult = useMemo(() => {
    if (currentRevenueCr === null || currentRevenueCr <= 0 || targetEvCr === null || taxRatePct === null || marginPct === null) {
      return { impliedGrowthPct: null, evAtImpliedGrowth: null };
    }
    return solveReverseDcf({
      currentRevenueCr,
      sustainableMarginPct: marginPct,
      taxRatePct,
      waccPct,
      years: PROJECTION_YEARS,
      terminalGrowthPct,
      netCapexPctOfRevenue: netCapexPct,
      wcPctOfIncrementalRevenue: wcPct,
      targetEvCr,
    });
  }, [currentRevenueCr, targetEvCr, taxRatePct, marginPct, waccPct, terminalGrowthPct, netCapexPct, wcPct]);

  function matchFlatRate() {
    if (flatResult.impliedGrowthPct === null) return;
    const g = Math.round(flatResult.impliedGrowthPct * 10) / 10;
    setStage1Pct(g);
    setStage2Pct(g);
    setStage3Pct(g);
  }

  const staged = useMemo(() => {
    if (currentRevenueCr === null || currentRevenueCr <= 0 || taxRatePct === null || marginPct === null || stage1Pct === null || stage2Pct === null || stage3Pct === null) {
      return null;
    }
    return computeStagedDcf({
      currentRevenueCr,
      sustainableMarginPct: marginPct,
      taxRatePct,
      waccPct,
      terminalGrowthPct,
      netCapexPctOfRevenue: netCapexPct,
      wcPctOfIncrementalRevenue: wcPct,
      stage1Pct,
      stage2Pct,
      stage3Pct,
    });
  }, [currentRevenueCr, taxRatePct, marginPct, waccPct, terminalGrowthPct, netCapexPct, wcPct, stage1Pct, stage2Pct, stage3Pct]);

  const sharesCr = stock ? lastActual(stock.shares_cr) : null;
  const impliedEquityCr = staged && netDebtCr !== null ? staged.totalEvCr - netDebtCr : null;
  const impliedPricePerShare = impliedEquityCr !== null && sharesCr !== null && sharesCr > 0 ? impliedEquityCr / sharesCr : null;
  const valuationGapPct = staged && targetEvCr !== null && targetEvCr > 0 ? ((staged.totalEvCr - targetEvCr) / targetEvCr) * 100 : null;
  const valuationVerdict = valuationGapPct === null ? null : valuationGapPct > 10 ? "undervalued" : valuationGapPct < -10 ? "overvalued" : "fairly valued";

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">🔄 Reverse DCF</h1>
        <span className="text-slate-500 text-sm">What growth is the current price already pricing in?</span>
        <button className="ml-auto text-xs underline text-indigo-600" onClick={() => navigate("/reverse-dcf-scan")}>
          📋 Scan every tracked company →
        </button>
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
        three from one equation (today's price) isn't mathematically well-posed without more structure than that. <b>Sustainable Margin</b>{" "}
        and <b>Terminal Growth</b> below are fixed assumptions you set (pre-filled with sensible defaults — current OPM% and 5%). Growth
        itself is <b>staged</b>, not flat — a single constant rate for 10 years is unrealistic, since most businesses decelerate — so you set
        three separate rates (years 1–3, 4–6, 7–10) instead; the "Match flat rate" button seeds all three from the market's own flat
        SOLVED rate as a starting point (the same backward-solve this page originally did, kept as a reference number), but from there it's
        a forward calculation: whatever growth path you enter gets run through the full 10-year model (visible in the calculation table
        below) to produce a fair value, compared against today's actual price/EV. FCFF = Revenue × Margin × (1 − Tax) − Net Capex −
        ΔWorking Capital, both as a % of revenue (default 0% — "capex ≈ depreciation, no net WC drag" — adjust if you know a company needs
        real growth capital). Net Debt defaults to the stock's latest Borrowings (Screener's simplified balance sheet doesn't reliably
        surface a Cash line for this app to net out automatically) — edit it if the company holds meaningful cash, which matters a lot here
        (a cash-rich company's true EV is lower than its market cap — exactly the setup in Saigal's own Putney Computer example). This is a
        simplified, honestly-labeled proxy for Bloomberg's undisclosed model, not a claim to replicate it exactly.
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
            <NumberField
              label="Sustainable EBITDA Margin"
              value={marginPct ?? 15}
              onChange={setMarginPct}
              suffix="%"
              title="Held constant across the whole 10-year projection — Saigal's own 'sustainable margins' line"
            />
            <NumberField label="Terminal Growth" value={terminalGrowthPct} onChange={setTerminalGrowthPct} suffix="%" title="Must be less than WACC — the permanent rate after year 10" />
            <NumberField label="Net Debt" value={netDebtCr ?? 0} onChange={setNetDebtCr} suffix="Cr" title="Defaults to latest Borrowings — reduce this (even negative) if the company holds meaningful cash" />
            <NumberField label="Net Capex (Capex − D&A)" value={netCapexPct} onChange={setNetCapexPct} suffix="% of revenue" />
            <NumberField label="ΔWorking Capital" value={wcPct} onChange={setWcPct} suffix="% of Δrevenue" />
          </div>
        </div>
      </div>

      <div className="mt-6 p-4 border border-slate-200 rounded-lg">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-medium text-slate-700">
            Growth Assumptions — staged, not flat{" "}
            <span className="font-normal text-slate-400" title="A single constant rate for 10 years is unrealistic — most businesses decelerate. Edit each stage directly.">
              (2026-09-12: "a company can't grow at same rate for 10yrs")
            </span>
          </h2>
          <button
            onClick={matchFlatRate}
            disabled={flatResult.impliedGrowthPct === null}
            className="ml-auto text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400 disabled:opacity-50 whitespace-nowrap"
            title="Reset all three stages to the market's own flat implied growth rate"
          >
            ↺ Match flat rate ({flatResult.impliedGrowthPct !== null ? fmtSigned(flatResult.impliedGrowthPct, 1) : "—"})
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <NumberField label="Years 1–3 (high)" value={stage1Pct ?? 0} onChange={setStage1Pct} suffix="%" />
          <NumberField label="Years 4–6 (medium)" value={stage2Pct ?? 0} onChange={setStage2Pct} suffix="%" />
          <NumberField label="Years 7–10 (low teens)" value={stage3Pct ?? 0} onChange={setStage3Pct} suffix="%" />
        </div>
      </div>

      <div className="mt-6 p-6 border border-slate-200 rounded-lg text-center">
        <div className="text-xs text-slate-500 mb-1">Fair value implied by your staged growth assumptions</div>
        {staged && impliedPricePerShare !== null ? (
          <div className="text-4xl font-bold tabular-nums text-indigo-600">{fmt(impliedPricePerShare, 2)}</div>
        ) : staged ? (
          <div className="text-4xl font-bold tabular-nums text-indigo-600">{fmt(staged.totalEvCr, 0, " Cr EV")}</div>
        ) : (
          <div className="text-2xl text-slate-400">
            Not computable with these assumptions — check WACC is above Terminal Growth, and Revenue is non-zero.
          </div>
        )}
        {valuationVerdict && currentPrice !== null && (
          <div className="mt-3 text-sm">
            vs. the current price of <b>{fmt(currentPrice, 2)}</b>, this staged scenario reads{" "}
            <span
              className={`font-semibold ${valuationVerdict === "undervalued" ? "text-emerald-700" : valuationVerdict === "overvalued" ? "text-red-600" : "text-slate-600"}`}
            >
              {valuationVerdict}
            </span>{" "}
            (<Signed v={valuationGapPct} digits={1} /> vs. today's EV of {fmt(targetEvCr, 0, " Cr")})
            {valuationVerdict === "undervalued" && " — this growth path is worth more than the market is currently paying."}
            {valuationVerdict === "overvalued" && " — the market is already paying more than this growth path justifies."}
            {valuationVerdict === "fairly valued" && " — close to what the market is already pricing in."}
          </div>
        )}
        <div className="mt-2 text-xs text-slate-400">
          Reference: the stock's own 3-year average revenue growth was <b>{fmtSigned(avg3yGrowth, 1)}</b>; the market's flat implied rate (all 10 years
          equal) is <b>{flatResult.impliedGrowthPct !== null ? fmtSigned(flatResult.impliedGrowthPct, 1) : "—"}</b>.
        </div>
      </div>

      {staged && (
        <div className="mt-6 p-4 border border-slate-200 rounded-lg overflow-x-auto">
          <h2 className="text-sm font-medium text-slate-700 mb-3">Calculation table — every year, shown</h2>
          <table className="text-sm border-collapse w-full" style={{ minWidth: 640 }}>
            <thead className="text-slate-500 text-xs">
              <tr>
                <th className="text-left px-2 py-1.5">Year</th>
                <th className="text-right px-2 py-1.5">Stage</th>
                <th className="text-right px-2 py-1.5">Growth %</th>
                <th className="text-right px-2 py-1.5">Revenue (Cr)</th>
                <th className="text-right px-2 py-1.5">FCFF (Cr)</th>
                <th className="text-right px-2 py-1.5">Discount Factor</th>
                <th className="text-right px-2 py-1.5">PV of FCFF (Cr)</th>
              </tr>
            </thead>
            <tbody>
              {staged.yearRows.map((r) => (
                <tr key={r.year} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">{r.year}</td>
                  <td className="px-2 py-1.5 text-right text-slate-400">{r.stage}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <Signed v={r.growthPct} digits={1} />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.revenueCr, 1)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.fcffCr, 1)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{r.discountFactor.toFixed(3)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(r.pvCr, 1)}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-300">
                <td className="px-2 py-1.5 font-medium" colSpan={4}>
                  Terminal Value (year 10 FCFF × (1+{terminalGrowthPct}%) ÷ (WACC − Terminal Growth))
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums" colSpan={2}>
                  {fmt(staged.terminalValueCr, 0)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(staged.pvTerminalValueCr, 1)}</td>
              </tr>
              <tr className="border-t border-slate-300 font-semibold">
                <td className="px-2 py-1.5" colSpan={6}>
                  Total Enterprise Value (sum of 10 years' PV + PV of Terminal Value)
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(staged.totalEvCr, 1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

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
