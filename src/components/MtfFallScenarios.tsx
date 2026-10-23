import { useEffect, useMemo, useState } from "react";
import { fmt } from "../lib/model";

// MTF fall scenarios — added 2026-10-23 ("give above table in our MTF page
// of our app to calculate my self... allow editable for current price and
// rows upto 50% drop"), reworked same day ("is the calculation based on
// Silver multiple funded? if not create for Silver and Gold as per
// formula"): the funded amount is now DERIVED from the instrument's
// leverage multiple instead of typed in —
//     margin %          = 1 / leverage
//     funded per unit   = average cost x (1 - 1/leverage)
//     funded amount     = units x funded per unit
// Zerodha's leverage for these two: GOLDCASE 3.57x (28.01% margin) and
// SILVERCASE 2.7x (37.04%) — the same figures MTFCalculator's playtool uses.
// Kite's own blended figures drift a little from this (lots bought at
// different margin rates), so "Funded per unit" can still be overridden by
// hand; clearing the override returns to the formula.
//
// What each row shows, per Zerodha's RMS policy
// (https://support.zerodha.com/category/trading-and-markets/margins/
// margin-trading-facility/articles/rms-policy-on-mtf):
// - loss > 20% of funded: positions may be squared off to recover a DEBIT
//   balance — while cash stays positive this is a top-up/notice (8 AM
//   notice, ~11 AM deadline), not an automatic sale;
// - loss >= 80% of funded: automatic square-off even with enough balance.
// "Top-up needed" = loss beyond the 20% line; "Cash left" = cash minus that.
// The "Both" view puts silver and gold on one shared cash balance, falling
// by the same % together. Inputs are remembered in localStorage only as a
// per-viewer convenience.

type Pos = { name: string; units: number; avgCost: number; leverage: number; fundedOverride: number | null; price: number; sellPct: number; convPct: number };
type Shared = { cash: number; callPct: number; stopPct: number; maxFall: number };
type State = { silver: Pos; gold: Pos; shared: Shared; view: "silver" | "gold" | "both" };

const DEFAULTS: State = {
  silver: { name: "SILVERCASE", units: 114000, avgCost: 21.9076, leverage: 2.7, fundedOverride: null, price: 19.44, sellPct: 0, convPct: 0 },
  gold: { name: "GOLDCASE", units: 168000, avgCost: 23.2468, leverage: 3.57, fundedOverride: null, price: 22.06, sellPct: 0, convPct: 0 },
  shared: { cash: 339000, callPct: 20, stopPct: 80, maxFall: 50 },
  view: "silver",
};

const LS_KEY = "mtfFallScenarios.v3";

function load(): State {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { ...DEFAULTS, ...p, silver: { ...DEFAULTS.silver, ...p.silver }, gold: { ...DEFAULTS.gold, ...p.gold }, shared: { ...DEFAULTS.shared, ...p.shared } };
    }
  } catch {
    /* storage can be unavailable — fall back to the defaults */
  }
  return DEFAULTS;
}

const L = (v: number) => `${v < 0 ? "-" : ""}₹${fmt(Math.abs(v) / 1e5, 2)}L`;

const fundedPerUnit = (p: Pos) => (p.fundedOverride !== null && Number.isFinite(p.fundedOverride) ? p.fundedOverride : p.avgCost * (1 - 1 / p.leverage));

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

function split(p: Pos) {
  const sell = Math.min(Math.max(p.sellPct || 0, 0), 100);
  const conv = Math.min(Math.max(p.convPct || 0, 0), 100 - sell);
  const sold = Math.round((p.units * sell) / 100);
  const converted = Math.round((p.units * conv) / 100);
  return { sold, converted, left: p.units - sold - converted };
}

function BucketLine({ p, f }: { p: Pos; f: number }) {
  const b = split(p);
  const cashDelta = b.sold * (p.price - f) - b.converted * f;
  return (
    <div className="col-span-2 text-[11px] text-slate-500 leading-relaxed">
      Sold <b className="text-slate-700">{fmt(b.sold, 0)}</b> · Converted <b className="text-slate-700">{fmt(b.converted, 0)}</b> · Left on MTF <b className="text-slate-700">{fmt(b.left, 0)}</b>
      {" "}— cash {cashDelta >= 0 ? "back" : "used"} <b className={cashDelta >= 0 ? "text-emerald-600" : "text-red-600"}>{L(Math.abs(cashDelta))}</b>, loss locked in <b className="text-slate-700">{L(b.sold * (p.avgCost - p.price))}</b>
    </div>
  );
}

