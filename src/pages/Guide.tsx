import { useState } from "react";
import { api, ApiError } from "../lib/api";
import type { GuideChecklistItem, GuideResult } from "../lib/api";

// Guide page — added 2026-08-30, "type a company name, check it
// against a multibagger checklist". Merges every fundamental/technical
// rule already coded elsewhere in this app into one scorecard for a
// single company, fetched live (api/fetch_company.py's `?guide=`
// branch + api/_multibagger.py) — works for any NSE company, not just
// ones already tracked in the ledger. This is a mechanical check
// against Harish's own pre-defined rules (same as every screener's
// verdict elsewhere in this app), not investment advice — the wording
// throughout deliberately stays in "criteria met" terms, not "buy"/
// "sell".
function Tick({ pass }: { pass: boolean | null }) {
  if (pass === null) return <span className="text-slate-300">—</span>;
  return pass ? <span className="text-emerald-600">✅</span> : <span className="text-red-500">❌</span>;
}

function ChecklistSection({ title, passed, applicable, items }: { title: string; passed: number; applicable: number; items: GuideChecklistItem[] }) {
  return (
    <div className="border border-slate-200 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-semibold text-sm">{title}</h3>
        <span className="text-xs text-slate-500 ml-auto">
          {passed}/{applicable} met
        </span>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {items.map((it) => (
            <tr key={it.key} className="border-t border-slate-100 first:border-t-0">
              <td className="py-1.5 pr-2 w-6 text-center">
                <Tick pass={it.pass} />
              </td>
              <td className="py-1.5 pr-3 text-slate-700">{it.label}</td>
              <td className="py-1.5 text-right font-medium whitespace-nowrap">{it.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function verdictColor(verdict: string) {
  if (verdict === "Strong checklist match") return "bg-emerald-50 border-emerald-300 text-emerald-800";
  if (verdict === "Partial match — watchlist") return "bg-amber-50 border-amber-300 text-amber-800";
  if (verdict === "Weak match") return "bg-slate-50 border-slate-300 text-slate-600";
  return "bg-slate-50 border-slate-300 text-slate-500";
}

function EntrySetupBadge({ label, setup, detail }: { label: string; setup: { active: boolean; [k: string]: any } | null | undefined; detail?: string }) {
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

  return (
    <div className="max-w-3xl">
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
            <p className="text-xs text-amber-600">⚠️ Technicals couldn't be computed ({result.technicals_error}) — fundamentals checklist below is still real, technicals shown as "—".</p>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <ChecklistSection title="📊 Fundamentals (Screener.in)" passed={result.fundamentals.passed} applicable={result.fundamentals.applicable} items={result.fundamentals.items} />
            <ChecklistSection title="📈 Technical Strength (yfinance)" passed={result.technicals.passed} applicable={result.technicals.applicable} items={result.technicals.items} />
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
