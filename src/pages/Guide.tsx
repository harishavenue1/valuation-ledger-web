import { useState } from "react";
import { api, ApiError } from "../lib/api";
import type { GuideEntrySetup, GuidePeriodRow, GuideResult } from "../lib/api";

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

function PeriodTable({ title, rows, note }: { title: string; rows: GuidePeriodRow[]; note?: string }) {
  return (
    <div className="border border-slate-200 rounded-lg p-4">
      <h3 className="font-semibold text-sm mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">Not enough history</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 text-right">
              <th className="text-left font-medium pb-1.5">Period</th>
              <th className="font-medium pb-1.5">Sales Gr.</th>
              <th className="font-medium pb-1.5">OP Gr.</th>
              <th className="font-medium pb-1.5">OPM</th>
              <th className="font-medium pb-1.5">EPS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.period} className="border-t border-slate-100">
                <td className="py-1.5 text-slate-700">{r.period}</td>
                <td className="py-1.5 text-right">{fmtPct(r.sales_growth_pct)}</td>
                <td className="py-1.5 text-right">{fmtPct(r.op_growth_pct)}</td>
                <td className="py-1.5 text-right">{r.opm_pct == null ? "—" : `${r.opm_pct.toFixed(1)}%`}</td>
                <td className="py-1.5 text-right font-medium">{fmtNum(r.eps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note && <p className="text-xs text-slate-400 mt-2">{note}</p>}
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
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold mb-1">🧭 Guide</h1>
      <p className="text-xs text-slate-500 mb-4">
        Type any NSE company name or symbol — checks it live against every fundamental + technical rule already encoded across this app's screeners (Minervini SEPA weekly RSI, Long-Term
        Investing Strategy EMA ribbon, MA Breakout, Value RSI Turnaround, Grandfather-Father-Son) plus ROE/ROCE/cash-conversion/operating-leverage fundamentals. A mechanical checklist against
        your own rules, not investment advice.
      </p>

      <div className="flex gap-2 mb-6">
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
          className="px-4 py-2 text-sm rounded border border-indigo-300 text-indigo-700 font-medium hover:border-indigo-400 disabled:opacity-50"
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

          <div className="grid md:grid-cols-2 gap-4">
            <PeriodTable title="📆 Quarterly Growth (last 3 qtrs)" rows={result.quarterly_table} />
            <PeriodTable title="📅 Annual Growth (last 3 yrs)" rows={result.annual_table} />
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-2">🧮 Ratios</h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-2">
              <StatBox label="PE" value={fmtNum(r?.pe, 1)} />
              <StatBox label="GPM" value="—" />
              <StatBox label="OPM" value={r?.opm_pct == null ? "—" : `${r.opm_pct.toFixed(1)}%`} />
              <StatBox label="PEG" value={fmtNum(r?.peg, 2)} good={r?.peg != null ? r.peg < 1.5 : null} />
              <StatBox label="ROE" value={r?.roe_pct == null ? "—" : `${r.roe_pct.toFixed(1)}%`} good={r?.roe_pct != null ? r.roe_pct > 15 : null} />
              <StatBox label="ROCE" value={r?.roce_pct == null ? "—" : `${r.roce_pct.toFixed(1)}%`} good={r?.roce_pct != null ? r.roce_pct > 15 : null} />
              <StatBox label="Working Cap." value={r?.working_capital_days == null ? "—" : `${r.working_capital_days.toFixed(0)}d`} />
            </div>
            <p className="text-xs text-slate-400 mt-1">GPM isn't available — Screener.in has no distinct Gross Profit line in its standard P&L. Working Capital reads "—" for financial companies (no working-capital cycle).</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <h3 className="font-semibold text-sm mb-2">📉 Technical (RSI)</h3>
              <div className="grid grid-cols-3 gap-2">
                <StatBox label="Daily" value={fmtNum(rsi?.daily, 1)} good={rsi?.daily != null ? rsi.daily > 66 : null} />
                <StatBox label="Weekly" value={fmtNum(rsi?.weekly, 1)} good={rsi?.weekly != null ? rsi.weekly > 66 : null} />
                <StatBox label="Monthly" value={fmtNum(rsi?.monthly, 1)} good={rsi?.monthly != null ? rsi.monthly > 66 : null} />
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-sm mb-2">📈 Prices vs Weekly EMA</h3>
              <div className="grid grid-cols-3 gap-2">
                {(["ema12w", "ema21w", "ema33w"] as const).map((k) => (
                  <div key={k} className={`border rounded-lg px-3 py-2 ${prices?.[k]?.above ? "border-emerald-300 bg-emerald-50" : prices ? "border-red-200 bg-red-50" : "border-slate-200"}`}>
                    <div className="text-xs text-slate-500">{k.replace("ema", "").replace("w", "W EMA")}</div>
                    <div className="text-sm font-semibold">{prices ? (prices[k].above ? "Yes" : "No") : "—"}</div>
                    <div className="text-xs text-slate-500">{prices ? fmtNum(prices[k].value, 2) : ""}</div>
                  </div>
                ))}
              </div>
            </div>
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
        </div>
      )}
    </div>
  );
}