function PosInputs({ title, p, onChange }: { title: string; p: Pos; onChange: (p: Pos) => void }) {
  const f = fundedPerUnit(p);
  return (
    <div className="p-4 border border-slate-200 rounded-lg">
      <div className="text-sm font-medium text-slate-700 mb-3">{title}</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Current price" value={p.price} onChange={(v) => onChange({ ...p, price: v })} suffix="₹" title="Starting price. Every row falls from this." />
        <Field label="MTF units" value={p.units} onChange={(v) => onChange({ ...p, units: v })} title="Units held on MTF (not the fully paid ones)." />
        <Field label="Average cost" value={p.avgCost} onChange={(v) => onChange({ ...p, avgCost: v })} suffix="₹" title="Kite's MTF average price for this holding." />
        <Field
          label="Leverage"
          value={p.leverage}
          onChange={(v) => onChange({ ...p, leverage: v })}
          suffix="x"
          title="Zerodha's MTF leverage for this instrument (GOLDCASE 3.57x, SILVERCASE 2.7x). Margin % = 1 / leverage; you pay that share of cost, Zerodha funds the rest."
        />
        <div className="col-span-2 flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[140px]">
            <Field
              label={p.fundedOverride === null ? "Funded per unit (formula)" : "Funded per unit (manual)"}
              value={Math.round(f * 10000) / 10000}
              onChange={(v) => onChange({ ...p, fundedOverride: Number.isFinite(v) ? v : null })}
              suffix="₹"
              title="Average cost x (1 - 1/leverage). Type here to override with Kite's actual blended figure."
            />
          </div>
          {p.fundedOverride !== null && (
            <button onClick={() => onChange({ ...p, fundedOverride: null })} className="text-xs text-indigo-600 hover:underline pb-2">
              reset to formula
            </button>
          )}
          <span className="text-[11px] text-slate-400 pb-2">
            margin {fmt(100 / p.leverage, 1, "%")} · funded {L(p.units * f)} · yours {L(p.units * (p.avgCost - f))}
          </span>
        </div>
        <Field label="Sell (trim) %" value={p.sellPct} onChange={(v) => onChange({ ...p, sellPct: Number.isFinite(v) ? v : 0 })} suffix="% of MTF" title="Share of the MTF units sold now at the current price. The sale repays the funded part and returns the rest as cash; the loss is realised." />
        <Field label="Convert to holdings %" value={p.convPct} onChange={(v) => onChange({ ...p, convPct: Number.isFinite(v) ? v : 0 })} suffix="% of MTF" title="Share of the MTF units converted to fully paid. You pay the funded part from cash; the units stay held, so no loss is realised." />
        <BucketLine p={p} f={f} />
      </div>
    </div>
  );
}

