import { useEffect, useMemo, useState } from "react";
import { fmt } from "../lib/model";

// MTF fall scenarios — added 2026-10-23 ("give above table in our MTF page
// of our app to calculate my self... allow editable for current price and
// rows upto 50% drop"). Replicates the by-hand table built in chat for the
// user's SILVERCASE/GOLDCASE MTF positions: for each 1% fall from the
// current price, the loss on the MTF units, that loss as a % of the funded
// amount, and what Zerodha's published RMS rules would do about it
// (https://support.zerodha.com/category/trading-and-markets/margins/
// margin-trading-facility/articles/rms-policy-on-mtf):
// - loss > 20% of funded: positions may be squared off to recover a DEBIT
//   balance — so while cash stays positive this is a top-up/notice (8 AM
//   notice, ~11 AM deadline), not an automatic sale;
// - loss >= 80% of funded: automatic square-off even with enough balance;
// - loss > 90% of funded and unsellable: position converted to CNC.
// "Top-up needed" = the loss beyond the 20% line (what a margin call would
// ask for); "Cash left" = available cash minus that top-up. All inputs are
// editable and remembered in localStorage (per-viewer convenience only).

type Inputs = {
  name: string;
  units: number;
  avgCost: number;
  fundedPerUnit: number;
  price: number;
  cash: number;
  callPct: number;
  stopPct: number;
  maxFall: number;
};

const PRESETS: Record<string, Inputs> = {
  Silver: { name: "SILVERCASE", units: 114000, avgCost: 21.9076, fundedPerUnit: 13.9, price: 19.44, cash: 339000, callPct: 20, stopPct: 80, maxFall: 50 },
  Gold: { name: "GOLDCASE", units: 168000, avgCost: 23.2468, fundedPerUnit: 16.77, price: 22.06, cash: 339000, callPct: 20, stopPct: 80, maxFall: 50 },
};

const LS_KEY = "mtfFallScenarios.v1";

function load(): Inputs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...PRESETS.Silver, ...JSON.parse(raw) };
  } catch {
    /* storage can be unavailable — fall back to the default */
  }
  return PRESETS.Silver;
}

const L = (v: number) => `${v < 0 ? "-" : ""}₹${fmt(Math.abs(v) / 1e5, 2)}L`;

