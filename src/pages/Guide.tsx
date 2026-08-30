import { useState } from "react";
import { api, ApiError } from "../lib/api";
import type { GuideCompoundingChecklist, GuideEntrySetup, GuideFundamentalTrend, GuidePeriodRow, GuideQuantLogic, GuideResult, GuideRsBenchmark, GuideTrendRow, GuideVirajLogic } from "../lib/api";

// Guide page — added 2026-08-30, "type a company name, check it
// against a multibagger checklist". Merges every fundamental/technical
// rule already coded elsewhere in this app into one view for a single
// company, fetched live (api/fetch_company.py's `?guide=` branch +
// api/_multibagger.py) — works for any NSE company, not just ones
// already tracked in the ledger. Redesigned same day from an all-ticks
// checklist into data tables/panels (Harish: "lets have columns...")
// — the score badge (still a mechanical "criteria met" tally against
// Harish's own pre-defined rules, not investment advice) is the only
// piece carried over from the original layout.
function fmtPct(v: number | null | undefined, digits = 1) {
  return v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}
function fmtNum(v: number | null | undefined, digits = 2) {
  return v == null ? "—" : v.toFixed(digits);
}

function Tick({ pass }: { pass: boolean | null }) {
  if (pass === null) return <span className="text-slate-300">—</span>;
  return pass ? <span className="text-emerald-600">✅</span> : <span className="text-red-500">❌</span>;
}

