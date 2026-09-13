import { useState } from "react";
import { fmt, fmtSigned } from "../lib/model";
import { MethodologyNote } from "../components/ScreenerTable";
import { computeMtfRow, computeMtfTotals, defaultInstrument, DEFAULT_ASSUMPTIONS, DEFAULT_DAYS, MtfAssumptions, MtfInstrument } from "../lib/mtf";

// MTF Calculator — added 2026-09-13, "can we build this as a new page"
// after reviewing the user's own MTF-Gold/MTF-Silver Google Sheet, and
// reworked several times through the same session:
// - "also on MTF use the actual zerodha trade
//   https://zerodha.com/calculators/mtf-calculator/" — swapped
//   Interest/Charges/Leverage to Zerodha's own documented formulas
//   (see src/lib/mtf.ts's module comment for the full trace + the
//   GOLDCASE example used to verify it).
// - "use similar ui as zerodha page as a playtool and let table
//   reflect below that show as we earlier built" — this page's top
//   section per instrument is now a close visual replica of Zerodha's
//   own MTF calculator (search-style header, 3 sliders: Invested
//   amount / No. of days held / Expected rate of return, a 4-metric
//   result row, and the two-tone investment-split bar) — driving the
//   SAME instrument the day-bucket table below still shows in full
//   (this app's own addition on top of Zerodha's page, which only
//   ever shows one day count at a time).
// - "I guess only tax is not part of zerodha, lets add it" — Zerodha's
//   own calculator doesn't model capital gains tax at all; added as a
//   4th metric card (Interest / Charges / Tax / Profit & Loss) so the
//   replica is complete, with Profit & Loss net of all three (this
//   app's own choice, confirmed earlier: "logic for final profit and
//   loss go with earlier logic").

function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  prefix,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-slate-600">{label}</span>
        <div className="flex items-center gap-1 px-2 py-1 border border-slate-300 rounded">
          {prefix && <span className="text-slate-400 text-sm">{prefix}</span>}
          <input
            type="number"
            value={Number.isFinite(value) ? value : ""}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="w-24 text-sm text-right tabular-nums outline-none"
          />
          {suffix && <span className="text-slate-400 text-sm">{suffix}</span>}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : min}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-indigo-600"
      />
    </div>
  );
}

function NumberField({ label, value, onChange, suffix, title }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; title?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600" title={title}>
      <span>{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          step="any"
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm tabular-nums"
        />
        {suffix && <span className="text-slate-400 text-xs">{suffix}</span>}
      </div>
    </label>
  );
}

function MetricCard({ label, caption, value, sub, tone, title }: { label: string; caption?: string; value: string; sub?: string; tone?: "profit" | "loss"; title?: string }) {
  return (
    <div title={title} className={title ? "cursor-help" : undefined}>
      <div className="text-xs text-slate-500">
        {label} {caption && <span className="text-slate-400">({caption})</span>}
      </div>
      <div className={`text-lg font-semibold tabular-nums ${tone === "profit" ? "text-emerald-600" : tone === "loss" ? "text-red-600" : "text-slate-800"}`}>
        {value} {sub && <span className="text-sm font-medium">{sub}</span>}
      </div>
    </div>
  );
}

