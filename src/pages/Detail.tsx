import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useData } from "../App";
import { api, ApiError } from "../lib/api";
import {
  CASE_COLOR,
  CASE_LABEL,
  CaseState,
  Case,
  Driver,
  GRID_CASES,
  N_EST_YEARS,
  Stock,
  cagrFor,
  computeModel,
  daysUntil,
  fmt,
  fmtSigned,
  getCaseState,
  headlineCagr,
} from "../lib/model";

const FIELD_LABEL: Record<keyof Driver, string> = {
  revGrowth: "Revenue Growth %",
  opm: "OPM %",
  tax: "Tax %",
  other_income: "Other Income Cr",
  interest: "Interest Expense Cr",
  depreciation: "Depreciation Cr",
  shares: "Number of Shares Cr",
  pe: "PE Multiple",
};
const FIELD_STEP: Record<string, number> = {
  revGrowth: 0.5,
  opm: 0.5,
  tax: 0.5,
  other_income: 1,
  interest: 1,
  depreciation: 1,
  shares: 0.01,
  pe: 0.5,
};
// Legend categories (2026-08-22 "Financially Free"-style redesign) —
// Revenue Growth %/OPM %/Tax % swing the model the most, so they're
// flagged "critical"; the rest are still editable estimates but lower-
// leverage; the P&L rows below them are never directly edited at all.
const CRITICAL_FIELDS: (keyof Driver)[] = ["revGrowth", "opm", "tax"];
const GROWTH_ROW_KEYS = new Set(["revenue_growth_pct", "opm_pct", "pat_growth_pct"]);

function estDateRange(year: number): { range: string; days: number } {
  const today = new Date();
  const end = new Date(year, 2, 31); // 31 Mar
  const fmtShort = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
  const days = Math.max(0, Math.round((end.getTime() - today.getTime()) / 86400000));
  return { range: `${fmtShort(today)} – ${fmtShort(end)}`, days };
}

