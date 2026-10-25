import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { fmt } from "../lib/model";
import { MethodologyNote } from "../components/ScreenerTable";

// MTF Playbook — added 2026-10-25 ("update our App with MTF playbook page") after building an Excel
// of the SILVERCASE MTF position: a price ladder for the ACTUAL Kite positions (not a leverage
// formula like the MTF Calculator's fall-scenarios table) with the columns that sheet had — my
// fund, Zerodha fund, average price — plus the key price levels where Zerodha's MTF rules bite.
//
//   Zerodha fund   = MTF cost (qty x avg) - initial margin     (initial margin = Kite's mtf.initial_margin: "my fund")
//   my fund left   = my fund + MTF P/L
//   loss % of Z    = MTF loss / Zerodha fund   — a risk meter for Zerodha's trigger, NOT Zerodha's own money
//                    being lost: the first slice of any loss is absorbed by MY fund; Zerodha's money is only
//                    touched once position value < Zerodha fund (the "my fund wiped" price).
//   shortfall      = loss beyond (my fund + free cash)  — where the account would go into debit
//
// Rules (https://support.zerodha.com/category/trading-and-markets/margins/margin-trading-facility/
// articles/rms-policy-on-mtf): square-off when loss >= 80% of the Zerodha-funded amount even with enough
// balance; position converted to CNC if >90% and it can't be sold; positions MAY be squared off to recover
// a debit if losses pass 20% of the funded amount. Percentages are inputs because the policy changes.
//
// The defaults below are Kite's holdings/margins as pulled 2026-10-25 (Kite access is on-request only, so
// there is no live feed); everything is editable and remembered in localStorage as a per-viewer convenience.
// "last close" comes from the daily NSE store (same bhav feed as All Technicals).

type Inst = { sym: string; label: string; qty: number; avg: number; myFund: number; cncQty: number; cncAvg: number; ltp: number; start: number; step: number };
type State = { silver: Inst; gold: Inst; cash: number; sqPct: number; cnvPct: number; debitPct: number; view: "silver" | "gold"; notes: string };

const DEFAULTS: State = {
  silver: { sym: "SILVERCASE", label: "Silver (SILVERCASE)", qty: 114000, avg: 21.907632, myFund: 912368.925, cncQty: 4000, cncAvg: 21.94476, ltp: 19.51, start: 25, step: 0.5 },
  gold: { sym: "GOLDCASE", label: "Gold (GOLDCASE)", qty: 168000, avg: 23.246786, myFund: 1087479.105, cncQty: 4000, cncAvg: 23.258053, ltp: 22.07, start: 28, step: 0.5 },
  cash: 268383.5,
  sqPct: 80,
  cnvPct: 90,
  debitPct: 20,
  view: "silver",
  notes: "",
};

const LS_KEY = "mtfPlaybook.v1";

function load(): State {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { ...DEFAULTS, ...p, silver: { ...DEFAULTS.silver, ...p.silver }, gold: { ...DEFAULTS.gold, ...p.gold } };
    }
  } catch {
    /* storage can be unavailable — fall back to the defaults */
  }
  return DEFAULTS;
}

const L = (v: number) => `${v < 0 ? "-" : ""}₹${fmt(Math.abs(v) / 1e5, 2)}L`;
const R = (v: number) => (v < 0 ? "-" : "") + "₹" + fmt(Math.abs(v), 0);
const num = (v: number) => (Number.isFinite(v) ? v : 0);

type Status = "ok" | "watch" | "debit20" | "fundgone" | "shortfall" | "cnv" | "stop";
const STATUS_LABEL: Record<Status, string> = {
  ok: "OK",
  watch: "Past 20% line",
  debit20: "Close to square-off",
  fundgone: "My fund gone",
  shortfall: "Debit (fund + cash gone)",
  stop: "SQUARE-OFF",
  cnv: "CONVERT TO CNC",
};
const TONE: Record<Status, string> = {
  ok: "",
  watch: "bg-amber-50/70",
  debit20: "bg-amber-100/80",
  fundgone: "bg-orange-100/70",
  shortfall: "bg-orange-200/70",
  stop: "bg-red-100/80",
  cnv: "bg-red-200/80",
};
const TEXT: Record<Status, string> = {
  ok: "text-emerald-700",
  watch: "text-amber-700",
  debit20: "text-amber-800 font-medium",
  fundgone: "text-orange-700 font-medium",
  shortfall: "text-orange-800 font-medium",
  stop: "text-red-700 font-medium",
  cnv: "text-red-800 font-semibold",
};