function InstrumentCard({
  inst,
  onChange,
  onRemove,
  removable,
  assumptions,
  dayBuckets,
}: {
  inst: MtfInstrument;
  onChange: (i: MtfInstrument) => void;
  onRemove: () => void;
  removable: boolean;
  assumptions: MtfAssumptions;
  dayBuckets: number[];
}) {
  const { totalInv, funded, leverageX, chargesBreakdown } = computeMtfTotals(inst);
  const live = computeMtfRow(inst, assumptions, inst.days);
  const rows = dayBuckets.map((d) => computeMtfRow(inst, assumptions, d));
  const investedPct = totalInv > 0 ? (inst.investedAmount / totalInv) * 100 : 0;
  const fundedPct = 100 - investedPct;
  const isLtcg = inst.days > assumptions.ltcgThresholdDays;

  // 2026-09-13 ("remove the charges as input tab, it must via rules not
  // a user input" then "give a breakdown with percentages of charges on
  // mouse over") — Charges is no longer editable (derived fresh from
  // computeZerodhaChargesBreakdown every render); this formats that
  // breakdown as a native-tooltip string (each component's ₹ and % of
  // the total) for the "Brokerage + Charges" metric card below.
  function chargesTooltip(b: typeof chargesBreakdown): string {
    const pct = (v: number) => (b.total > 0 ? (v / b.total) * 100 : 0);
    return [
      `Brokerage: ₹${fmt(b.brokerage, 2)} (${fmt(pct(b.brokerage), 1)}%)`,
      `STT: ₹${fmt(b.stt, 2)} (${fmt(pct(b.stt), 1)}%)`,
      `Stamp duty: ₹${fmt(b.stampDuty, 2)} (${fmt(pct(b.stampDuty), 1)}%)`,
      `Pledge/unpledge: ₹${fmt(b.pledgeUnpledge, 2)} (${fmt(pct(b.pledgeUnpledge), 1)}%)`,
      `Total: ₹${fmt(b.total, 2)}`,
    ].join("\n");
  }

  return (
    <div className="p-4 border border-slate-200 rounded-lg mb-6">
      {/* Search-style header — Zerodha's own page leads with a stock
          search box showing that stock's live Leverage. No live
          lookup here (Zerodha's own margin data isn't fetchable
          headlessly), so this is a plain name field with a Leverage
          readout computed from the Margin% input below. */}
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
        <span className="text-slate-400">🔍</span>
        <input type="text" value={inst.name} onChange={(e) => onChange({ ...inst, name: e.target.value })} className="text-sm font-semibold px-2 py-1.5 border border-slate-300 rounded flex-1 max-w-[240px]" />
        <span className="text-xs text-slate-500 ml-auto">
          Leverage: <b className="text-slate-700">{leverageX !== null ? `${fmt(leverageX, 2)}x` : "—"}</b>
        </span>
        {removable && (
          <button onClick={onRemove} className="text-xs text-red-500 hover:underline">
            ✕ Remove
          </button>
        )}
      </div>

      {/* Secondary inputs Zerodha derives live per-stock (Margin%,
          Leverage) or states as a flat platform rate (Daily Interest)
          — manual/editable here. Charges is NOT here — it's derived
          purely from Zerodha's own formula (rule-based, not a user
          input); see the "Brokerage + Charges" metric card below,
          hover it for the itemized breakdown. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <NumberField
          label="Margin %"
          value={inst.marginPct}
          onChange={(v) => onChange({ ...inst, marginPct: v })}
          suffix="%"
          title="Broker's MTF margin requirement for this instrument. Zerodha looks this up live per stock (e.g. GOLDCASE 28%, RELIANCE ~22.6%) — not fetchable headlessly here, so it's a manual input."
        />
        <NumberField
          label="Daily Interest Rate"
          value={inst.dailyRatePct}
          onChange={(v) => onChange({ ...inst, dailyRatePct: v })}
          suffix="%/day"
          title="Zerodha's real MTF rate is a flat 0.04%/day (₹40 per lakh funded), charged from T+1 until sold — not annualized"
        />
        <label
          className="flex flex-col gap-1 text-xs text-slate-600"
          title="Gold/silver (and other non-'listed security' assets) aren't taxed at the flat STCG rate — short-term gains follow your own income slab instead, and surcharge+cess stack on top of the resulting tax. Uncheck for equity/ETF instruments."
        >
          <span>Slab-rate tax</span>
          <span className="flex items-center gap-1.5 px-2 py-1.5 border border-slate-300 rounded">
            <input type="checkbox" checked={inst.slabRateTax} onChange={(e) => onChange({ ...inst, slabRateTax: e.target.checked })} className="accent-indigo-600" />
            <span className="text-xs text-slate-500">{inst.slabRateTax ? "Gold/Silver rule" : "Equity STCG/LTCG"}</span>
          </span>
        </label>
      </div>

      {/* Zerodha's own 3 sliders */}
      <SliderField label="Invested amount" value={inst.investedAmount} onChange={(v) => onChange({ ...inst, investedAmount: v })} min={5000} max={5000000} step={5000} prefix="₹" />
      <SliderField label="No. of days held" value={inst.days} onChange={(v) => onChange({ ...inst, days: v })} min={1} max={730} step={1} suffix=" days" />
      <SliderField label="Expected rate of return" value={inst.expPlPct} onChange={(v) => onChange({ ...inst, expPlPct: v })} min={-50} max={150} step={1} suffix="%" />

      {/* Live result — 4 metrics (Zerodha's own 3, plus Tax, their one
          gap: "I guess only tax is not part of zerodha, lets add
          it") — all reflect inst.days, the slider above. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-50 rounded-lg p-4 mt-1">
        <MetricCard label="Applicable interest" caption={`${inst.dailyRatePct}% per day`} value={`₹${fmt(live.intPaid, 0)}`} />
        <MetricCard label="Brokerage + Charges" value={`₹${fmt(live.charges, 0)}`} title={chargesTooltip(chargesBreakdown)} />
        <MetricCard
          label="Tax"
          caption={`${fmt(live.taxRatePct, 2)}% ${isLtcg ? "LTCG" : inst.slabRateTax ? "slab" : "STCG"}${inst.slabRateTax ? " +surcharge/cess" : ""}`}
          value={`₹${fmt(live.tax, 0)}`}
        />
        <MetricCard
          label="Profit & Loss"
          value={`₹${fmt(live.finalProfit, 0)}`}
          sub={`${live.finalProfit >= 0 ? "▲" : "▼"} ${live.patLevPct !== null ? fmt(Math.abs(live.patLevPct), 2, "%") : "—"}`}
          tone={live.finalProfit >= 0 ? "profit" : "loss"}
        />
      </div>

      {/* Investment split — Zerodha's own two-tone bar */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 mt-4 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" /> Your investment <b className="tabular-nums">₹{fmt(inst.investedAmount, 0)}</b>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Funded (MTF) <b className="tabular-nums">₹{fmt(funded, 0)}</b>
        </span>
        <span className="ml-auto text-slate-500">
          Total buy value <b className="text-slate-800 tabular-nums">₹{fmt(totalInv, 0)}</b>
        </span>
      </div>
      <div className="flex h-6 rounded overflow-hidden mt-2 text-[11px] text-white font-medium">
        <div className="bg-orange-500 flex items-center justify-center" style={{ width: `${investedPct}%` }}>
          {investedPct >= 8 ? `${fmt(investedPct, 0)}%` : ""}
        </div>
        <div className="bg-blue-500 flex items-center justify-center" style={{ width: `${fundedPct}%` }}>
          {fundedPct >= 8 ? `${fmt(fundedPct, 0)}%` : ""}
        </div>
      </div>

      {/* The day-bucket table — this app's own addition on top of
          Zerodha's page (which only ever shows one day count at a
          time); "let table reflect below that show as we earlier
          built" — same instrument, every day bucket from the shared
          list above, at once. */}
      <div className="overflow-x-auto mt-6">
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
              <tr key={r.days} className={`border-t border-slate-100 ${r.days === inst.days ? "bg-indigo-50/60" : r.days > assumptions.ltcgThresholdDays ? "bg-emerald-50/40" : ""}`}>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.days}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.pl, 0)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                  {fmt(r.tax, 0)} <span className="text-slate-400">({fmt(r.taxRatePct, 2)}%)</span>
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
      <div className="text-[11px] text-slate-400 mt-2">
        Highlighted row = the "No. of days held" slider above ({inst.days}d); shaded rows past {assumptions.ltcgThresholdDays}d are taxed at LTCG instead of STCG.
      </div>
    </div>
  );
}

