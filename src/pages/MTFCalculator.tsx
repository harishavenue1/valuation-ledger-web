import { useState } from "react";
import { fmt, fmtSigned } from "../lib/model";
import { MethodologyNote } from "../components/ScreenerTable";
import { computeMtfRow, computeMtfTotals, computeZerodhaCharges, defaultInstrument, DEFAULT_ASSUMPTIONS, DEFAULT_DAYS, MtfAssumptions, MtfInstrument } from "../lib/mtf";

// MTF Calculator — added 2026-09-13, "can we build this as a new page"
// after reviewing the user's own MTF-Gold/MTF-Silver Google Sheet. See
// src/lib/mtf.ts's module comment for the full formula trace and the
// two corrections made vs. the original sheet (both confirmed with
// the user). Layout generalizes the sheet's two hardcoded blocks
// (Gold/Silver) into any number of named instrument cards sharing one
// global STCG/LTCG/day-bucket assumption set — add/remove cards freely
// instead of the sheet being locked to exactly two.

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

function InstrumentCard({
  inst,
  onChange,
  onRemove,
  removable,
  assumptions,
  days,
}: {
  inst: MtfInstrument;
  onChange: (i: MtfInstrument) => void;
  onRemove: () => void;
  removable: boolean;
  assumptions: MtfAssumptions;
  days: number[];
}) {
  const { totalInv, invested, funded, dayCharge, curPrice, sellValue, leverageX } = computeMtfTotals(inst);
  const rows = days.map((d) => computeMtfRow(inst, assumptions, d));

  function recalcZerodhaCharges() {
    onChange({ ...inst, charges: computeZerodhaCharges(totalInv, sellValue) });
  }

  return (
    <div className="p-4 border border-slate-200 rounded-lg mb-6">
      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          value={inst.name}
          onChange={(e) => onChange({ ...inst, name: e.target.value })}
          className="text-sm font-semibold px-2 py-1 border border-slate-300 rounded"
        />
        {removable && (
          <button onClick={onRemove} className="ml-auto text-xs text-red-500 hover:underline">
            ✕ Remove
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-1">
        <NumberField label="Shares #" value={inst.shares} onChange={(v) => onChange({ ...inst, shares: v })} />
        <NumberField label="Buy Price" value={inst.buyPrice} onChange={(v) => onChange({ ...inst, buyPrice: v })} />
        <div className="flex flex-col gap-1">
          <NumberField
            label="Margin %"
            value={inst.marginPct}
            onChange={(v) => onChange({ ...inst, marginPct: v })}
            suffix="%"
            title="Broker's MTF margin requirement for this instrument — the % of Total Inv you must fund yourself. Zerodha looks this up live per stock (e.g. GOLDCASE 28%, RELIANCE ~22.6%) — not fetchable headlessly here, so it's a manual input."
          />
          <span className="text-[11px] text-slate-400" title="Zerodha's own framing: Margin% and Leverage are the same number, just inverted">
            = {leverageX !== null ? `${fmt(leverageX, 2)}x leverage` : "—"}
          </span>
        </div>
        <NumberField
          label="Daily Interest Rate"
          value={inst.dailyRatePct}
          onChange={(v) => onChange({ ...inst, dailyRatePct: v })}
          suffix="% /day"
          title="Zerodha's real MTF rate is a flat 0.04%/day (₹40 per lakh funded), charged from T+1 until sold — not annualized"
        />
        <NumberField label="Expected P/L" value={inst.expPlPct} onChange={(v) => onChange({ ...inst, expPlPct: v })} suffix="%" title="Expected price move by the time of sale — drives Current Price below" />
        <div className="flex flex-col gap-1">
          <NumberField
            label="Charges"
            value={inst.charges}
            onChange={(v) => onChange({ ...inst, charges: v })}
            suffix="₹"
            title="Brokerage + STT + stamp duty + pledge/unpledge, applied in both the leveraged and unleveraged scenarios"
          />
          <button onClick={recalcZerodhaCharges} className="text-[11px] text-indigo-600 underline text-left" title="Recompute from Zerodha's own documented formula for this trade's current size">
            ↺ Zerodha's formula
          </button>
        </div>
      </div>
      <div className="text-[11px] text-slate-400 mb-4">
        Interest and Charges follow{" "}
        <a href="https://zerodha.com/calculators/mtf-calculator/" target="_blank" rel="noreferrer" className="underline">
          Zerodha's own MTF calculator
        </a>{" "}
        — Margin%/Leverage stays a manual input (Zerodha looks it up live, per stock).
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4 text-sm border-t border-slate-100 pt-3">
        <div>
          <div className="text-xs text-slate-500">Total Inv</div>
          <div className="tabular-nums font-medium">₹{fmt(totalInv, 0)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Invested (self)</div>
          <div className="tabular-nums font-medium">₹{fmt(invested, 0)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Funded (MTF)</div>
          <div className="tabular-nums font-medium">₹{fmt(funded, 0)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Day Charge</div>
          <div className="tabular-nums font-medium">₹{fmt(dayCharge, 0)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Current Price</div>
          <div className="tabular-nums font-medium">{fmt(curPrice, 2)}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="text-sm border-collapse w-full" style={{ minWidth: 900 }}>
          <thead className="text-slate-500 text-xs">
            <tr>
              <th className="text-right px-2 py-1.5">Days</th>
              <th className="text-right px-2 py-1.5">P/L</th>
              <th className="text-right px-2 py-1.5">Tax</th>
              <th className="text-right px-2 py-1.5">Charges</th>
              <th className="text-right px-2 py-1.5">Int Paid</th>
              <th className="text-right px-2 py-1.5">Final Profit</th>
              <th className="text-right px-2 py-1.5">Final Profit (No Lev.)</th>
              <th className="text-right px-2 py-1.5">Leverage Edge</th>
              <th className="text-right px-2 py-1.5">PAT (Lev) %</th>
              <th className="text-right px-2 py-1.5">PAT (No Lev) %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.days} className={`border-t border-slate-100 ${r.days > assumptions.ltcgThresholdDays ? "bg-emerald-50/40" : ""}`}>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.days}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.pl, 0)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                  {fmt(r.tax, 0)} <span className="text-slate-400">({r.taxRatePct}%)</span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{fmt(r.charges, 0)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{fmt(r.intPaid, 0)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(r.finalProfit, 0)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.finalProfitWoLev, 0)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  <span className={r.leverageEdge >= 0 ? "text-emerald-600" : "text-red-600"}>{fmt(r.leverageEdge, 0)}</span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{r.patLevPct !== null ? fmtSigned(r.patLevPct, 2) : "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{r.patWoLevPct !== null ? fmtSigned(r.patWoLevPct, 2) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-slate-400 mt-2">Shaded rows are past the LTCG threshold ({assumptions.ltcgThresholdDays} days) — taxed at LTCG instead of STCG.</div>
    </div>
  );
}

export default function MTFCalculator() {
  const [instruments, setInstruments] = useState<MtfInstrument[]>([defaultInstrument("Gold"), defaultInstrument("Silver")]);
  const [assumptions, setAssumptions] = useState<MtfAssumptions>(DEFAULT_ASSUMPTIONS);
  const [days, setDays] = useState<number[]>(DEFAULT_DAYS);
  const [newDay, setNewDay] = useState("");

  function updateInstrument(idx: number, next: MtfInstrument) {
    setInstruments((prev) => prev.map((it, i) => (i === idx ? next : it)));
  }
  function removeInstrument(idx: number) {
    setInstruments((prev) => prev.filter((_, i) => i !== idx));
  }
  function addInstrument() {
    setInstruments((prev) => [...prev, defaultInstrument(`Instrument ${prev.length + 1}`)]);
  }
  function addDay() {
    const d = parseInt(newDay, 10);
    if (!Number.isFinite(d) || d <= 0 || days.includes(d)) return;
    setDays((prev) => [...prev, d].sort((a, b) => a - b));
    setNewDay("");
  }
  function removeDay(d: number) {
    setDays((prev) => prev.filter((x) => x !== d));
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">📐 MTF Calculator</h1>
        <span className="text-slate-500 text-sm">What margin-funded leverage actually costs you vs. paying cash</span>
      </div>
      <p className="text-xs text-slate-500 mb-4">Ported from your own MTF-Gold/MTF-Silver sheet — add/remove instruments and day buckets freely below.</p>

      <MethodologyNote>
        Each instrument card is independent: <b>Total Inv</b> = Shares × Buy Price; <b>Invested</b> = Total Inv × Margin%; <b>Funded</b> = the
        rest, borrowed via MTF. <b>Current Price</b> is derived from Buy Price × (1 + Expected P/L%), so the P/L column always ties out exactly
        to (Current − Buy) × Shares.{" "}
        <b>
          Interest and Charges are matched to{" "}
          <a href="https://zerodha.com/calculators/mtf-calculator/" target="_blank" rel="noreferrer" className="underline">
            Zerodha's own real MTF calculator
          </a>
        </b>{" "}
        (2026-09-13, "use the actual zerodha trade") — <b>Daily Interest Rate</b> defaults to their flat 0.04%/day on Funded (₹40 per lakh,
        simple interest, compounding ignored), and <b>Charges</b> defaults to their documented formula (brokerage 0.3% or ₹20/order —
        whichever's LOWER — both legs, STT 0.1% delivery both legs, stamp duty 0.015% on the buy leg, pledge/unpledge ₹15+18% GST each way);
        verified live against the user's own GOLDCASE example (₹10,00,000 invested, 28% margin, 180 days, 50% expected) — Interest ties out
        exactly to Zerodha's ₹1,85,040, Charges lands ~3% under Zerodha's own ₹9,831.02 (smaller statutory items — exchange transaction
        charges, SEBI fees, GST on brokerage — aren't modeled; click "↺ Zerodha's formula" to reseed Charges after changing Shares/Buy
        Price/Expected P/L). <b>Margin%</b>/<b>Leverage</b> stays a manual input — Zerodha looks this up live, per stock (e.g. GOLDCASE 28%/
        3.57x, RELIANCE ~22.6%/4.42x), which this app can't fetch headlessly. Tax uses STCG below {assumptions.ltcgThresholdDays} days held,
        LTCG above it (shaded rows), floored at zero — a loss doesn't generate a tax credit here; note Zerodha's own calculator doesn't model
        tax at all, this is this app's own addition on top. <b>Final Profit</b> = P/L − Tax − Charges − Interest Paid.{" "}
        <b>Final Profit (No Lev.)</b> is the same trade sized to only your own Invested capital, paid in cash (no interest, but the same
        Charges and tax treatment) — the honest baseline to compare leverage against. <b>Leverage Edge</b> is the rupee difference between the
        two. <b>PAT (Lev)%</b> = Final Profit ÷ (Invested + Interest Paid) — capital actually put at risk, excluding tax from the base (unlike
        naively dividing by total cash including tax, this doesn't mechanically shrink the return% the longer you hold for reasons unrelated
        to the trade; note this differs from Zerodha's own displayed %, which divides by Invested alone — kept as-is per this session's
        earlier decision). <b>PAT (No Lev)%</b> = Final Profit (No Lev.) ÷ Invested.
      </MethodologyNote>

      <div className="p-4 border border-slate-200 rounded-lg mb-6">
        <h2 className="text-sm font-medium text-slate-700 mb-3">Shared assumptions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <NumberField label="STCG rate" value={assumptions.stcgPct} onChange={(v) => setAssumptions((a) => ({ ...a, stcgPct: v }))} suffix="%" />
          <NumberField label="LTCG rate" value={assumptions.ltcgPct} onChange={(v) => setAssumptions((a) => ({ ...a, ltcgPct: v }))} suffix="%" />
          <NumberField
            label="LTCG threshold"
            value={assumptions.ltcgThresholdDays}
            onChange={(v) => setAssumptions((a) => ({ ...a, ltcgThresholdDays: v }))}
            suffix="days"
            title="365 for listed equity/ETFs under current rules — edit if this instrument is taxed differently"
          />
        </div>
        <div className="text-xs text-slate-500 mb-2">
          Day buckets shown in every table below — edit freely:
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {days.map((d) => (
            <span key={d} className="inline-flex items-center gap-1 text-xs bg-slate-100 rounded-full px-2 py-1">
              {d}d
              <button onClick={() => removeDay(d)} className="text-slate-400 hover:text-red-500">
                ✕
              </button>
            </span>
          ))}
          <input
            type="number"
            value={newDay}
            onChange={(e) => setNewDay(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addDay()}
            placeholder="+ days"
            className="w-20 px-2 py-1 border border-slate-300 rounded text-xs"
          />
          <button onClick={addDay} className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400">
            Add
          </button>
        </div>
      </div>

      {instruments.map((inst, idx) => (
        <InstrumentCard
          key={idx}
          inst={inst}
          onChange={(next) => updateInstrument(idx, next)}
          onRemove={() => removeInstrument(idx)}
          removable={instruments.length > 1}
          assumptions={assumptions}
          days={days}
        />
      ))}

      <button onClick={addInstrument} className="text-xs px-3 py-1.5 rounded border border-slate-300 hover:border-slate-400">
        + Add instrument
      </button>

      <p className="text-xs text-slate-400 mt-6 text-center">
        Not investment advice — a simplified simple-interest model for comparing MTF leverage cost against paying cash for the same trade.
      </p>
    </div>
  );
}
