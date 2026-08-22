import { useEffect, useMemo, useRef, useState } from "react";
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
  estYearLabel,
  fiscalQuarterLabel,
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
const FIELD_DIGITS: Record<string, number> = {
  revGrowth: 1,
  opm: 1,
  tax: 1,
  other_income: 1,
  interest: 1,
  depreciation: 1,
  shares: 3,
  pe: 1,
};
const EDITABLE_FIELDS: (keyof Driver)[] = ["revGrowth", "opm", "tax", "other_income", "interest", "depreciation", "shares"];

/** Same as Python's `arr[-1] if arr else fallback` — returns the last
 * element AS-IS (even if it's null), only using fallback when the array
 * itself is empty/missing. Deliberately not lastActual() (which skips
 * nulls) — this seeds the Playaround column exactly like the old app's
 * pg_seed did. */
function lastOr(arr: (number | null)[] | undefined, fallback: number): number | null {
  return arr && arr.length ? arr[arr.length - 1] : fallback;
}

export default function Detail() {
  const { ticker = "" } = useParams();
  const navigate = useNavigate();
  const { bundle, setBundle } = useData();
  const stock = bundle.stocks[ticker];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  // Playaround column — session-only scratch state, never persisted (see
  // lastOr's comment above). react-router keeps the same Detail instance
  // across a ticker change (same route, different param), so this needs
  // an explicit reset on ticker change rather than relying on remount.
  function seedPg(s: Stock | undefined) {
    return {
      revGrowth: lastOr(s?.revenue_growth_pct, 20),
      opm: lastOr(s?.opm_pct, 20),
      tax: lastOr(s?.tax_pct, 25),
      other_income: lastOr(s?.other_income, 0),
      interest: lastOr(s?.interest, 0),
      depreciation: lastOr(s?.depreciation, 0),
      shares: lastOr(s?.shares_cr, 0),
      pe: s?.pe_ratio || 20,
    };
  }
  const [pg, setPg] = useState(() => seedPg(stock));
  useEffect(() => {
    setPg(seedPg(stock));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  if (!stock) {
    return (
      <div className="text-neutral-500">
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
      // PE — detected by "pe still equals the OLD revGrowth", same
      // signal the old app tracked with an explicit pe_auto_key.
      if (field === "revGrowth" && d.pe === d.revGrowth) nd.pe = parsed;
      return nd;
    });
    scheduleSave(case_, { ...state, drivers });
  }
  function updateAssumptions(case_: Case, text: string) {
    scheduleSave(case_, { ...caseStates[case_], assumptions: text });
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

  const models: Record<Case, ReturnType<typeof computeModel>> = useMemo(() => {
    const out: any = {};
    for (const c of GRID_CASES) out[c] = computeModel(stock, caseStates[c]);
    return out;
  }, [stock, caseStates]);

  const lastYear = parseInt(stock.years[stock.years.length - 1].split(" ")[1], 10);
  const basis = stock.consolidated ? "consolidated" : "standalone";

  const pgModel = computeModel(stock, { drivers: [{ ...pg, pe: null } as Driver], assumptions: "" })[0];
  const pgImpliedPrice = pgModel.eps !== null && pg.pe ? pgModel.eps * pg.pe : null;
  const pgYear = lastYear + 1;
  const pgCagr = cagrFor(stock.current_price, pgImpliedPrice, daysUntil(pgYear));

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">{stock.name}</h1>
        <span className="text-neutral-500 text-sm">({ticker})</span>
        <button onClick={refresh} disabled={busy} className="ml-auto text-xs px-2 py-1 rounded border border-neutral-700 hover:border-neutral-500 disabled:opacity-50">
          {busy ? "Refreshing…" : `🔄 Refresh ${ticker} now`}
        </button>
      </div>
      {error && <p className="text-sm text-red-400 mb-2">{error}</p>}

      <div className="flex flex-wrap gap-4 text-sm mb-4 py-3 border-y border-neutral-800">
        <Stat label="Price" value={`₹${fmt(stock.current_price)}`} />
        <Stat label="P/E" value={`${fmt(stock.pe_ratio, 1)}x`} />
        <Stat label="Mkt Cap" value={`₹${fmt(stock.market_cap_cr)} Cr`} />
        <Stat label="52W High" value={`₹${fmt(stock.week52_high)}`} />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        {GRID_CASES.map((c) => {
          const h = headlineCagr(stock, caseStates[c]);
          return (
            <div key={c} className="rounded-lg border border-neutral-800 px-3 py-3" style={{ borderLeftColor: CASE_COLOR[c], borderLeftWidth: 3 }}>
              <div className="text-xs" style={{ color: CASE_COLOR[c] }}>{CASE_LABEL[c]}</div>
              {h && h.cagr !== null ? (
                <>
                  <div className={`text-lg font-semibold ${h.cagr >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtSigned(h.cagr, 1)}</div>
                  <div className="text-[11px] text-neutral-500">₹{fmt(h.sharePrice)} · FY{h.year}</div>
                </>
              ) : (
                <div className="text-sm text-neutral-600 mt-1">fill PE to compute</div>
              )}
            </div>
          );
        })}
      </div>

      {stock.quarters && stock.quarters.length > 0 && <QuarterlyTable stock={stock} basis={basis} />}
      <AnnualTable stock={stock} basis={basis} pg={pg} setPg={setPg} pgModel={pgModel} pgImpliedPrice={pgImpliedPrice} pgCagr={pgCagr} />

      {/* ── Future Projections & CAGR — one combined grid, all cases × all years ── */}
      <div className="mb-8">
        <h2 className="text-base font-semibold mb-2">🎯 Future Projections & CAGR — all cases, all years, one grid</h2>
        {guidance && (
          <p className="text-xs bg-blue-950/40 border border-blue-900 text-blue-300 rounded px-3 py-2 mb-3">
            📋 <b>Guidance-seeded</b> — Base/Bull/Bear Revenue Growth % pre-filled from management guidance research where
            available (as of {guidance.as_of || "unknown"}). Edit any case freely.
          </p>
        )}
        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="text-sm border-collapse w-full">
            <thead>
              <tr className="bg-neutral-900">
                <th className="w-40"></th>
                {Array.from({ length: N_EST_YEARS }, (_, i) =>
                  GRID_CASES.map((c, ci) => (
                    <th
                      key={`${i}-${c}`}
                      className="px-2 py-2 text-center border-l border-neutral-800 first:border-l-0"
                      style={i > 0 && ci === 0 ? { borderLeftWidth: 2, borderLeftColor: "#404040" } : undefined}
                    >
                      <div className="text-xs font-bold">FY{lastYear + i + 1}</div>
                      <div className="text-[11px] font-bold" style={{ color: CASE_COLOR[c] }}>
                        {CASE_LABEL[c].replace(" Case", "")}
                      </div>
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {EDITABLE_FIELDS.map((field) => (
                <tr key={field} className="border-t border-neutral-800">
                  <td className="px-3 py-1.5 text-neutral-400 text-xs whitespace-nowrap">{FIELD_LABEL[field]}</td>
                  {Array.from({ length: N_EST_YEARS }, (_, i) =>
                    GRID_CASES.map((c) => (
                      <td key={`${i}-${c}`} className="px-1 py-1.5">
                        <input
                          type="number"
                          step={FIELD_STEP[field]}
                          className="num-input"
                          value={caseStates[c].drivers[i][field] ?? ""}
                          onChange={(e) => updateDriver(c, i, field, e.target.value)}
                        />
                      </td>
                    ))
                  )}
                </tr>
              ))}
              {(
                [
                  ["Revenue Cr", "revenue", 0],
                  ["PAT Cr", "pat", 0],
                  ["EPS ₹", "eps", 2],
                ] as const
              ).map(([label, key, digits]) => (
                <tr key={key} className="border-t border-neutral-800">
                  <td className="px-3 py-1.5 text-neutral-500 text-xs italic">{label}</td>
                  {Array.from({ length: N_EST_YEARS }, (_, i) =>
                    GRID_CASES.map((c) => (
                      <td key={`${i}-${c}`} className="px-2 py-1.5 text-center text-neutral-400 italic text-sm">
                        {fmt((models[c][i] as any)[key], digits)}
                      </td>
                    ))
                  )}
                </tr>
              ))}
              <tr className="border-t border-neutral-800 bg-neutral-900/30">
                <td className="px-3 py-1.5 font-medium text-xs">PE Multiple</td>
                {Array.from({ length: N_EST_YEARS }, (_, i) =>
                  GRID_CASES.map((c) => (
                    <td key={`${i}-${c}`} className="px-1 py-1.5">
                      <input
                        type="number"
                        step={0.5}
                        className="num-input font-medium"
                        value={caseStates[c].drivers[i].pe ?? ""}
                        onChange={(e) => updateDriver(c, i, "pe", e.target.value)}
                      />
                    </td>
                  ))
                )}
              </tr>
              <tr className="border-t border-neutral-800">
                <td className="px-3 py-2 font-medium text-xs">CAGR</td>
                {Array.from({ length: N_EST_YEARS }, (_, i) =>
                  GRID_CASES.map((c) => {
                    const eps = models[c][i].eps;
                    const peVal = caseStates[c].drivers[i].pe;
                    const sharePrice = eps !== null && peVal ? eps * peVal : null;
                    const cagr = cagrFor(stock.current_price, sharePrice, daysUntil(lastYear + i + 1));
                    return (
                      <td key={`${i}-${c}`} className="px-2 py-2 text-center">
                        {cagr === null ? (
                          <span className="text-neutral-600">—</span>
                        ) : (
                          <span className={`text-lg font-bold ${cagr >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtSigned(cagr, 1)}</span>
                        )}
                      </td>
                    );
                  })
                )}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-neutral-500 mt-1.5">plain = editable estimate (carried forward by default) · italic = auto-computed</p>
      </div>

      {/* ── Key Assumptions ── */}
      <div className="mb-8">
        <h2 className="text-xs text-neutral-500 mb-2">Key Assumptions</h2>
        <div className="grid grid-cols-3 gap-3">
          {GRID_CASES.map((c) => (
            <div key={c}>
              <div className="text-xs font-semibold mb-1" style={{ color: CASE_COLOR[c] }}>{CASE_LABEL[c]}</div>
              <textarea
                defaultValue={caseStates[c].assumptions}
                onChange={(e) => updateAssumptions(c, e.target.value)}
                rows={5}
                className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-neutral-500"
              />
              <button
                onClick={() => clearCase(c)}
                className="mt-1 w-full text-[11px] px-2 py-1 rounded border border-neutral-700 hover:border-neutral-500 text-neutral-400"
              >
                Clear estimates
              </button>
            </div>
          ))}
        </div>
      </div>

      <GuidancePanel ticker={ticker} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-neutral-500">{label}</div>
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
// pg-computed (non-editable Playaround cell) values, keyed by the same
// stock-field name as ANNUAL_ROWS above, for the rows that don't have
// their own pgField (mirrors hist_row's pg_value= callers in app.py).
const PG_COMPUTED_KEY: Record<string, keyof ReturnType<typeof computeModel>[number]> = {
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
  pg,
  setPg,
  pgModel,
  pgImpliedPrice,
  pgCagr,
}: {
  stock: Stock;
  basis: string;
  pg: any;
  setPg: (fn: (p: any) => any) => void;
  pgModel: ReturnType<typeof computeModel>[number];
  pgImpliedPrice: number | null;
  pgCagr: number | null;
}) {
  function updatePg(field: string, raw: string) {
    const v = raw === "" ? null : parseFloat(raw);
    setPg((p: any) => ({ ...p, [field]: v === null || Number.isNaN(v) ? null : v }));
  }
  return (
    <div className="mb-8">
      <h2 className="text-base font-semibold mb-1">Annual Results</h2>
      <p className="text-xs text-neutral-500 mb-2">
        Screener.in, {basis} — annual Profit &amp; Loss
      </p>
      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-neutral-400 text-xs">
            <tr>
              <th className="text-left px-3 py-2">Financial Year</th>
              {stock.years.map((y) => (
                <th key={y} className="text-right px-3 py-2">{y}</th>
              ))}
              <th className="text-center px-3 py-2 text-amber-500">🧪 Playaround</th>
            </tr>
          </thead>
          <tbody>
            {ANNUAL_ROWS.map(([label, key, digits, suffix, colorize, bold, pgField]) => (
              <tr key={key} className="border-t border-neutral-800">
                <td className={`px-3 py-1.5 ${bold ? "font-semibold" : "text-neutral-400"}`}>{label}</td>
                {(stock[key] as (number | null)[]).map((v, i) => (
                  <td key={i} className={`px-3 py-1.5 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>
                    {colorize ? (
                      <span className={v === null ? "" : v >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtSigned(v, digits, suffix)}</span>
                    ) : (
                      fmt(v, digits, suffix)
                    )}
                  </td>
                ))}
                <td className="px-2 py-1.5">
                  {pgField ? (
                    <input
                      type="number"
                      step={FIELD_STEP[pgField]}
                      className="num-input"
                      value={(pg as any)[pgField] ?? ""}
                      onChange={(e) => updatePg(pgField, e.target.value)}
                    />
                  ) : (
                    <div className="text-right tabular-nums text-amber-200/80">
                      {fmt((pgModel as any)[PG_COMPUTED_KEY[key]], digits, suffix)}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            <tr className="border-t border-neutral-800 bg-neutral-900/30">
              <td className="px-3 py-1.5 font-semibold">Future PE</td>
              {stock.years.map((_, i) => (
                <td key={i} />
              ))}
              <td className="px-2 py-1.5">
                <input
                  type="number"
                  step={0.5}
                  className="num-input font-medium"
                  value={pg.pe ?? ""}
                  onChange={(e) => updatePg("pe", e.target.value)}
                />
              </td>
            </tr>
            <tr className="border-t border-neutral-800">
              <td className="px-3 py-1.5 font-semibold">Implied Price ₹</td>
              {stock.years.map((_, i) => (
                <td key={i} />
              ))}
              <td className="px-3 py-1.5 text-right font-bold text-amber-400">{fmt(pgImpliedPrice)}</td>
            </tr>
            <tr className="border-t border-neutral-800">
              <td className="px-3 py-1.5 font-semibold">CAGR</td>
              {stock.years.map((_, i) => (
                <td key={i} />
              ))}
              <td className={`px-3 py-1.5 text-right font-bold ${pgCagr === null ? "" : pgCagr >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {fmtSigned(pgCagr, 1)}
              </td>
            </tr>
          </tbody>
        </table>
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
      <p className="text-xs text-neutral-500 mb-2">
        Screener.in, {basis} — last {stock.quarters!.length} quarters
      </p>
      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-neutral-400 text-xs">
            <tr>
              <th className="text-left px-3 py-2">Quarter</th>
              {stock.quarters!.map((q) => (
                <th key={q} className="text-right px-3 py-2">{q}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {QUARTER_ROWS.map(([label, key, digits, suffix, colorize, bold]) => (
              <tr key={key} className="border-t border-neutral-800">
                <td className={`px-3 py-1.5 ${bold ? "font-semibold" : "text-neutral-400"}`}>{label}</td>
                {((stock[key] as (number | null)[]) ?? []).map((v, i) => (
                  <td key={i} className={`px-3 py-1.5 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>
                    {colorize ? (
                      <span className={v === null ? "" : v >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtSigned(v, digits, suffix)}</span>
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
    <div className="mb-8 rounded border border-neutral-800">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center px-3 py-2 text-sm font-medium text-neutral-300">
        Management Guidance research
        <span className="ml-auto text-xs text-neutral-500">{open ? "hide" : g.source_text ? "edit" : "add"}</span>
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
            className="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-neutral-500"
            rows={3}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Confidence (e.g. High / Medium / Low)"
              value={form.confidence}
              onChange={(e) => setForm((f) => ({ ...f, confidence: e.target.value }))}
              className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-neutral-500"
            />
            <input
              placeholder="As of (date)"
              value={form.as_of}
              onChange={(e) => setForm((f) => ({ ...f, as_of: e.target.value }))}
              className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-neutral-500"
            />
          </div>
          <input
            placeholder="Source URLs, comma-separated"
            value={form.source_urls}
            onChange={(e) => setForm((f) => ({ ...f, source_urls: e.target.value }))}
            className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-neutral-500"
          />
          <button onClick={save} disabled={saving} className="text-xs px-3 py-1.5 rounded bg-neutral-100 text-neutral-900 font-medium disabled:opacity-50">
            {saving ? "Saving…" : "Save guidance"}
          </button>
          <p className="text-[11px] text-neutral-500">Seeds Base/Bull/Bear Revenue Growth % for any case that hasn't been hand-edited yet.</p>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string | number; onChange: (v: string) => void }) {
  return (
    <label className="text-xs text-neutral-500">
      {label}
      <input type="number" step={0.5} value={value} onChange={(e) => onChange(e.target.value)} className="num-input mt-1 text-left" />
    </label>
  );
}