export default function MTFCalculator() {
  // 2026-09-13 ("leverage is 3.57 for GOLDCASE, and 2.7 for SILVERCASE")
  // — real Zerodha-quoted leverage for these two instruments, converted
  // to Margin% (= 100/leverage) as this model's own input.
  const [instruments, setInstruments] = useState<MtfInstrument[]>([defaultInstrument("Gold", true, 28.01), defaultInstrument("Silver", true, 37.04)]);
  const [assumptions, setAssumptions] = useState<MtfAssumptions>(DEFAULT_ASSUMPTIONS);
  const [dayBuckets, setDayBuckets] = useState<number[]>(DEFAULT_DAYS);
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
    if (!Number.isFinite(d) || d <= 0 || dayBuckets.includes(d)) return;
    setDayBuckets((prev) => [...prev, d].sort((a, b) => a - b));
    setNewDay("");
  }
  function removeDay(d: number) {
    setDayBuckets((prev) => prev.filter((x) => x !== d));
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">📐 MTF Calculator</h1>
        <span className="text-slate-500 text-sm">What margin-funded leverage actually costs you vs. paying cash</span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        A close replica of{" "}
        <a href="https://zerodha.com/calculators/mtf-calculator/" target="_blank" rel="noreferrer" className="underline">
          Zerodha's own MTF calculator
        </a>{" "}
        — plus Tax (the one thing theirs doesn't model) and a full day-bucket table below each instrument.
      </p>

      <MethodologyNote>
        Each instrument card's sliders (<b>Invested amount</b>, <b>No. of days held</b>, <b>Expected rate of return</b>) and result row
        (<b>Applicable interest</b>, <b>Brokerage + Charges</b>, <b>Profit & Loss</b>) replicate{" "}
        <a href="https://zerodha.com/calculators/mtf-calculator/" target="_blank" rel="noreferrer" className="underline">
          Zerodha's own MTF calculator
        </a>{" "}
        layout and formulas (2026-09-13, "use the actual zerodha trade" / "use similar ui as zerodha page as a playtool") — verified live
        against the user's own GOLDCASE example (₹10,00,000 invested, 28% margin, 180 days, 50% expected): <b>Applicable interest</b> ties out
        exactly to Zerodha's own ₹1,85,040 (Funded × 0.04%/day × days, simple interest, compounding ignored); <b>Brokerage + Charges</b>{" "}
        (brokerage 0.3% or ₹20/order — whichever's LOWER — both legs, STT 0.1% delivery both legs, stamp duty 0.015% buy leg, pledge/unpledge
        ₹15+18% GST each way) lands ~3% under Zerodha's own ₹9,831.02 for the same trade (smaller statutory items — exchange transaction
        charges, SEBI fees, GST on brokerage — aren't modeled). Charges is <b>not a user input</b> (2026-09-13, "it must via rules not a user
        input") — it's recomputed fresh from this formula every time the sliders change; hover the metric card for the itemized ₹/%
        breakdown (2026-09-13, "give a breakdown with percentages of charges on mouse over").{" "}
        <b>Tax</b> is the one metric Zerodha's own calculator doesn't have at all — added here (2026-09-13, "I guess only tax is not part of
        zerodha, lets add it"): STCG below {assumptions.ltcgThresholdDays} days held, LTCG above it, floored at zero (a loss doesn't generate a
        tax credit). <b>Slab-rate tax</b> (checked by default for Gold/Silver, 2026-09-13 "for gold and silver STCG is slab rate ... include
        the surcharge, cess") — gold/silver aren't "listed securities" under STT/section 111A, so their short-term gains are taxed at{" "}
        <b>your own income slab rate</b> instead of the flat equity STCG% (LTCG stays the same flat 12.5%, uniform across asset classes since
        the 2024 budget), and <b>Surcharge</b> + <b>Cess</b> then stack on whatever tax results, on both legs — exactly like real Indian
        capital-gains tax. Set your own <b>Income slab rate</b> and <b>Surcharge</b> bracket in Shared assumptions (this app has no notion of
        your actual income, so these are manual); <b>Cess</b> defaults to the standard flat 4%. Uncheck "Slab-rate tax" on any instrument to
        use the plain equity STCG%/LTCG% instead (no surcharge/cess) — unaffected, same as before. <b>Profit & Loss</b> = P/L − Tax − Charges
        − Interest, and its % = Profit & Loss ÷ (Invested + Interest) — this differs
        from Zerodha's own displayed %, which divides by Invested alone; kept as the interest-adjusted version per this session's earlier,
        explicit decision. <b>Margin%</b>/<b>Leverage</b> stays a manual input — Zerodha looks this up live, per stock (e.g. GOLDCASE 28%/
        3.57x, RELIANCE ~22.6%/4.42x), which this app can't fetch headlessly. Below each card's live result: the same instrument run across
        every day bucket in the shared list below at once (highlighted row = the slider's current day count) — Zerodha's own page only ever
        shows one day count at a time.
      </MethodologyNote>

      <div className="p-4 border border-slate-200 rounded-lg mb-6">
        <h2 className="text-sm font-medium text-slate-700 mb-3">Shared assumptions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <NumberField label="STCG rate (equity)" value={assumptions.stcgPct} onChange={(v) => setAssumptions((a) => ({ ...a, stcgPct: v }))} suffix="%" title="Used for instruments with 'Slab-rate tax' unchecked" />
          <NumberField label="LTCG rate" value={assumptions.ltcgPct} onChange={(v) => setAssumptions((a) => ({ ...a, ltcgPct: v }))} suffix="%" title="Flat, uniform across asset classes since the 2024 budget — used for every instrument once held past the threshold" />
          <NumberField
            label="LTCG threshold"
            value={assumptions.ltcgThresholdDays}
            onChange={(v) => setAssumptions((a) => ({ ...a, ltcgThresholdDays: v }))}
            suffix="days"
            title="365 for listed equity/ETFs under current rules — edit if this instrument is taxed differently"
          />
        </div>
        {/* 2026-09-13 ("for gold and silver STCG is slab rate ... include
            the surcharge, cess as per indian rules") — gold/silver aren't
            "listed securities" (no STT/111A), so their short-term gains
            follow the investor's own income slab rather than the flat
            STCG% above; surcharge/cess then stack on top of WHATEVER tax
            results (slab-STCG or flat-LTCG). Applies only to instruments
            with "Slab-rate tax" checked below (Gold/Silver by default). */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4 pt-3 border-t border-slate-100">
          <NumberField
            label="Income slab rate"
            value={assumptions.slabRatePct}
            onChange={(v) => setAssumptions((a) => ({ ...a, slabRatePct: v }))}
            suffix="%"
            title="Your own marginal income-tax slab rate — used instead of the flat STCG rate for gold/silver (and any other 'Slab-rate tax' instrument). This app has no notion of your actual income, so set this to your real slab."
          />
          <NumberField
            label="Surcharge"
            value={assumptions.surchargePct}
            onChange={(v) => setAssumptions((a) => ({ ...a, surchargePct: v }))}
            suffix="%"
            title="Based on TOTAL income, not just this gain: 0% below ₹50L, 10% (₹50L–1Cr), 15% (1Cr–2Cr), 25% (2Cr–5Cr, new-regime cap). Set to match your own bracket."
          />
          <NumberField label="Cess" value={assumptions.cessPct} onChange={(v) => setAssumptions((a) => ({ ...a, cessPct: v }))} suffix="%" title="Health & Education Cess — a flat 4% on (tax + surcharge), same across every slab/regime" />
        </div>
        <div className="text-xs text-slate-500 mb-2">Day buckets shown in every table below — edit freely:</div>
        <div className="flex flex-wrap items-center gap-2">
          {dayBuckets.map((d) => (
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
          dayBuckets={dayBuckets}
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