// Colored pill instead of a bare tick — reads more like a dashboard
// "Signal" cell (Harish's reference screenshot) than a plain checkbox.
function PassBadge({ pass }: { pass: boolean | null }) {
  if (pass === null) return <span className="text-xs text-slate-300">—</span>;
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${pass ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`}>{pass ? "PASS" : "FAIL"}</span>
  );
}

// A "Strong / Good / Mixed / Weak" chip from a score/scored pair — same
// four-tier language as Harish's reference screenshot's Signal column
// (⭐ Strong / ↑ Good / ~ Mixed).
function SignalChip({ score, scored }: { score: number; scored: number }) {
  if (scored === 0) return <span className="text-xs text-slate-400">— no data</span>;
  const pct = score / scored;
  const [label, cls] =
    pct === 1 ? ["⭐ Strong", "bg-emerald-100 text-emerald-800"] : pct >= 0.6 ? ["↑ Good", "bg-emerald-50 text-emerald-700"] : pct >= 0.4 ? ["~ Mixed", "bg-amber-50 text-amber-700"] : ["↓ Weak", "bg-red-50 text-red-600"];
  return <span className={`inline-block text-xs font-semibold px-2 py-1 rounded-full ${cls}`}>{label}</span>;
}

// Dark navy header bar, per Harish's reference screenshot — used on
// every data table on this page instead of a plain light-grey <thead>.
function TableHead({ cols }: { cols: { label: string; align?: "left" | "right" | "center" }[] }) {
  return (
    <thead>
      <tr className="bg-slate-800 text-white text-xs">
        {cols.map((c, i) => (
          <th key={i} className={`font-semibold py-2 px-2.5 ${c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left"} ${i === 0 ? "rounded-l" : ""} ${i === cols.length - 1 ? "rounded-r" : ""}`}>
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

// Growth/return % cell with a tinted background (green/red), matching
// the reference screenshot's colored Rev YoY%/OPM chg/EPS YoY% cells
// instead of plain colored text.
function PctCell({ v, digits = 1, suffix = "%" }: { v: number | null | undefined; digits?: number; suffix?: string }) {
  if (v == null) return <td className="py-1.5 px-2.5 text-right text-slate-300">—</td>;
  const cls = v > 0 ? "bg-emerald-50 text-emerald-700" : v < 0 ? "bg-red-50 text-red-600" : "bg-slate-50 text-slate-600";
  return <td className={`py-1.5 px-2.5 text-right font-medium ${cls}`}>{v > 0 ? "+" : ""}{v.toFixed(digits)}{suffix}</td>;
}

function PeriodTable({ title, rows, note }: { title: string; rows: GuidePeriodRow[]; note?: string }) {
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
      <h3 className="font-semibold text-sm px-4 pt-4 pb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400 px-4 pb-4">Not enough history</p>
      ) : (
        <table className="w-full text-sm">
          <TableHead cols={[{ label: "Period" }, { label: "Sales Gr.", align: "right" }, { label: "OP Gr.", align: "right" }, { label: "OPM", align: "right" }, { label: "EPS", align: "right" }]} />
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.period} className={i % 2 === 1 ? "bg-slate-50/60" : ""}>
                <td className="py-1.5 px-2.5 text-slate-700">{r.period}</td>
                <PctCell v={r.sales_growth_pct} />
                <PctCell v={r.op_growth_pct} />
                <td className="py-1.5 px-2.5 text-right text-slate-600">{r.opm_pct == null ? "—" : `${r.opm_pct.toFixed(1)}%`}</td>
                <td className="py-1.5 px-2.5 text-right font-medium">{fmtNum(r.eps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note && <p className="text-xs text-slate-400 px-4 pb-3 pt-1">{note}</p>}
    </div>
  );
}

function StatBox({ label, value, good }: { label: string; value: string; good?: boolean | null }) {
  const color = good === true ? "text-emerald-700" : good === false ? "text-red-600" : "text-slate-800";
  return (
    <div className="border border-slate-200 rounded-lg px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-base font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function verdictColor(verdict: string) {
  if (verdict === "Strong checklist match") return "bg-emerald-50 border-emerald-300 text-emerald-800";
  if (verdict === "Partial match — watchlist") return "bg-amber-50 border-amber-300 text-amber-800";
  if (verdict === "Weak match") return "bg-slate-50 border-slate-300 text-slate-600";
  return "bg-slate-50 border-slate-300 text-slate-500";
}

function EntrySetupBadge({ label, setup, detail }: { label: string; setup: GuideEntrySetup | null | undefined; detail?: string }) {
  const active = !!setup?.active;
  return (
    <div className={`border rounded-lg p-3 text-sm ${active ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
      <div className="flex items-center gap-2">
        <span>{active ? "✅" : "⬜️"}</span>
        <span className="font-medium">{label}</span>
      </div>
      {active && detail && <p className="text-xs text-slate-600 mt-1">{detail}</p>}
      {!active && <p className="text-xs text-slate-400 mt-1">Not currently triggered</p>}
    </div>
  );
}

function TrendTable({ title, rows, unit }: { title: string; rows: GuideTrendRow[]; unit: "%" | "pts" }) {
  return (
    <div className="rounded-lg overflow-hidden border border-slate-100">
      <h4 className="text-xs font-semibold text-slate-500 px-2.5 pt-2 pb-1.5 bg-slate-50">{title}</h4>
      <table className="w-full text-sm">
        <TableHead cols={[{ label: "Metric" }, { label: "1Y", align: "right" }, { label: "3Y", align: "right" }, { label: "5Y", align: "right" }]} />
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.label} className={i % 2 === 1 ? "bg-slate-50/60" : ""}>
              <td className="py-1 px-2.5 text-slate-700">{r.label}</td>
              {unit === "%"
                ? ([r.y1, r.y3, r.y5] as (number | null)[]).map((v, j) => <PctCell key={j} v={v} />)
                : ([r.y1, r.y3, r.y5] as (number | null)[]).map((v, j) => (
                    <PctCell key={j} v={v} suffix="pts" />
                  ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// FundamentalTrend mirror — collapsed by default (details/summary, per
// ScreenerTable.tsx's MethodologyNote pattern elsewhere in this app)
// since this is a lot of extra detail on top of the always-visible
// panels above.
function FundamentalTrendSection({ ft }: { ft: GuideFundamentalTrend }) {
  const flag = ft.deterioration_flag;
  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm">
      <h3 className="font-semibold text-sm mb-3">📐 Fundamental Trend (1Y/3Y/5Y)</h3>
      <div className="space-y-4">
        <TrendTable title="Growth (CAGR)" rows={ft.growth} unit="%" />
        <TrendTable title="Days / Return ratios (point change)" rows={ft.ratios} unit="pts" />
      </div>
      <div className={`mt-3 text-xs rounded p-2 ${!flag.scoreable ? "bg-slate-50 text-slate-500" : flag.deteriorating ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
        {!flag.scoreable
          ? "Cash Conversion Deterioration flag: Working Capital Days and/or ROCE row not found — check skipped."
          : flag.deteriorating
            ? `⚠️ Cash Conversion Deterioration: YES — Working Capital Days trending up while ROCE trends down (growth may be consuming cash, not generating it).${flag.ccc_confirms && flag.inventory_confirms ? " Cash Conversion Cycle and Inventory Days both confirm the operating cycle is the cause." : " CCC doesn't fully confirm — check the Balance Sheet's Other Assets schedule or a recent capital raise before treating this as purely operational."}`
            : "✅ Cash Conversion Deterioration: No — Working Capital Days isn't trending up alongside falling ROCE."}
      </div>
    </div>
  );
}

function CompoundingChecklistSection({ cc }: { cc: GuideCompoundingChecklist }) {
  const d = cc.dilution;
  const qc = cc.quarterly_concentration;
  return (
    <details className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
      <summary className="font-semibold text-sm cursor-pointer px-4 pt-4 pb-3 flex items-center gap-2">
        🧬 Compounding Engine Checklist
        <SignalChip score={cc.passed} scored={cc.scored} />
        <span className="text-xs text-slate-400 font-normal">{cc.passed}/{cc.scored} computed checks pass</span>
      </summary>
      <p className="text-xs text-slate-500 px-4 mb-3">
        Numbers-only subset of MultibaggerChecklist's 12-point check (point 1 — reading BSE order filings — needs judgment, not a mechanical fetch, so it's skipped here; run the skill locally for that
        plus the bull/bear synthesis).
      </p>
      <table className="w-full text-sm">
        <TableHead cols={[{ label: "#", align: "center" }, { label: "Check" }, { label: "Pass", align: "center" }, { label: "Detail" }]} />
        <tbody>
          {cc.checks.map((c, i) => (
            <tr key={c.n} className={`align-top ${i % 2 === 1 ? "bg-slate-50/60" : ""}`}>
              <td className="py-1.5 px-2.5 text-slate-400 text-center">{c.n}</td>
              <td className="py-1.5 px-2.5">{c.name}</td>
              <td className="py-1.5 px-2.5 text-center">
                <PassBadge pass={c.pass} />
              </td>
              <td className="py-1.5 px-2.5 text-xs text-slate-500">{c.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs font-medium px-4 py-3">{cc.pattern_verdict} (mechanical count, not a Claude-written thesis)</p>
      {d && (
        <div className="px-4 pb-2">
          <h4 className="text-xs font-semibold text-slate-500 mb-1">Share-count dilution timeline</h4>
          <p className="text-xs text-slate-600">
            1Y: {d["1Y"].pct == null ? "—" : `${d["1Y"].pct > 0 ? "+" : ""}${d["1Y"].pct}%`} · 3Y: {d["3Y"].pct == null ? "—" : `${d["3Y"].pct > 0 ? "+" : ""}${d["3Y"].pct}%`} · 5Y:{" "}
            {d["5Y"].pct == null ? "—" : `${d["5Y"].pct > 0 ? "+" : ""}${d["5Y"].pct}%`}
          </p>
        </div>
      )}
      {qc && qc.latest_quarter_pct_of_ttm_profit != null && (
        <p className={`text-xs px-4 pb-4 ${qc.concentrated ? "text-amber-700" : "text-slate-500"}`}>
          Latest quarter = {qc.latest_quarter_pct_of_ttm_profit}% of trailing-12-month net profit
          {qc.concentrated ? " — CONCENTRATED, treat multi-quarter durability as unproven." : "."}
        </p>
      )}
    </details>
  );
}

function RsBenchmarkSection({ rs }: { rs: GuideRsBenchmark | null }) {
  const windows: [string, string][] = [
    ["1w", "Weekly"],
    ["1m", "Monthly"],
    ["3m", "Quarterly"],
    ["6m", "Bi-Annually"],
    ["12m", "Yearly"],
  ];
  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm">
      <h3 className="font-semibold text-sm mb-3">📡 RS vs NIFTY 500 (5 timeframes)</h3>
      {!rs ? (
        <p className="text-xs text-slate-400 mt-2">Not enough history to compute.</p>
      ) : (
        <>
          <div className="rounded-lg overflow-hidden border border-slate-100">
            <table className="w-full text-sm">
              <TableHead cols={[{ label: "Window" }, { label: "Stock", align: "right" }, { label: "NIFTY 500", align: "right" }, { label: "RS", align: "right" }]} />
              <tbody>
                {windows.map(([k, label], i) => (
                  <tr key={k} className={i % 2 === 1 ? "bg-slate-50/60" : ""}>
                    <td className="py-1 px-2.5 text-slate-700">{label}</td>
                    <td className="py-1 px-2.5 text-right text-slate-600">{fmtPct(rs.returns[k])}</td>
                    <td className="py-1 px-2.5 text-right text-slate-600">{fmtPct(rs.benchmark_returns[k])}</td>
                    <PctCell v={rs.rs[k]} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            RS Score {fmtPct(rs.rs_score, 2)} (weighted 1W 10% / 1M 25% / 3M 30% / 6M 20% / 12M 15%) {rs.rs_new_high ? "· RS Line at a new high" : ""}
          </p>
        </>
      )}
    </div>
  );
}

// StrongStockScreener (SSS) mirrors — Quant Logic's 4-layer pipeline
// and Viraj Logic's F1-F3/C1-C3 6-rule scoring, applied to the single
// company Guide is checking rather than screening a whole universe.
function LogicTable({ checks }: { checks: { layer?: string; key: string; name: string; pass: boolean | null; detail: string }[] }) {
  return (
    <table className="w-full text-sm">
      <TableHead cols={[{ label: "", align: "center" }, { label: "Check" }, { label: "Pass", align: "center" }, { label: "Detail" }]} />
      <tbody>
        {checks.map((c, i) => (
          <tr key={c.key} className={i % 2 === 1 ? "bg-slate-50/60" : ""}>
            <td className="py-1.5 px-2.5 text-center text-xs font-semibold text-slate-400">{c.key}</td>
            <td className="py-1.5 px-2.5">{c.name}</td>
            <td className="py-1.5 px-2.5 text-center">
              <PassBadge pass={c.pass} />
            </td>
            <td className="py-1.5 px-2.5 text-xs text-slate-500">{c.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QuantLogicSection({ ql }: { ql: GuideQuantLogic }) {
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm h-full">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <h3 className="font-semibold text-sm">🧠 QUANT Logic</h3>
        <SignalChip score={ql.score} scored={ql.scored} />
      </div>
      <p className="text-xs text-slate-500 px-4 mb-3">
        Universe filter: Market Cap ₹500–20,000 Cr.{" "}
        {ql.mcap == null ? "Mkt Cap unknown." : ql.in_universe ? <span className="text-emerald-700 font-medium">₹{ql.mcap.toLocaleString("en-IN")} Cr — within range.</span> : <span className="text-amber-700 font-medium">₹{ql.mcap.toLocaleString("en-IN")} Cr — outside range, would be dropped from this universe.</span>}
      </p>
      <LogicTable checks={ql.checks} />
    </div>
  );
}

function VirajLogicSection({ vl }: { vl: GuideVirajLogic }) {
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm h-full">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <h3 className="font-semibold text-sm">🎯 VIRAJ Logic</h3>
        <SignalChip score={vl.score} scored={vl.scored} />
      </div>
      <p className="text-xs text-slate-500 px-4 mb-3">
        Universe — Chartink "RSI Uptrend" scan: Mkt Cap &gt; ₹500 Cr, Daily/Weekly/Monthly RSI(14) &gt; 66.{" "}
        {vl.in_universe == null ? "Not enough data to judge." : vl.in_universe ? <span className="text-emerald-700 font-medium">Currently qualifies.</span> : <span className="text-slate-500">Does not currently qualify.</span>}
      </p>
      <LogicTable checks={vl.checks} />
    </div>
  );
}

export default function Guide() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GuideResult | null>(null);

  async function check() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const r = await api.guideCheck(q);
      setResult(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "request failed");
    } finally {
      setLoading(false);
    }
  }

  const mab = result?.entry_setups.ma_breakout;
  const vrt = result?.entry_setups.value_rsi_turnaround;
  const gfs = result?.entry_setups.grandfather_father_son;
  const r = result?.ratios;
  const rsi = result?.rsi;
  const prices = result?.prices;

  return (
    <div className="max-w-[1600px]">
      <h1 className="text-xl font-semibold mb-1">🧭 Guide</h1>
      <p className="text-xs text-slate-500 mb-4 max-w-3xl">
        Type any NSE company name or symbol — checks it live against every fundamental + technical rule already encoded across this app's screeners (Minervini SEPA weekly RSI, Long-Term
        Investing Strategy EMA ribbon, MA Breakout, Value RSI Turnaround, Grandfather-Father-Son) plus ROE/ROCE/cash-conversion/operating-leverage fundamentals. A mechanical checklist against
        your own rules, not investment advice.
      </p>

      <div className="flex gap-2 mb-6 max-w-xl">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && check()}
          placeholder="e.g. TCS, Titan, Granules India"
          className="flex-1 border border-slate-300 rounded px-3 py-2 text-sm"
        />
        <button
          onClick={check}
          disabled={loading || !query.trim()}
          className="px-4 py-2 text-sm rounded border border-indigo-300 text-indigo-700 font-medium hover:border-indigo-400 disabled:opacity-50 whitespace-nowrap"
        >
          {loading ? "Checking… (~3-5s)" : "Check"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-4">❌ {error}</p>}

      {result && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <div className="font-semibold text-lg">{result.name}</div>
              <div className="text-xs text-slate-500">
                {result.ticker} · ₹{result.price?.toLocaleString("en-IN") ?? "—"}
                {result.pe_ratio != null && <> · PE {result.pe_ratio}</>}
                {result.market_cap_cr != null && <> · Mkt Cap ₹{result.market_cap_cr.toLocaleString("en-IN")} Cr</>}
              </div>
            </div>
            <div className={`ml-auto border rounded-lg px-4 py-2 text-center ${verdictColor(result.score.verdict)}`}>
              <div className="text-2xl font-bold leading-none">
                {result.score.passed}/{result.score.applicable}
              </div>
              <div className="text-xs font-medium mt-1">{result.score.verdict}</div>
            </div>
          </div>

          {result.technicals_error && (
            <p className="text-xs text-amber-600">⚠️ Technicals couldn't be computed ({result.technicals_error}) — fundamentals below are still real, technical panels shown as "—".</p>
          )}

          <div className="grid md:grid-cols-2 gap-4 items-start">
            <PeriodTable title="📆 Quarterly Growth (last 3 qtrs)" rows={result.quarterly_table} />
            <PeriodTable title="📅 Annual Growth (last 3 yrs)" rows={result.annual_table} />
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-2">🎯 Matching entry setups</h3>
            <div className="grid sm:grid-cols-3 gap-3">
              <EntrySetupBadge
                label="MA Breakout"
                setup={mab}
                detail={mab?.active ? "Recently crossed & holding above 200D/33W EMA, not overextended." : undefined}
              />
              <EntrySetupBadge
                label="Value RSI Turnaround"
                setup={vrt}
                detail={vrt?.active ? `Monthly RSI crossed 40 ${vrt.months_since_cross} month(s) ago, now ${vrt.rsi_m} and progressing.` : undefined}
              />
              <EntrySetupBadge
                label="Grandfather-Father-Son"
                setup={gfs}
                detail={gfs?.active ? `Monthly/Weekly RSI ${gfs.monthly_rsi}/${gfs.weekly_rsi}, daily pullback held — stop-loss ₹${gfs.stop_loss}.` : undefined}
              />
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <QuantLogicSection ql={result.quant_logic} />
            <VirajLogicSection vl={result.viraj_logic} />
          </div>

          {/* Fundamental Trend runs long (2 tables + a flag) — paired with
              Ratios/RSI+Prices/RS Benchmark stacked together rather than
              RS Benchmark alone, so neither column of this row is left
              with a lot of dead white space below a much shorter card
              (2026-08-30, "this section has enough space to fit in ratios
              and rsi"). */}
          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <FundamentalTrendSection ft={result.fundamental_trend} />
            <div className="space-y-4">
              <div className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm">
                <h3 className="font-semibold text-sm mb-3">🧮 Ratios</h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  <StatBox label="PE" value={fmtNum(r?.pe, 1)} />
                  <StatBox label="GPM" value="—" />
                  <StatBox label="OPM" value={r?.opm_pct == null ? "—" : `${r.opm_pct.toFixed(1)}%`} />
                  <StatBox label="PEG" value={fmtNum(r?.peg, 2)} good={r?.peg != null ? r.peg < 1.5 : null} />
                  <StatBox label="ROE" value={r?.roe_pct == null ? "—" : `${r.roe_pct.toFixed(1)}%`} good={r?.roe_pct != null ? r.roe_pct > 15 : null} />
                  <StatBox label="ROCE" value={r?.roce_pct == null ? "—" : `${r.roce_pct.toFixed(1)}%`} good={r?.roce_pct != null ? r.roce_pct > 15 : null} />
                  <StatBox label="Working Cap." value={r?.working_capital_days == null ? "—" : `${r.working_capital_days.toFixed(0)}d`} />
                </div>
                <p className="text-xs text-slate-400 mt-2">GPM not available on Screener.in. Working Cap. reads "—" for financial companies.</p>
              </div>

              <div className="border border-slate-200 rounded-lg p-4 space-y-4 bg-white shadow-sm">
                <div>
                  <h3 className="font-semibold text-sm mb-3">📉 RSI</h3>
                  <div className="grid grid-cols-3 gap-2">
                    <StatBox label="Daily" value={fmtNum(rsi?.daily, 1)} good={rsi?.daily != null ? rsi.daily > 66 : null} />
                    <StatBox label="Weekly" value={fmtNum(rsi?.weekly, 1)} good={rsi?.weekly != null ? rsi.weekly > 66 : null} />
                    <StatBox label="Monthly" value={fmtNum(rsi?.monthly, 1)} good={rsi?.monthly != null ? rsi.monthly > 66 : null} />
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold text-sm mb-3">📈 Prices vs Weekly EMA</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {(["ema12w", "ema21w", "ema33w"] as const).map((k) => (
                      <div key={k} className={`border rounded-lg px-2 py-1.5 ${prices?.[k]?.above ? "border-emerald-300 bg-emerald-50" : prices ? "border-red-200 bg-red-50" : "border-slate-200"}`}>
                        <div className="text-xs text-slate-500">{k.replace("ema", "").replace("w", "W")}</div>
                        <div className="text-sm font-semibold">{prices ? (prices[k].above ? "Yes" : "No") : "—"}</div>
                        <div className="text-xs text-slate-500">{prices ? fmtNum(prices[k].value, 2) : ""}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <RsBenchmarkSection rs={result.rs_benchmark} />
            </div>
          </div>
          <CompoundingChecklistSection cc={result.compounding_checklist} />
        </div>
      )}
    </div>
  );
}