export default function Detail() {
  const { ticker = "" } = useParams();
  const navigate = useNavigate();
  const { bundle, setBundle } = useData();
  const stock = bundle.stocks[ticker];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedCase, setSelectedCase] = useState<Case>("base");

  const guidance = bundle.guidance[ticker] ?? null;
  const caseStates: Record<Case, CaseState> = useMemo(() => {
    const out: any = {};
    if (stock) for (const c of GRID_CASES) out[c] = getCaseState(bundle.scenarios, stock, guidance, ticker, c);
    return out;
  }, [stock, bundle.scenarios, guidance, ticker]);

  const saveTimers = useRef<Record<string, any>>({});
  function scheduleSave(case_: Case, next: CaseState) {
    setBundle((b) => ({
      ...b,
      scenarios: { ...b.scenarios, [ticker]: { ...(b.scenarios[ticker] ?? {}), [case_]: next } },
    }));
    clearTimeout(saveTimers.current[case_]);
    saveTimers.current[case_] = setTimeout(() => {
      api.saveScenario(ticker, case_, next).catch(() => {});
    }, 500);
  }

  if (!stock) {
    return (
      <div className="text-slate-500">
        Company not found. <button className="underline" onClick={() => navigate("/companies")}>Add it</button>.
      </div>
    );
  }

  function updateDriver(case_: Case, i: number, field: keyof Driver, raw: string) {
    const state = caseStates[case_];
    const value = raw === "" ? null : parseFloat(raw);
    const parsed = value === null || Number.isNaN(value) ? null : value;
    const drivers = state.drivers.map((d, idx) => {
      if (idx !== i) return d;
      const nd = { ...d, [field]: parsed };
      // PE mirrors Revenue Growth % live until the user types their own
      // PE — detected by "pe still equals the OLD revGrowth".
      if (field === "revGrowth" && d.pe === d.revGrowth) nd.pe = parsed;
      return nd;
    });
    scheduleSave(case_, { ...state, drivers });
  }
  function updateAssumptions(case_: Case, text: string) {
    scheduleSave(case_, { ...caseStates[case_], assumptions: text });
  }
  function chooseYear(case_: Case, i: number) {
    scheduleSave(case_, { ...caseStates[case_], chosenYear: i });
  }
  async function clearCase(case_: Case) {
    await api.clearScenario(ticker, case_);
    setBundle((b) => {
      const forTicker = { ...(b.scenarios[ticker] ?? {}) };
      delete forTicker[case_];
      return { ...b, scenarios: { ...b.scenarios, [ticker]: forTicker } };
    });
  }

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const { stock: fresh } = await api.fetchCompany(ticker);
      setBundle((b) => ({ ...b, stocks: { ...b.stocks, [ticker]: fresh } }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  const basis = stock.consolidated ? "consolidated" : "standalone";
  const selectedModel = computeModel(stock, caseStates[selectedCase]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">{stock.name}</h1>
        <span className="text-slate-500 text-sm">({ticker})</span>
        <button onClick={refresh} disabled={busy} className="ml-auto text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400 disabled:opacity-50">
          {busy ? "Refreshing…" : `🔄 Refresh ${ticker} now`}
        </button>
      </div>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      <div className="flex flex-wrap gap-4 text-sm mb-4 py-3 border-y border-slate-200">
        <Stat label="Price" value={`₹${fmt(stock.current_price)}`} />
        <Stat label="P/E" value={`${fmt(stock.pe_ratio, 1)}x`} />
        <Stat label="Mkt Cap" value={`₹${fmt(stock.market_cap_cr)} Cr`} />
        <Stat label="52W High" value={`₹${fmt(stock.week52_high)}`} />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        {GRID_CASES.map((c) => {
          const h = headlineCagr(stock, caseStates[c]);
          const active = c === selectedCase;
          return (
            <button
              key={c}
              onClick={() => setSelectedCase(c)}
              className={`text-left rounded-lg border px-3 py-3 transition ${active ? "ring-2 ring-offset-1" : "border-slate-200 hover:border-slate-300"}`}
              style={{ borderLeftColor: CASE_COLOR[c], borderLeftWidth: 3, ...(active ? { borderColor: CASE_COLOR[c], boxShadow: `0 0 0 2px ${CASE_COLOR[c]}22` } : {}) }}
            >
              <div className="text-xs font-semibold" style={{ color: CASE_COLOR[c] }}>{CASE_LABEL[c]}</div>
              {h && h.cagr !== null ? (
                <>
                  <div className={`text-lg font-semibold ${h.cagr >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtSigned(h.cagr, 1)}</div>
                  <div className="text-[11px] text-slate-500">₹{fmt(h.sharePrice)} · FY{h.year}</div>
                </>
              ) : (
                <div className="text-sm text-slate-400 mt-1">fill PE to compute</div>
              )}
            </button>
          );
        })}
      </div>

      {stock.quarters && stock.quarters.length > 0 && <QuarterlyTable stock={stock} basis={basis} />}

      {/* ── Case selector for the estimate section below ── */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-slate-500">Modelling:</span>
        {GRID_CASES.map((c) => (
          <button
            key={c}
            onClick={() => setSelectedCase(c)}
            className="text-xs font-semibold px-3 py-1 rounded-full border"
            style={
              c === selectedCase
                ? { backgroundColor: CASE_COLOR[c], borderColor: CASE_COLOR[c], color: "white" }
                : { borderColor: "#e2e8f0", color: CASE_COLOR[c] }
            }
          >
            {CASE_LABEL[c].toUpperCase()}
          </button>
        ))}
        {guidance && (
          <span className="ml-auto text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1">
            📋 Guidance-seeded (as of {guidance.as_of || "unknown"})
          </span>
        )}
      </div>

      <AnnualTable stock={stock} basis={basis} case_={selectedCase} state={caseStates[selectedCase]} model={selectedModel} onUpdateDriver={updateDriver} />

      <CagrEstimatorCard
        stock={stock}
        case_={selectedCase}
        state={caseStates[selectedCase]}
        model={selectedModel}
        onUpdateDriver={updateDriver}
        onChooseYear={chooseYear}
        onUpdateAssumptions={updateAssumptions}
        onClear={clearCase}
      />

      <GuidancePanel ticker={ticker} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="tabular-nums">{value}</div>
    </div>
  );
}

const ANNUAL_ROWS: [string, string, number, string, boolean, boolean, keyof Driver | null][] = [
  ["Revenue Cr", "revenue", 0, "", false, true, null],
  ["Revenue Growth %", "revenue_growth_pct", 1, "%", true, false, "revGrowth"],
  ["Expenses Cr", "expenses", 0, "", false, false, null],
  ["Operating Profit Cr", "operating_profit", 0, "", false, true, null],
  ["OPM %", "opm_pct", 1, "%", true, false, "opm"],
  ["Other Income Cr", "other_income", 0, "", false, false, "other_income"],
  ["Interest Expense Cr", "interest", 0, "", false, false, "interest"],
  ["Depreciation Cr", "depreciation", 0, "", false, false, "depreciation"],
  ["PBT Cr", "pbt", 0, "", false, true, null],
  ["Tax %", "tax_pct", 1, "%", false, false, "tax"],
  ["PAT Cr", "net_profit", 0, "", false, true, null],
  ["PAT Growth %", "pat_growth_pct", 1, "%", true, false, null],
  ["Number of Shares Cr", "shares_cr", 3, "", false, false, "shares"],
  ["EPS ₹", "eps", 2, "", false, true, null],
];
const MODEL_KEY: Record<string, keyof ReturnType<typeof computeModel>[number]> = {
  revenue: "revenue",
  expenses: "expenses",
  operating_profit: "operating_profit",
  pbt: "pbt",
  net_profit: "pat",
  pat_growth_pct: "pat_growth",
  eps: "eps",
};

function AnnualTable({
  stock,
  basis,
  case_,
  state,
  model,
  onUpdateDriver,
}: {
  stock: Stock;
  basis: string;
  case_: Case;
  state: CaseState;
  model: ReturnType<typeof computeModel>;
  onUpdateDriver: (case_: Case, i: number, field: keyof Driver, raw: string) => void;
}) {
  const lastYear = parseInt(stock.years[stock.years.length - 1].split(" ")[1], 10);
  return (
    <div className="mb-6">
      <h2 className="text-base font-semibold mb-1">Annual Results</h2>
      <p className="text-xs text-slate-500 mb-2">
        Screener.in, {basis} — annual Profit &amp; Loss, plus {CASE_LABEL[case_].toLowerCase()} estimates
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs">
            <tr>
              <th className="text-left px-3 py-2">Financial Year</th>
              {stock.years.map((y) => (
                <th key={y} className="text-right px-3 py-2">{y}</th>
              ))}
              {Array.from({ length: N_EST_YEARS }, (_, i) => (
                <th key={i} className="text-right px-3 py-2 bg-amber-50/80">
                  <div>Mar {lastYear + i + 1}</div>
                  <div className="text-amber-600 font-bold text-[10px]">ESTIMATE</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ANNUAL_ROWS.map(([label, key, digits, suffix, colorize, bold, driverField]) => {
              const isGrowthRow = GROWTH_ROW_KEYS.has(key);
              return (
                <tr key={key} className="border-t border-slate-100">
                  <td
                    className={`px-3 py-1.5 whitespace-nowrap ${bold ? "font-semibold text-slate-800" : "text-slate-500"} ${isGrowthRow ? "text-rose-700" : ""}`}
                  >
                    {driverField && CRITICAL_FIELDS.includes(driverField) && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5" />}
                    {label}
                  </td>
                  {(stock[key] as (number | null)[]).map((v, i) => (
                    <td key={i} className={`px-3 py-1.5 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>
                      {colorize ? (
                        <span className={v === null ? "" : v >= 0 ? "text-emerald-600" : "text-red-600"}>{fmtSigned(v, digits, suffix)}</span>
                      ) : (
                        fmt(v, digits, suffix)
                      )}
                    </td>
                  ))}
                  {Array.from({ length: N_EST_YEARS }, (_, i) => (
                    <td key={i} className="px-2 py-1.5 bg-amber-50/50">
                      {driverField ? (
                        <input
                          type="number"
                          step={FIELD_STEP[driverField]}
                          className="num-input"
                          value={state.drivers[i][driverField] ?? ""}
                          onChange={(e) => onUpdateDriver(case_, i, driverField, e.target.value)}
                        />
                      ) : (
                        <div className="text-right tabular-nums text-slate-600 italic">{fmt((model[i] as any)[MODEL_KEY[key]], digits, suffix)}</div>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-4 mt-2 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-500" /> Critical inputs
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-indigo-400" /> Editable estimates
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-slate-300" /> Auto-computed
        </span>
      </div>
    </div>
  );
}

function CagrEstimatorCard({
  stock,
  case_,
  state,
  model,
  onUpdateDriver,
  onChooseYear,
  onUpdateAssumptions,
  onClear,
}: {
  stock: Stock;
  case_: Case;
  state: CaseState;
  model: ReturnType<typeof computeModel>;
  onUpdateDriver: (case_: Case, i: number, field: keyof Driver, raw: string) => void;
  onChooseYear: (case_: Case, i: number) => void;
  onUpdateAssumptions: (case_: Case, text: string) => void;
  onClear: (case_: Case) => void;
}) {
  const lastYear = parseInt(stock.years[stock.years.length - 1].split(" ")[1], 10);
  const h = headlineCagr(stock, state);
  // Highlight the explicitly-chosen year if set, else whichever year
  // headlineCagr() actually resolved to (the auto forward-walk) — so the
  // highlighted row always matches what the top chip is showing.
  const effectiveChosen = state.chosenYear ?? (h ? h.year - lastYear - 1 : null);

  return (
    <div className="mb-8">
      <div className="card overflow-hidden">
        <div className="px-4 py-2 text-xs font-bold text-white" style={{ backgroundColor: CASE_COLOR[case_] }}>
          {CASE_LABEL[case_].toUpperCase()}
        </div>
        <div className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="font-semibold text-slate-900">CAGR Estimator</h3>
              <p className="text-xs text-slate-500">{stock.name}</p>
            </div>
            <div className="text-right text-xs">
              <div className="text-slate-400">Current Price</div>
              <div className="font-bold text-slate-900">₹{fmt(stock.current_price)}</div>
              <div className="text-slate-400 mt-1">Current P/E</div>
              <div className="font-bold" style={{ color: CASE_COLOR[case_] }}>{fmt(stock.pe_ratio, 1)}</div>
            </div>
          </div>

          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="text-left px-3 py-2">Year</th>
                  <th className="text-right px-3 py-2">EPS (₹)</th>
                  <th className="text-right px-3 py-2 bg-amber-50/80">PE Multiple</th>
                  <th className="text-right px-3 py-2">Share Price (₹)</th>
                  <th className="text-right px-3 py-2">Upside</th>
                  <th className="text-right px-3 py-2">CAGR</th>
                  <th className="text-right px-3 py-2">Duration</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: N_EST_YEARS }, (_, i) => {
                  const year = lastYear + i + 1;
                  const eps = model[i]?.eps ?? null;
                  const pe = state.drivers[i]?.pe ?? null;
                  const sharePrice = eps !== null && pe ? eps * pe : null;
                  const upside = sharePrice !== null && stock.current_price ? (sharePrice / stock.current_price - 1) * 100 : null;
                  const cagr = cagrFor(stock.current_price, sharePrice, daysUntil(year));
                  const { range, days } = estDateRange(year);
                  const isChosen = effectiveChosen === i;
                  return (
                    <tr key={i} className={`border-t border-slate-100 ${isChosen ? "bg-emerald-50" : ""}`}>
                      <td className="px-3 py-2 font-medium">FY{year}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(eps, 1)}</td>
                      <td className="px-2 py-2 bg-amber-50/40">
                        <input
                          type="number"
                          step={0.5}
                          className="num-input"
                          value={pe ?? ""}
                          onChange={(e) => onUpdateDriver(case_, i, "pe", e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{sharePrice !== null ? `₹${fmt(sharePrice)}` : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {upside === null ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <span className={upside >= 0 ? "text-emerald-600" : "text-red-600"}>{fmtSigned(upside)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        {cagr === null ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <span className={cagr >= 0 ? "text-emerald-600" : "text-red-600"}>{fmtSigned(cagr, 1)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-[11px] text-slate-500 whitespace-nowrap">
                        {range} <span className="inline-block ml-1 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-medium">{days}d</span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          onClick={() => onChooseYear(case_, i)}
                          disabled={isChosen}
                          className={`text-[11px] px-2 py-1 rounded border font-medium ${
                            isChosen ? "border-emerald-300 text-emerald-700 bg-emerald-50" : "border-slate-300 text-slate-600 hover:border-indigo-400 hover:text-indigo-600"
                          }`}
                        >
                          {isChosen ? "✓ Headline" : "Use"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <div className="text-xs font-semibold text-slate-500 mb-1">Key Assumptions</div>
            <textarea
              defaultValue={state.assumptions}
              onChange={(e) => onUpdateAssumptions(case_, e.target.value)}
              placeholder={`Document your analysis assumptions for ${CASE_LABEL[case_]}…`}
              rows={4}
              className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-400"
            />
            <button
              onClick={() => onClear(case_)}
              className="mt-1.5 text-[11px] px-2 py-1 rounded border border-slate-300 hover:border-slate-400 text-slate-500"
            >
              Clear estimates
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const QUARTER_ROWS: [string, string, number, string, boolean, boolean][] = [
  ["Sales Cr", "q_revenue", 0, "", false, true],
  ["Sales Growth % (YoY)", "q_revenue_growth_pct", 1, "%", true, false],
  ["Expenses Cr", "q_expenses", 0, "", false, false],
  ["Operating Profit Cr", "q_operating_profit", 0, "", false, true],
  ["OPM %", "q_opm_pct", 1, "%", true, false],
  ["Other Income Cr", "q_other_income", 0, "", false, false],
  ["Interest Expense Cr", "q_interest", 0, "", false, false],
  ["Depreciation Cr", "q_depreciation", 0, "", false, false],
  ["PBT Cr", "q_pbt", 0, "", false, true],
  ["Tax %", "q_tax_pct", 1, "%", false, false],
  ["Net Profit Cr", "q_net_profit", 0, "", false, true],
  ["PAT Growth % (YoY)", "q_pat_growth_pct", 1, "%", true, false],
  ["EPS ₹", "q_eps", 2, "", false, true],
];

function QuarterlyTable({ stock, basis }: { stock: Stock; basis: string }) {
  return (
    <div className="mb-8">
      <h2 className="text-base font-semibold mb-1">Qtr Results</h2>
      <p className="text-xs text-slate-500 mb-2">
        Screener.in, {basis} — last {stock.quarters!.length} quarters
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs">
            <tr>
              <th className="text-left px-3 py-2">Quarter</th>
              {stock.quarters!.map((q) => (
                <th key={q} className="text-right px-3 py-2">{q}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {QUARTER_ROWS.map(([label, key, digits, suffix, colorize, bold]) => (
              <tr key={key} className="border-t border-slate-100">
                <td className={`px-3 py-1.5 ${bold ? "font-semibold text-slate-800" : "text-slate-500"}`}>{label}</td>
                {((stock[key] as (number | null)[]) ?? []).map((v, i) => (
                  <td key={i} className={`px-3 py-1.5 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>
                    {colorize ? (
                      <span className={v === null ? "" : v >= 0 ? "text-emerald-600" : "text-red-600"}>{fmtSigned(v, digits, suffix)}</span>
                    ) : (
                      fmt(v, digits, suffix)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GuidancePanel({ ticker }: { ticker: string }) {
  const { bundle, setBundle } = useData();
  const g = bundle.guidance[ticker] ?? {};
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    base: g.revenue_growth?.base ?? "",
    bull: g.revenue_growth?.bull ?? "",
    bear: g.revenue_growth?.bear ?? "",
    source_text: g.source_text ?? "",
    confidence: g.confidence ?? "",
    source_urls: (g.source_urls ?? []).join(", "),
    as_of: g.as_of ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const data = {
      revenue_growth: {
        base: form.base === "" ? undefined : parseFloat(String(form.base)),
        bull: form.bull === "" ? undefined : parseFloat(String(form.bull)),
        bear: form.bear === "" ? undefined : parseFloat(String(form.bear)),
      },
      source_text: form.source_text,
      confidence: form.confidence,
      source_urls: form.source_urls.split(",").map((s) => s.trim()).filter(Boolean),
      as_of: form.as_of,
    };
    try {
      await api.saveGuidance(ticker, data);
      setBundle((b) => ({ ...b, guidance: { ...b.guidance, [ticker]: data } }));
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-8 rounded-lg border border-slate-200 bg-white">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center px-3 py-2 text-sm font-medium text-slate-700">
        Management Guidance research
        <span className="ml-auto text-xs text-slate-500">{open ? "hide" : g.source_text ? "edit" : "add"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 text-sm">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Base rev growth %" value={form.base} onChange={(v) => setForm((f) => ({ ...f, base: v }))} />
            <Field label="Bull rev growth %" value={form.bull} onChange={(v) => setForm((f) => ({ ...f, bull: v }))} />
            <Field label="Bear rev growth %" value={form.bear} onChange={(v) => setForm((f) => ({ ...f, bear: v }))} />
          </div>
          <textarea
            placeholder="Guidance text (from concall / investor deck)…"
            value={form.source_text}
            onChange={(e) => setForm((f) => ({ ...f, source_text: e.target.value }))}
            className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-xs focus:outline-none focus:border-indigo-400"
            rows={3}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Confidence (e.g. High / Medium / Low)"
              value={form.confidence}
              onChange={(e) => setForm((f) => ({ ...f, confidence: e.target.value }))}
              className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-400"
            />
            <input
              placeholder="As of (date)"
              value={form.as_of}
              onChange={(e) => setForm((f) => ({ ...f, as_of: e.target.value }))}
              className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-400"
            />
          </div>
          <input
            placeholder="Source URLs, comma-separated"
            value={form.source_urls}
            onChange={(e) => setForm((f) => ({ ...f, source_urls: e.target.value }))}
            className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-400"
          />
          <button onClick={save} disabled={saving} className="text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-medium disabled:opacity-50">
            {saving ? "Saving…" : "Save guidance"}
          </button>
          <p className="text-[11px] text-slate-500">Seeds Base/Bull/Bear Revenue Growth % for any case that hasn't been hand-edited yet.</p>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string | number; onChange: (v: string) => void }) {
  return (
    <label className="text-xs text-slate-500">
      {label}
      <input type="number" step={0.5} value={value} onChange={(e) => onChange(e.target.value)} className="num-input mt-1 text-left" />
    </label>
  );
}
