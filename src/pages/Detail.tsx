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
  computeModel,
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
const FIELD_STEP: Record<string, number> = { revGrowth: 0.5, opm: 0.5, tax: 0.5, other_income: 1, interest: 1, depreciation: 1, shares: 0.01, pe: 0.5 };
const EDITABLE_FIELDS: (keyof Driver)[] = ["revGrowth", "opm", "tax", "other_income", "interest", "depreciation", "shares"];

export default function Detail() {
  const { ticker = "" } = useParams();
  const navigate = useNavigate();
  const { bundle, setBundle } = useData();
  const stock = bundle.stocks[ticker];
  const [tab, setTab] = useState<Case>("base");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const guidance = bundle.guidance[ticker] ?? null;
  const state = useMemo(
    () => (stock ? getCaseState(bundle.scenarios, stock, guidance, ticker, tab) : null),
    [stock, bundle.scenarios, guidance, ticker, tab]
  );

  const saveTimers = useRef<Record<string, any>>({});
  function scheduleSave(case_: Case, next: CaseState) {
    setBundle((b) => ({
      ...b,
      scenarios: { ...b.scenarios, [ticker]: { ...(b.scenarios[ticker] ?? {}), [case_]: next } },
    }));
    const key = `${ticker}:${case_}`;
    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => {
      api.saveScenario(ticker, case_, next).catch(() => {});
    }, 500);
  }

  if (!stock) {
    return (
      <div className="text-neutral-500">
        Company not found. <button className="underline" onClick={() => navigate("/companies")}>Add it</button>.
      </div>
    );
  }

  function updateDriver(yearIdx: number, field: keyof Driver, raw: string) {
    if (!state) return;
    const value = raw === "" ? null : parseFloat(raw);
    const drivers = state.drivers.map((d, i) => (i === yearIdx ? { ...d, [field]: value === null || Number.isNaN(value) ? null : value } : d));
    scheduleSave(tab, { ...state, drivers });
  }
  function updateAssumptions(text: string) {
    if (!state) return;
    scheduleSave(tab, { ...state, assumptions: text });
  }

  async function fullRefresh() {
    setBusy("full");
    setError("");
    try {
      const { stock: fresh } = await api.fetchCompany(ticker);
      setBundle((b) => ({ ...b, stocks: { ...b.stocks, [ticker]: fresh } }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Refresh failed");
    } finally {
      setBusy(null);
    }
  }
  async function priceRefresh() {
    setBusy("price");
    try {
      const { stock: fresh } = await api.refreshPrice(ticker);
      setBundle((b) => ({ ...b, stocks: { ...b.stocks, [ticker]: { ...b.stocks[ticker], ...fresh } } }));
    } finally {
      setBusy(null);
    }
  }
  async function toggleOwned() {
    const next = !stock.owned;
    setBundle((b) => ({ ...b, stocks: { ...b.stocks, [ticker]: { ...b.stocks[ticker], owned: next } } }));
    api.toggleOwned(ticker, next).catch(() => {});
  }

  const model = state ? computeModel(stock, state) : [];

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">{stock.name}</h1>
        <span className="text-neutral-500 text-sm">{ticker}</span>
        <button
          onClick={toggleOwned}
          className={`text-[10px] px-2 py-0.5 rounded border ${stock.owned ? "border-emerald-700 text-emerald-400" : "border-neutral-700 text-neutral-500"}`}
        >
          {stock.owned ? "Owned" : "Mark owned"}
        </button>
        <div className="ml-auto flex gap-2">
          <button onClick={priceRefresh} disabled={!!busy} className="text-xs px-2 py-1 rounded border border-neutral-700 hover:border-neutral-500 disabled:opacity-50">
            {busy === "price" ? "Refreshing…" : "Refresh price"}
          </button>
          <button onClick={fullRefresh} disabled={!!busy} className="text-xs px-2 py-1 rounded border border-neutral-700 hover:border-neutral-500 disabled:opacity-50">
            {busy === "full" ? "Refreshing…" : "Refresh full data"}
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-red-400 mb-2">{error}</p>}

      {/* stat strip */}
      <div className="flex flex-wrap gap-4 text-sm mb-4 py-3 border-y border-neutral-800">
        <Stat label="Price" value={`₹${fmt(stock.current_price)}`} />
        <Stat label="P/E" value={`${fmt(stock.pe_ratio, 1)}x`} />
        <Stat label="Mkt Cap" value={`₹${fmt(stock.market_cap_cr)} Cr`} />
        <Stat label="52W High" value={`₹${fmt(stock.week52_high)}`} />
        <Stat label="20D EMA" value={fmt(stock.ema20d)} />
        <Stat label="50D EMA" value={fmt(stock.ema50d)} />
        <Stat label="33W EMA" value={fmt(stock.ema33w)} />
      </div>

      {/* headline chips */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {(["base", "bull", "bear", "mgmt"] as Case[]).map((c) => {
          const st = getCaseState(bundle.scenarios, stock, guidance, ticker, c);
          const h = headlineCagr(stock, st);
          return (
            <button
              key={c}
              onClick={() => setTab(c)}
              className={`text-left rounded-lg border px-3 py-3 transition ${tab === c ? "border-neutral-400" : "border-neutral-800 hover:border-neutral-600"}`}
              style={{ borderLeftColor: CASE_COLOR[c], borderLeftWidth: 3 }}
            >
              <div className="text-xs text-neutral-400">{CASE_LABEL[c]}</div>
              {h && h.cagr !== null ? (
                <>
                  <div className={`text-lg font-semibold ${h.cagr >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtSigned(h.cagr, 1)}</div>
                  <div className="text-[11px] text-neutral-500">₹{fmt(h.sharePrice)} by Mar {h.year}</div>
                </>
              ) : (
                <div className="text-sm text-neutral-600 mt-1">fill PE to compute</div>
              )}
            </button>
          );
        })}
      </div>

      {/* projections grid */}
      {state && (
        <div className="mb-8">
          <h2 className="text-sm font-medium mb-2" style={{ color: CASE_COLOR[tab] }}>
            {CASE_LABEL[tab]} — Future Projections
          </h2>
          <div className="overflow-x-auto rounded border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-neutral-400 text-xs">
                <tr>
                  <th className="text-left px-3 py-2">Driver</th>
                  {Array.from({ length: N_EST_YEARS }, (_, i) => (
                    <th key={i} className="text-right px-3 py-2">{estYearLabel(stock, i)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {EDITABLE_FIELDS.map((field) => (
                  <tr key={field} className="border-t border-neutral-800">
                    <td className="px-3 py-1.5 text-neutral-400">{FIELD_LABEL[field]}</td>
                    {state.drivers.map((dr, i) => (
                      <td key={i} className="px-2 py-1.5">
                        <input
                          type="number"
                          step={FIELD_STEP[field]}
                          className="num-input"
                          value={dr[field] ?? ""}
                          onChange={(e) => updateDriver(i, field, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t border-neutral-800 bg-neutral-900/40">
                  <td className="px-3 py-1.5 font-medium">PE Multiple</td>
                  {state.drivers.map((dr, i) => (
                    <td key={i} className="px-2 py-1.5">
                      <input
                        type="number"
                        step={0.5}
                        className="num-input font-medium"
                        value={dr.pe ?? ""}
                        onChange={(e) => updateDriver(i, "pe", e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
                {(
                  [
                    ["Revenue", "revenue", 0],
                    ["Operating Profit", "operating_profit", 0],
                    ["PAT", "pat", 0],
                    ["PAT Growth %", "pat_growth", 1],
                    ["EPS", "eps", 1],
                    ["Forward PE", "forward_pe", 1],
                  ] as const
                ).map(([label, key, digits]) => (
                  <tr key={key} className="border-t border-neutral-800 text-neutral-300">
                    <td className="px-3 py-1.5 text-xs text-neutral-500">{label}</td>
                    {model.map((row, i) => (
                      <td key={i} className="px-3 py-1.5 text-right tabular-nums text-xs">
                        {fmt((row as any)[key], digits)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <textarea
            placeholder="Assumptions / notes for this case…"
            value={state.assumptions}
            onChange={(e) => updateAssumptions(e.target.value)}
            className="mt-2 w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-xs text-neutral-300 focus:outline-none focus:border-neutral-500"
            rows={3}
          />
        </div>
      )}

      <GuidancePanel ticker={ticker} />
      <AnnualTable stock={stock} />
      {stock.quarters && stock.quarters.length > 0 && <QuarterlyTable stock={stock} />}
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
        Management Guidance
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
          <p className="text-[11px] text-neutral-500">Saving overwrites Base/Bull/Bear Revenue Growth % seeds for cases that haven't been hand-edited yet.</p>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string | number; onChange: (v: string) => void }) {
  return (
    <label className="text-xs text-neutral-500">
      {label}
      <input
        type="number"
        step={0.5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="num-input mt-1 text-left"
      />
    </label>
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

const ANNUAL_ROWS: [string, string, number, string][] = [
  ["Revenue", "revenue", 0, ""],
  ["Revenue Growth %", "revenue_growth_pct", 1, "%"],
  ["Operating Profit", "operating_profit", 0, ""],
  ["OPM %", "opm_pct", 1, "%"],
  ["Net Profit", "net_profit", 0, ""],
  ["PAT Growth %", "pat_growth_pct", 1, "%"],
  ["EPS", "eps", 1, ""],
];

function AnnualTable({ stock }: { stock: any }) {
  return (
    <div className="mb-8">
      <h2 className="text-sm font-medium mb-2 text-neutral-300">Annual Results</h2>
      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-neutral-400 text-xs">
            <tr>
              <th className="text-left px-3 py-2">Metric</th>
              {stock.years.map((y: string) => (
                <th key={y} className="text-right px-3 py-2">{y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ANNUAL_ROWS.map(([label, key, digits, suffix]) => (
              <tr key={key} className="border-t border-neutral-800">
                <td className="px-3 py-1.5 text-neutral-400">{label}</td>
                {stock[key].map((v: number | null, i: number) => (
                  <td key={i} className="px-3 py-1.5 text-right tabular-nums">
                    {suffix ? fmtSigned(v, digits, suffix) : fmt(v, digits)}
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

const QUARTER_ROWS: [string, string, number, string][] = [
  ["Revenue", "q_revenue", 0, ""],
  ["Revenue Growth % (YoY)", "q_revenue_growth_pct", 1, "%"],
  ["Operating Profit", "q_operating_profit", 0, ""],
  ["OPM %", "q_opm_pct", 1, "%"],
  ["Net Profit", "q_net_profit", 0, ""],
  ["PAT Growth % (YoY)", "q_pat_growth_pct", 1, "%"],
  ["EPS", "q_eps", 1, ""],
];

function QuarterlyTable({ stock }: { stock: any }) {
  return (
    <div className="mb-8">
      <h2 className="text-sm font-medium mb-2 text-neutral-300">Quarterly Results</h2>
      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-neutral-400 text-xs">
            <tr>
              <th className="text-left px-3 py-2">Metric</th>
              {stock.quarters.map((q: string) => (
                <th key={q} className="text-right px-3 py-2">{fiscalQuarterLabel(q)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {QUARTER_ROWS.map(([label, key, digits, suffix]) => (
              <tr key={key} className="border-t border-neutral-800">
                <td className="px-3 py-1.5 text-neutral-400">{label}</td>
                {(stock[key] ?? []).map((v: number | null, i: number) => (
                  <td key={i} className="px-3 py-1.5 text-right tabular-nums">
                    {suffix ? fmtSigned(v, digits, suffix) : fmt(v, digits)}
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