function Field({ label, value, onChange, suffix, title, step }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; title?: string; step?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600" title={title}>
      <span>{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          step={step ?? "any"}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm tabular-nums"
        />
        {suffix && <span className="text-slate-400 text-xs">{suffix}</span>}
      </div>
    </label>
  );
}

export default function MTFPlaybook() {
  const [st, setSt] = useState<State>(load);
  const [store, setStore] = useState<{ asOf?: string; px: Record<string, number> }>({ px: {} });
  const [addQty, setAddQty] = useState(0);
  const [addPx, setAddPx] = useState(0);
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(st));
    } catch {
      /* ignore */
    }
  }, [st]);
  useEffect(() => {
    api
      .getBhavTechnicals()
      .then((r) => {
        const px: Record<string, number> = {};
        for (const x of r.rows ?? []) if (x.symbol === "SILVERCASE" || x.symbol === "GOLDCASE") px[x.symbol] = x.price;
        setStore({ asOf: r.as_of, px });
      })
      .catch(() => {});
  }, []);

  const inst = st[st.view];
  const setInst = (patch: Partial<Inst>) => setSt((s) => ({ ...s, [s.view]: { ...s[s.view], ...patch } }));
  const set = (patch: Partial<State>) => setSt((s) => ({ ...s, ...patch }));

  const m = useMemo(() => {
    const { qty, avg, myFund, ltp, cncQty, cncAvg } = inst;
    const cost = qty * avg;
    const funded = Math.max(0, cost - myFund);
    const pl = (ltp - avg) * qty;
    const priceAtLoss = (loss: number) => (qty > 0 ? avg - loss / qty : 0);
    const levels = [
      { key: "l20", label: `${fmt(st.debitPct, 0)}% of Zerodha fund lost`, note: "Debit-recovery rule line: positions MAY be squared off if the account is in debit past this", price: priceAtLoss((st.debitPct / 100) * funded), tone: "text-amber-700" },
      { key: "mine", label: "My fund fully wiped", note: "Zerodha's own money is exposed below this price", price: priceAtLoss(myFund), tone: "text-orange-700" },
      { key: "cash", label: "My fund + free cash gone", note: "Account would be in debit below this price", price: priceAtLoss(myFund + st.cash), tone: "text-orange-800" },
      { key: "sq", label: `Auto square-off (${fmt(st.sqPct, 0)}% of Zerodha fund)`, note: "Sold even if your balance is sufficient", price: priceAtLoss((st.sqPct / 100) * funded), tone: "text-red-700" },
      { key: "cnv", label: `Convert to CNC (${fmt(st.cnvPct, 0)}% of Zerodha fund)`, note: "If it can't be sold in the market, the position becomes CNC and your account goes into debit", price: priceAtLoss((st.cnvPct / 100) * funded), tone: "text-red-800" },
    ].sort((a, b) => b.price - a.price);

    const status = (price: number): Status => {
      const loss = Math.max(0, (avg - price) * qty);
      const lp = funded > 0 ? (loss / funded) * 100 : 0;
      if (lp >= st.cnvPct) return "cnv";
      if (lp >= st.sqPct) return "stop";
      if (loss - myFund - st.cash > 0) return "shortfall";
      if (loss >= myFund) return "fundgone";
      if (lp >= st.sqPct * 0.75) return "debit20";
      if (lp >= st.debitPct) return "watch";
      return "ok";
    };
    const row = (price: number) => {
      const mtfPl = (price - avg) * qty;
      const loss = Math.max(0, -mtfPl);
      return {
        price,
        chg: avg > 0 ? price / avg - 1 : 0,
        value: price * qty,
        mtfPl,
        totalPl: mtfPl + (price - cncAvg) * cncQty,
        myLeft: myFund + mtfPl,
        myLostPct: myFund > 0 ? (loss / myFund) * 100 : 0,
        zPct: funded > 0 ? (loss / funded) * 100 : 0,
        shortfall: Math.max(0, loss - myFund - st.cash),
        s: status(price),
      };
    };
    const floor = Math.min(...levels.map((l) => l.price)) - inst.step;
    const step = inst.step > 0 ? inst.step : 0.5;
    const n = Math.min(120, Math.max(1, Math.ceil((inst.start - floor) / step) + 1));
    const rows = Array.from({ length: n }, (_, i) => row(inst.start - i * step));
    return { cost, funded, pl, myLeft: myFund + pl, zNow: funded > 0 ? (Math.max(0, -pl) / funded) * 100 : 0, levels, now: row(ltp), rows, mtfPct: cost > 0 ? (myFund / cost) * 100 : 0 };
  }, [inst, st.cash, st.sqPct, st.cnvPct, st.debitPct]);

  const newQty = inst.qty + num(addQty);
  const newAvg = newQty > 0 ? (inst.qty * inst.avg + num(addQty) * num(addPx)) / newQty : 0;
  const storePx = store.px[inst.sym];
  const th = "text-center px-2 py-2 border-b border-slate-200 sticky top-0 bg-white";
  const td = "px-2 py-1.5 text-right tabular-nums";
  const sign = (v: number) => (v < 0 ? "text-red-600" : "text-emerald-700");

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-3 mb-1">
        <h1 className="text-lg font-semibold">📘 MTF Playbook</h1>
        <span className="text-xs text-slate-500">Where your actual MTF positions stand against Zerodha's margin rules, price by price</span>
        <button onClick={() => setSt(DEFAULTS)} className="text-xs text-slate-500 hover:underline ml-auto">
          reset all
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 my-3">
        {(["silver", "gold"] as const).map((k) => (
          <button key={k} onClick={() => set({ view: k })} className={`text-sm px-3 py-1.5 rounded border ${st.view === k ? "border-indigo-500 text-indigo-600 font-medium" : "border-slate-300 hover:border-slate-400"}`}>
            {st[k].label}
          </button>
        ))}
        <span className="text-[11px] text-slate-400 ml-2">Defaults = Kite holdings & margins as pulled 2026-10-25 — edit any input; it is remembered in this browser.</span>
      </div>

      <div className="p-4 border border-slate-200 rounded-lg mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Current price" value={inst.ltp} onChange={(v) => setInst({ ltp: v })} suffix="₹" title="Type the live price; the ladder and the Now row follow it." />
          <Field label="MTF units" value={inst.qty} onChange={(v) => setInst({ qty: v })} title="Kite holdings → mtf.quantity" />
          <Field label="MTF average price" value={inst.avg} onChange={(v) => setInst({ avg: v })} suffix="₹" title="Kite holdings → mtf.average_price" />
          <Field label="My fund (initial margin)" value={inst.myFund} onChange={(v) => setInst({ myFund: v })} suffix="₹" title="Kite holdings → mtf.initial_margin. Zerodha fund = cost − this." />
          <Field label="Free cash" value={st.cash} onChange={(v) => set({ cash: v })} suffix="₹" title="Cash that could meet a debit. Shared by silver and gold; not added to the ladder's P/L." />
          <Field label="CNC units (fully paid)" value={inst.cncQty} onChange={(v) => setInst({ cncQty: v })} title="Not part of the MTF margin; only added to the 'Total P/L' column." />
          <Field label="CNC average price" value={inst.cncAvg} onChange={(v) => setInst({ cncAvg: v })} suffix="₹" />
          <div className="flex items-end text-[11px] text-slate-500 pb-2">
            {storePx !== undefined ? (
              <span>
                Store close ₹{fmt(storePx, 2)} {store.asOf ? `(${store.asOf})` : ""}{" "}
                <button onClick={() => setInst({ ltp: storePx })} className="text-indigo-600 hover:underline">
                  use it
                </button>
              </span>
            ) : (
              <span>Store close not loaded</span>
            )}
          </div>
          <Field label="Square-off trigger" value={st.sqPct} onChange={(v) => set({ sqPct: v })} suffix="% of Z fund" title="Zerodha RMS: auto square-off when loss reaches this share of the amount Zerodha funded." />
          <Field label="Convert-to-CNC trigger" value={st.cnvPct} onChange={(v) => set({ cnvPct: v })} suffix="% of Z fund" />
          <Field label="Debit-rule line" value={st.debitPct} onChange={(v) => set({ debitPct: v })} suffix="% of Z fund" title="Zerodha RMS: positions may be squared off to recover a debit if losses exceed this share of the funded amount." />
          <div />
          <Field label="Ladder start price" value={inst.start} onChange={(v) => setInst({ start: v })} suffix="₹" />
          <Field label="Ladder step" value={inst.step} onChange={(v) => setInst({ step: v })} suffix="₹" />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 bg-slate-50 rounded-lg p-4 mb-4">
        <div>
          <div className="text-xs text-slate-500">Position cost</div>
          <div className="text-lg font-semibold tabular-nums">{L(m.cost)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">My fund / Zerodha fund</div>
          <div className="text-lg font-semibold tabular-nums">
            {L(inst.myFund)} <span className="text-sm font-medium text-slate-500">/ {L(m.funded)}</span>
          </div>
          <div className="text-[11px] text-slate-400">mine is {fmt(m.mtfPct, 1, "%")} of the position</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">MTF P/L now</div>
          <div className={`text-lg font-semibold tabular-nums ${sign(m.pl)}`}>{L(m.pl)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">My fund remaining</div>
          <div className="text-lg font-semibold tabular-nums">{L(m.myLeft)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Loss % of Zerodha fund</div>
          <div className="text-lg font-semibold tabular-nums">{fmt(m.zNow, 1, "%")}</div>
          <div className="text-[11px] text-slate-400">square-off at {fmt(st.sqPct, 0, "%")}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Free cash</div>
          <div className="text-lg font-semibold tabular-nums">{L(st.cash)}</div>
        </div>
      </div>

      <h2 className="text-sm font-medium text-slate-700 mb-2">Key levels — {inst.sym}</h2>
      <div className="overflow-x-auto border border-slate-200 rounded-lg mb-4">
        <table className="text-sm border-collapse w-full" style={{ minWidth: 760 }}>
          <thead className="text-slate-500 text-xs">
            <tr>
              <th className={`${th} text-left`}>Level</th>
              <th className={th}>Price</th>
              <th className={th}>Fall from now</th>
              <th className={th}>MTF P/L there</th>
              <th className={`${th} text-left`}>What it means</th>
            </tr>
          </thead>
          <tbody>
            {m.levels.map((l) => (
              <tr key={l.key} className="border-t border-slate-100">
                <td className={`px-2 py-1.5 font-medium ${l.tone}`}>{l.label}</td>
                <td className={`${td} font-semibold`}>₹{fmt(l.price, 2)}</td>
                <td className={td}>{inst.ltp > 0 ? fmt((l.price / inst.ltp - 1) * 100, 1, "%") : "—"}</td>
                <td className={`${td} ${sign((l.price - inst.avg) * inst.qty)}`}>{L((l.price - inst.avg) * inst.qty)}</td>
                <td className="px-2 py-1.5 text-xs text-slate-500">{l.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-sm font-medium text-slate-700 mb-2">Price ladder — {inst.sym}</h2>
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="text-sm border-collapse w-full" style={{ minWidth: 1500 }}>
          <thead className="text-slate-500 text-xs">
            <tr>
              <th className={th}>Price (₹)</th>
              <th className={th}>Avg price (₹)</th>
              <th className={th}>MTF units</th>
              <th className={th}>vs avg</th>
              <th className={th}>Position value</th>
              <th className={th}>MTF P/L</th>
              <th className={th} title="MTF P/L plus the fully paid (CNC) units">
                Total P/L incl. CNC
              </th>
              <th className={th}>My fund</th>
              <th className={th}>My fund remaining</th>
              <th className={th}>My fund lost %</th>
              <th className={th}>Zerodha fund</th>
              <th className={th} title="MTF loss ÷ Zerodha fund. A risk meter for Zerodha's trigger — your own fund absorbs the loss first.">
                Loss % of Zerodha fund
              </th>
              <th className={th} title="Loss beyond my fund + free cash — where the account would go into debit">
                Shortfall after fund + cash
              </th>
              <th className={`${th} text-left`}>Status</th>
            </tr>
          </thead>
          <tbody>
            {[{ ...m.now, now: true }, ...m.rows.map((r) => ({ ...r, now: false }))].map((r, i) => (
              <tr key={i} className={`border-t ${r.now ? "border-indigo-300 bg-indigo-50 font-medium" : `border-slate-100 ${TONE[r.s]}`}`}>
                <td className={td}>
                  {fmt(r.price, 2)}
                  {r.now && <span className="ml-1 text-[10px] text-indigo-600">now</span>}
                </td>
                <td className={`${td} text-slate-500`}>{fmt(inst.avg, 4)}</td>
                <td className={`${td} text-slate-500`}>{fmt(inst.qty, 0)}</td>
                <td className={`${td} ${sign(r.chg)}`}>{fmt(r.chg * 100, 1, "%")}</td>
                <td className={td}>{R(r.value)}</td>
                <td className={`${td} ${sign(r.mtfPl)}`}>{R(r.mtfPl)}</td>
                <td className={`${td} ${sign(r.totalPl)}`}>{R(r.totalPl)}</td>
                <td className={`${td} text-slate-500`}>{R(inst.myFund)}</td>
                <td className={`${td} ${r.myLeft <= 0 ? "text-red-600 font-medium" : ""}`}>{R(r.myLeft)}</td>
                <td className={td}>{fmt(r.myLostPct, 1, "%")}</td>
                <td className={`${td} text-slate-500`}>{R(m.funded)}</td>
                <td className={td}>{fmt(r.zPct, 1, "%")}</td>
                <td className={`${td} ${r.shortfall > 0 ? "text-red-600 font-medium" : "text-slate-400"}`}>{r.shortfall > 0 ? R(r.shortfall) : "-"}</td>
                <td className={`px-2 py-1.5 text-xs whitespace-nowrap ${TEXT[r.s]}`}>{STATUS_LABEL[r.s]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <div className="p-4 border border-slate-200 rounded-lg">
          <div className="text-sm font-medium text-slate-700 mb-3">Average-down helper (reference only)</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Extra MTF units" value={addQty} onChange={setAddQty} />
            <Field label="Buy price" value={addPx || inst.ltp} onChange={setAddPx} suffix="₹" />
          </div>
          <div className="text-xs text-slate-600 mt-3">
            New average <b className="text-slate-800">₹{fmt(newAvg, 4)}</b> on <b className="text-slate-800">{fmt(newQty, 0)}</b> units. This does not feed the ladder above — it also needs extra margin, so
            update units / average / my fund from Kite after you trade.
          </div>
        </div>
        <div className="p-4 border border-slate-200 rounded-lg">
          <label className="text-sm font-medium text-slate-700 block mb-2">My action plan / notes</label>
          <textarea
            value={st.notes}
            onChange={(e) => set({ notes: e.target.value })}
            rows={4}
            placeholder="e.g. at ₹14 add ₹X cash or trim 25%; at ₹13.9 my fund is gone..."
            className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
          />
          <div className="text-[11px] text-slate-400 mt-1">Saved in this browser only.</div>
        </div>
      </div>

      <MethodologyNote>
        <p>
          <b>Zerodha fund</b> is the part of the position Zerodha lent you: cost minus your initial margin. <b>Loss % of Zerodha fund</b> is the MTF loss divided by that amount — it is the number
          Zerodha's square-off rule watches, <i>not</i> Zerodha losing money. Your own fund absorbs the first slice of any loss; Zerodha's money is only touched once the position is worth less than
          the Zerodha fund (the "My fund fully wiped" price).
        </p>
        <p>
          Zerodha's MTF policy squares off at {fmt(st.sqPct, 0)}% of the funded amount even when your balance is sufficient — which can be below the funded amount itself (its own example: ₹100 stock, ₹60
          funded, square-off at a ₹48 loss). Once your fund is gone any further loss puts the account in debit, so the practical danger zone starts between the "my fund wiped" and "fund + cash gone" prices,
          before the square-off price. The 20% debit rule's base is not defined clearly in the policy — confirm with Zerodha. Percentages are inputs; check the policy page, it changes.
        </p>
        <p>Fall-by-% scenarios, hold/sell/convert comparisons and interest live on the MTF Calculator page. Not investment advice.</p>
      </MethodologyNote>
    </div>
  );
}