export default function MtfFallScenarios() {
  const [st, setSt] = useState<State>(load);
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(st));
    } catch {
      /* ignore */
    }
  }, [st]);
  const setShared = (patch: Partial<Shared>) => setSt((s) => ({ ...s, shared: { ...s.shared, ...patch } }));
  const { silver, gold, shared, view } = st;

  const m = useMemo(() => {
    const maxFall = Math.min(Math.max(Math.round(shared.maxFall) || 0, 1), 95);
    let cashAdj = 0;
    let lockedLoss = 0;
    const legs = (view === "both" ? [silver, gold] : view === "silver" ? [silver] : [gold]).map((orig) => {
      const f = fundedPerUnit(orig);
      const b = split(orig);
      cashAdj += b.sold * (orig.price - f) - b.converted * f;
      lockedLoss += b.sold * (orig.avgCost - orig.price);
      const p = { ...orig, units: b.left };
      return { p, f, funded: p.units * f, own: p.units * (p.avgCost - f), callLine: p.avgCost - (shared.callPct / 100) * f, stopLine: p.avgCost - (shared.stopPct / 100) * f };
    });
    const cashNow = shared.cash + cashAdj;
    const funded = legs.reduce((s, l) => s + l.funded, 0);
    const own = legs.reduce((s, l) => s + l.own, 0);
    const rows = [];
    let cashOutFall: number | null = null;
    for (let d = 0; d <= maxFall; d++) {
      const per = legs.map((l) => {
        const price = l.p.price * (1 - d / 100);
        const loss = l.p.units * (l.p.avgCost - price);
        const topUp = Math.max(0, loss - (shared.callPct / 100) * l.funded);
        const stopped = l.funded > 0 && loss >= (shared.stopPct / 100) * l.funded;
        return { name: l.p.name, price, loss, topUp, stopped };
      });
      const loss = per.reduce((s, x) => s + x.loss, 0);
      const topUp = per.reduce((s, x) => s + x.topUp, 0);
      const cashLeft = cashNow - topUp;
      let s: Status = "safe";
      let label = "Safe";
      const stoppedNames = per.filter((x) => x.stopped).map((x) => x.name);
      if (stoppedNames.length) {
        s = "stop";
        label = `Auto square-off (${fmt(shared.stopPct, 0)}% stop): ${stoppedNames.join(", ")}`;
      } else if (cashLeft < 0) {
        s = "debit";
        label = "Cash exhausted - debit, square-off possible";
      } else if (topUp > 0) {
        s = "call";
        label = "Margin call - cash covers it";
      }
      if (cashOutFall === null && cashLeft < 0) cashOutFall = d;
      rows.push({ d, per, loss, lossPct: funded > 0 ? (loss / funded) * 100 : 0, ownPct: own > 0 ? (loss / own) * 100 : 0, topUp, cashLeft, s, label });
    }
    return { legs, funded, own, interestDay: funded * 0.0004, rows, cashOutFall, cashNow, lockedLoss };
  }, [silver, gold, shared, view]);

  const ROW_TONE: Record<Status, string> = { safe: "", call: "bg-amber-50/60", debit: "bg-orange-100/70", stop: "bg-red-100/70" };
  const both = view === "both";
  const th = "text-center px-2 py-2 border-b border-slate-200 sticky top-0 bg-white";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {(["silver", "gold", "both"] as const).map((k) => (
          <button key={k} onClick={() => setSt((s) => ({ ...s, view: k }))} className={`text-sm px-3 py-1.5 rounded border ${view === k ? "border-indigo-500 text-indigo-600 font-medium" : "border-slate-300 hover:border-slate-400"}`}>
            {k === "silver" ? "Silver" : k === "gold" ? "Gold" : "Silver + Gold (shared cash)"}
          </button>
        ))}
        <button onClick={() => setSt(DEFAULTS)} className="text-xs text-slate-500 hover:underline ml-auto">
          reset all
        </button>
      </div>

      <div className={`grid gap-4 mb-4 ${both ? "sm:grid-cols-2" : ""}`}>
        {(view === "silver" || both) && <PosInputs title="Silver (SILVERCASE)" p={silver} onChange={(p) => setSt((s) => ({ ...s, silver: p }))} />}
        {(view === "gold" || both) && <PosInputs title="Gold (GOLDCASE)" p={gold} onChange={(p) => setSt((s) => ({ ...s, gold: p }))} />}
      </div>

      <div className="p-4 border border-slate-200 rounded-lg mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Cash available" value={shared.cash} onChange={(v) => setShared({ cash: v })} suffix="₹" title="Cash (plus any collateral margin) you could use to meet a margin call. Shared across the positions shown." />
          <Field label="Margin-call line" value={shared.callPct} onChange={(v) => setShared({ callPct: v })} suffix="% of funded" title="Zerodha: positions may be squared off if losses exceed 20% of the funded amount (applies once the account is in debit)." />
          <Field label="Auto square-off" value={shared.stopPct} onChange={(v) => setShared({ stopPct: v })} suffix="% of funded" title="Zerodha: automatic square-off when losses reach 80% of the funded amount, even with enough balance." />
          <Field label="Rows down to" value={shared.maxFall} onChange={(v) => setShared({ maxFall: v })} suffix="% fall" title="One row per 1% fall (max 95). In the combined view both metals fall by the same %." />
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
          <div className="text-xs text-slate-500">Cash after plan / loss locked in</div>
          <div className="text-lg font-semibold tabular-nums">
            {L(m.cashNow)} <span className="text-sm font-medium text-slate-500">/ {L(m.lockedLoss)}</span>
          </div>
        </div>
        {m.legs.map((l) => {
          const away = l.p.price > 0 ? (1 - l.callLine / l.p.price) * 100 : 0;
          return (
            <div key={l.p.name}>
              <div className="text-xs text-slate-500">{l.p.name} margin-call line</div>
              <div className="text-lg font-semibold tabular-nums">
                ₹{fmt(l.callLine, 2)} <span className={`text-sm font-medium ${away < 5 ? "text-red-600" : "text-slate-500"}`}>({fmt(away, 1)}% away)</span>
              </div>
              <div className="text-[11px] text-slate-400">
                auto square-off ₹{fmt(l.stopLine, 2)} ({fmt(l.p.price > 0 ? (1 - l.stopLine / l.p.price) * 100 : 0, 1)}% away)
              </div>
            </div>
          );
        })}
        <div>
          <div className="text-xs text-slate-500">Cash runs out at</div>
          <div className="text-lg font-semibold tabular-nums">{m.cashOutFall !== null ? `-${m.cashOutFall}%` : `beyond -${m.rows.length - 1}%`}</div>
        </div>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="text-sm border-collapse w-full" style={{ minWidth: both ? 1250 : 900 }}>
          <thead className="text-slate-500 text-xs">
            <tr>
              <th className={th}>Fall</th>
              {both ? (
                <>
                  <th className={th}>Silver price</th>
                  <th className={th}>Gold price</th>
                  <th className={th}>Silver loss</th>
                  <th className={th}>Gold loss</th>
                  <th className={th}>Total loss</th>
                </>
              ) : (
                <>
                  <th className={th}>Price</th>
                  <th className={th}>Loss on MTF units</th>
                </>
              )}
              <th className={th} title="Loss as a % of the amount Zerodha funded">% of funded</th>
              <th className={th} title="Loss as a % of your own money in the position(s)">% of your money</th>
              {both ? (
                <>
                  <th className={th}>Silver top-up</th>
                  <th className={th}>Gold top-up</th>
                </>
              ) : null}
              <th className={th} title="Loss beyond the margin-call line - what a margin call would ask you to add">{both ? "Total top-up" : "Top-up needed"}</th>
              <th className={th}>Cash left</th>
              <th className={`${th} text-left`}>What happens</th>
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r) => (
              <tr key={r.d} className={`border-t border-slate-100 ${ROW_TONE[r.s]}`}>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.d === 0 ? "Now" : `-${r.d}%`}</td>
                {both ? (
                  <>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.per[0].price, 2)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.per[1].price, 2)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{L(r.per[0].loss)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{L(r.per[1].loss)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{L(r.loss)}</td>
                  </>
                ) : (
                  <>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.per[0].price, 2)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{L(r.loss)}</td>
                  </>
                )}
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.lossPct, 1, "%")}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{fmt(r.ownPct, 0, "%")}</td>
                {both ? (
                  <>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{r.per[0].topUp > 0 ? L(r.per[0].topUp) : "-"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{r.per[1].topUp > 0 ? L(r.per[1].topUp) : "-"}</td>
                  </>
                ) : null}
                <td className="px-2 py-1.5 text-right tabular-nums">{r.topUp > 0 ? L(r.topUp) : "-"}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${r.cashLeft < 0 ? "text-red-600 font-medium" : ""}`}>{L(r.cashLeft)}</td>
                <td className={`px-2 py-1.5 text-xs ${r.s === "stop" ? "text-red-700 font-medium" : r.s === "debit" ? "text-orange-700 font-medium" : r.s === "call" ? "text-amber-700" : "text-emerald-700"}`}>{r.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">
        Funded per unit = average cost x (1 - 1/leverage), so the numbers move with whichever leverage multiple you set. Kite's own blended funded amount can differ slightly
        (lots bought at different margin rates) - type it into "Funded per unit" to override. The 20% rule is, per Zerodha's policy, tied to the account being in
        debit - confirm with Zerodha how it is tested against unrealised losses. Interest is simple 0.04%/day on the funded amount. Not investment advice.
      </p>
    </div>
  );
}