function Field({ label, value, onChange, suffix, title }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; title?: string }) {
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

type Status = "safe" | "call" | "debit" | "stop";

function statusOf(loss: number, topUp: number, cashLeft: number, funded: number, a: Inputs): { s: Status; label: string } {
  if (funded > 0 && loss >= (a.stopPct / 100) * funded) return { s: "stop", label: `Auto square-off (${fmt(a.stopPct, 0)}% stop)` };
  if (cashLeft < 0) return { s: "debit", label: "Cash exhausted - debit, square-off possible" };
  if (topUp > 0) return { s: "call", label: "Margin call - cash covers it" };
  return { s: "safe", label: "Safe" };
}

const ROW_TONE: Record<Status, string> = {
  safe: "",
  call: "bg-amber-50/60",
  debit: "bg-orange-100/70",
  stop: "bg-red-100/70",
};

export default function MtfFallScenarios() {
  const [a, setA] = useState<Inputs>(load);
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(a));
    } catch {
      /* ignore */
    }
  }, [a]);
  const set = (patch: Partial<Inputs>) => setA((prev) => ({ ...prev, ...patch }));

  const m = useMemo(() => {
    const funded = a.units * a.fundedPerUnit;
    const own = a.units * (a.avgCost - a.fundedPerUnit);
    const callLine = a.avgCost - (a.callPct / 100) * a.fundedPerUnit;
    const stopLine = a.avgCost - (a.stopPct / 100) * a.fundedPerUnit;
    const interestDay = funded * 0.0004;
    const maxFall = Math.min(Math.max(Math.round(a.maxFall) || 0, 1), 95);
    const rows = [];
    let cashOutFall: number | null = null;
    let stopFall: number | null = null;
    for (let d = 0; d <= maxFall; d++) {
      const price = a.price * (1 - d / 100);
      const loss = a.units * (a.avgCost - price);
      const topUp = Math.max(0, loss - (a.callPct / 100) * funded);
      const cashLeft = a.cash - topUp;
      const st = statusOf(loss, topUp, cashLeft, funded, a);
      if (cashOutFall === null && cashLeft < 0) cashOutFall = d;
      if (stopFall === null && st.s === "stop") stopFall = d;
      rows.push({ d, price, loss, lossPct: funded > 0 ? (loss / funded) * 100 : 0, ownPct: own > 0 ? (loss / own) * 100 : 0, topUp, cashLeft, ...st });
    }
    return { funded, own, callLine, stopLine, interestDay, rows, cashOutFall, stopFall };
  }, [a]);

  const callAway = a.price > 0 ? (1 - m.callLine / a.price) * 100 : 0;
  const stopAway = a.price > 0 ? (1 - m.stopLine / a.price) * 100 : 0;

  return (
    <div>
      <div className="p-4 border border-slate-200 rounded-lg mb-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h2 className="text-sm font-medium text-slate-700 mr-2">Position</h2>
          {Object.entries(PRESETS).map(([k, p]) => (
            <button key={k} onClick={() => setA(p)} className={`text-xs px-2.5 py-1 rounded border ${a.name === p.name ? "border-indigo-500 text-indigo-600" : "border-slate-300 hover:border-slate-400"}`}>
              {k} ({p.name})
            </button>
          ))}
          <span className="text-xs text-slate-400 ml-auto">Everything below is editable; it is remembered in this browser.</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Current price" value={a.price} onChange={(v) => set({ price: v })} suffix="₹" title="Starting price. Every row below falls from this." />
          <Field label="MTF units" value={a.units} onChange={(v) => set({ units: v })} title="Units held on MTF (not the fully paid ones)." />
          <Field label="Average cost" value={a.avgCost} onChange={(v) => set({ avgCost: v })} suffix="₹" title="Kite's MTF average price for this holding." />
          <Field label="Funded per unit" value={a.fundedPerUnit} onChange={(v) => set({ fundedPerUnit: v })} suffix="₹" title="What Zerodha funded per unit = average cost minus your initial margin per unit." />
          <Field label="Cash available" value={a.cash} onChange={(v) => set({ cash: v })} suffix="₹" title="Cash (plus any collateral margin) you could use to meet a margin call." />
          <Field label="Margin-call line" value={a.callPct} onChange={(v) => set({ callPct: v })} suffix="% of funded" title="Zerodha: positions may be squared off if losses exceed 20% of the funded amount (applies once the account is in debit)." />
          <Field label="Auto square-off" value={a.stopPct} onChange={(v) => set({ stopPct: v })} suffix="% of funded" title="Zerodha: automatic square-off when losses reach 80% of the funded amount, even with enough balance." />
          <Field label="Rows down to" value={a.maxFall} onChange={(v) => set({ maxFall: v })} suffix="% fall" title="Table length, one row per 1% fall (max 95)." />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 bg-slate-50 rounded-lg p-4 mb-4">
        <div>
          <div className="text-xs text-slate-500">Funded / your money</div>
          <div className="text-lg font-semibold tabular-nums">
            {L(m.funded)} <span className="text-sm font-medium text-slate-500">/ {L(m.own)}</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Interest per day</div>
          <div className="text-lg font-semibold tabular-nums">₹{fmt(m.interestDay, 0)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Margin-call line</div>
          <div className="text-lg font-semibold tabular-nums">
            ₹{fmt(m.callLine, 2)} <span className={`text-sm font-medium ${callAway < 5 ? "text-red-600" : "text-slate-500"}`}>({fmt(callAway, 1)}% away)</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Cash runs out at</div>
          <div className="text-lg font-semibold tabular-nums">{m.cashOutFall !== null ? `-${m.cashOutFall}%` : `beyond -${m.rows.length - 1}%`}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Auto square-off line</div>
          <div className="text-lg font-semibold tabular-nums">
            ₹{fmt(m.stopLine, 2)} <span className="text-sm font-medium text-slate-500">({fmt(stopAway, 1)}% away)</span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="text-sm border-collapse w-full" style={{ minWidth: 900 }}>
          <thead className="text-slate-500 text-xs">
            <tr>
              <th className="text-center px-2 py-2 border-b border-slate-200 sticky top-0 bg-white">Fall</th>
              <th className="text-center px-2 py-2 border-b border-slate-200 sticky top-0 bg-white">Price</th>
              <th className="text-center px-2 py-2 border-b border-slate-200 sticky top-0 bg-white">Loss on MTF units</th>
              <th className="text-center px-2 py-2 border-b border-slate-200 sticky top-0 bg-white" title="Loss as a % of the amount Zerodha funded">% of funded</th>
              <th className="text-center px-2 py-2 border-b border-slate-200 sticky top-0 bg-white" title="Loss as a % of your own money in the position">% of your money</th>
              <th className="text-center px-2 py-2 border-b border-slate-200 sticky top-0 bg-white" title="Loss beyond the margin-call line - what a margin call would ask you to add">Top-up needed</th>
              <th className="text-center px-2 py-2 border-b border-slate-200 sticky top-0 bg-white">Cash left</th>
              <th className="text-left px-2 py-2 border-b border-slate-200 sticky top-0 bg-white">What happens</th>
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r) => (
              <tr key={r.d} className={`border-t border-slate-100 ${ROW_TONE[r.s]}`}>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.d === 0 ? "Now" : `-${r.d}%`}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.price, 2)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{L(r.loss)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.lossPct, 1, "%")}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{fmt(r.ownPct, 0, "%")}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.topUp > 0 ? L(r.topUp) : "-"}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${r.cashLeft < 0 ? "text-red-600 font-medium" : ""}`}>{L(r.cashLeft)}</td>
                <td className={`px-2 py-1.5 text-xs ${r.s === "stop" ? "text-red-700 font-medium" : r.s === "debit" ? "text-orange-700 font-medium" : r.s === "call" ? "text-amber-700" : "text-emerald-700"}`}>{r.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">
        Per-position view of one holding at a time (gold and silver share the same cash, so a real call on both asks for the sum). The 20% rule is, per
        Zerodha's policy, tied to the account being in debit - confirm with Zerodha how it is tested against unrealised losses. Interest is simple 0.04%/day on
        the funded amount. Not investment advice.
      </p>
    </div>
  );
}
