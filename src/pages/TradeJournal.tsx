import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { fmt, fmtSigned } from "../lib/model";
import { PriceLink } from "../components/ScreenerTable";
import { Check, Doc, Entry, InboxItem, NEAR_PCT, Review, Sell, alertHidden, buildBooks, ema33Level, isClosed, matchSale, stopLevel, stopState } from "../lib/journal";

// Trade Journal — added 2026-10-25 ("a new menu page for checklist + buying record for future review, with reasons as
// to why I buy, date, qty, price ... keep to process instead of emotions"), extended the same day with "a) is it above
// 200DEMA b) weekly RSI > 66 c) fundamental trigger YES? in few words d) what is the allocation, reason for allocation
// e) stop loss % and alert when it shows up". Two parts:
//  1. a pre-buy CHECKLIST (editable). The 200D EMA and weekly RSI items are filled in from the daily NSE store the
//     moment a symbol is typed (still overridable); the fundamental-trigger, allocation and stop-loss items tick
//     themselves once their fields below are filled in.
//  2. a BUY RECORD: date, qty, price, allocation % + why, stop-loss (% and price), the fundamental trigger, the written
//     reason, state of mind, and a snapshot of the checklist as it stood — later edits to the checklist never rewrite
//     history. Each row can be reviewed later (exit, did I follow the plan, lesson), and the stats strip shows whether
//     trades that followed the checklist actually did better.
// STOP-LOSS ALERT: open entries whose last close is at/under the stop (red) or within NEAR_PCT of it (amber) are
// flagged on this page and as a count on the 📓 nav link (src/lib/journal.tsx). It runs on the daily store, so it
// fires after the evening update — it is a reminder, not a live stop order.
// HISTORY (2026-10-25, "if a future buy it should be able to view back previous buys ... summary on avg price and also
// reasons ... dates, prices, reasons, weeklyRSI"): typing a symbol you already hold opens a panel with every earlier buy
// (date, qty, price, allocation, stop, weekly RSI and 200D EMA position on that day, state of mind, the reason), the
// open position's weighted average price / invested / allocation so far, and what the average and total allocation
// become if this buy goes ahead — with a warning when it is averaging DOWN, chasing UP, or adding to a position whose
// stop is already breached. The Positions table rolls the open buys up per symbol the same way.
// Stored in the watchlist API's `journal` meta (api/watchlist.py, GET ?journal=1 / POST action "journal"), saved ~0.6s
// after each change, so it is the same from every device.

const auto = (t: string, a?: Check["auto"]) => ({ text: t, auto: a });
const DEFAULT_CHECKLIST: Check[] = [
  auto("Price is above the 200-day EMA", "ema200"),
  auto("Weekly RSI(14) is above 66", "rsiw"),
  auto("There is a fundamental trigger (named in a few words below)", "fund"),
  auto("Allocation decided, with the reason for the size", "alloc"),
  auto("Stop-loss set (% and price) before I buy", "stop"),
  auto("Entry is a daily EMA contraction / tight base with volume drying up — not a gap-up chase"),
  auto("The market regime is not defensive (index trend, VIX, breadth)"),
  auto("The sector has a tailwind and this is a leader in it"),
  auto("I would still buy if I could not watch the price today (not FOMO)"),
].map((c, i) => ({ id: c.auto ?? `c${i + 1}`, ...c }));

const STATES = ["Calm / by the plan", "Confident", "FOMO", "Revenge / making it back", "Bored", "Greedy", "Anxious"];
const SETUPS = ["Pullback to EMA", "VCP / base breakout", "52-week high breakout", "Results play", "Theme / sector play", "Averaging up", "Other"];
const MOODS: Record<string, string> = { "Calm / by the plan": "😌", Confident: "😎", FOMO: "😬", "Revenge / making it back": "😤", Bored: "🥱", Greedy: "🤑", Anxious: "😰" };
const ALLOCS = [0.5, 1, 1.5, 2, 3, 4, 5];
const ALLOC_WHY = ["Starter position", "Staggered buy", "Half size — result pending", "Full size", "Adding on strength", "High conviction"];
const STOP_PCTS = [3, 5, 7, 8, 10, 12];
const FUND_CHIPS = ["Strong results", "Order win", "Guidance upgrade", "Capex / expansion", "Turnaround", "Sector re-rating", "New product / approval"];
const WHY_CHIPS = ["Weekly RSI > 66", "Tight base / VCP", "Pullback to 20D EMA", "Pullback to 33W EMA", "Breakout on volume", "Near 52-week high", "Sector tailwind", "Market supportive", "Staggered entry"];
// add or remove one phrase from a separator-joined list (so a tap on a chip builds the sentence for you)
const togglePhrase = (text: string, phrase: string, sep: string) => {
  const parts = text.split(sep.trim()).map((x) => x.trim()).filter(Boolean);
  return (parts.includes(phrase) ? parts.filter((x) => x !== phrase) : [...parts, phrase]).join(sep);
};
const hasPhrase = (text: string, phrase: string, sep: string) => text.split(sep.trim()).map((x) => x.trim()).includes(phrase);
const chip = (on: boolean) => `px-2.5 py-1 rounded-full text-xs border whitespace-nowrap ${on ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-300 text-slate-600 hover:border-slate-400"}`;
// a buy "followed the process" when it had a stop, a named trigger, a calm/confident head and most of the checklist
const processOk = (e: Entry) => !e.pending && e.stop0 !== null && e.fundTrigger === "yes" && (e.state === STATES[0] || e.state === STATES[1]) && (score(e) ?? 0) >= 0.7;
const SELL_CHIPS = ["Hit my stop-loss", "Trailing stop hit", "Below 20D EMA — sold a third", "Closed below 20W EMA — exit", "Target reached", "Booked profit", "Thesis broken", "Raising cash", "Rebalancing / trim", "Fear / panic"];
const PLAN_CHIPS: { v: "yes" | "partly" | "no"; label: string }[] = [
  { v: "yes", label: "✅ by the plan" },
  { v: "partly", label: "🤏 partly" },
  { v: "no", label: "❌ emotion" },
];
const fmtQty = (v: number) => fmt(v, Number.isInteger(v) ? 0 : 2);

// The "reason owed" card for a Kite trade the PF update queued: tap chips, pick a mood, save — no form to fill.
function QuickComment({ e, x, sale, ema33, checklist, onSaveBuy, onSaveSell, onDrop }: {
  e?: Entry; x?: Sell; sale?: { pl: number; cost: number; matched: number }; ema33?: number | null;
  checklist: Check[]; onSaveBuy: (p: Partial<Entry>) => void; onSaveSell: (p: Partial<Sell>) => void; onDrop: () => void;
}) {
  const [reason, setReason] = useState("");
  const [trig, setTrig] = useState<"" | "yes" | "no">("");
  const [trigNote, setTrigNote] = useState("");
  const [stopPct, setStopPct] = useState<number | null>(null);
  const [useEma, setUseEma] = useState(true); // default stop = the live weekly 33 EMA
  const [state, setState] = useState(STATES[0]);
  const [allocWhy, setAllocWhy] = useState("");
  const [plan, setPlan] = useState<"" | "yes" | "partly" | "no">("");
  const [lesson, setLesson] = useState("");
  const [px, setPx] = useState(String((e ?? x)!.price));
  const buy = !!e;
  const it = (e ?? x)!;
  const ok = reason.trim().length >= 10 && (buy ? trig !== "" : true);
  const emaOk = !!ema33 && ema33 > 0;
  const stopPx = buy ? (useEma && emaOk ? ema33! : stopPct ? it.price * (1 - stopPct / 100) : null) : null;
  const save = () => {
    const price = parseFloat(px) > 0 ? parseFloat(px) : it.price;
    if (buy && e) {
      const stop = stopPx !== null ? Math.round(stopPx * 100) / 100 : null;
      const okOf = (c: Check) =>
        c.auto === "ema200" ? (e.ema200Pct ?? -1) > 0 : c.auto === "rsiw" ? (e.rsiW ?? 0) > 66 : c.auto === "fund" ? trig === "yes" && trigNote.trim().length >= 3
        : c.auto === "alloc" ? (e.allocPct ?? 0) > 0 && allocWhy.trim().length >= 5 : c.auto === "stop" ? stop !== null : false;
      onSaveBuy({ price, reason: reason.trim(), fundTrigger: trig === "yes" ? "yes" : "no", fundNote: trigNote.trim(), stop0: stop, stop, stopMode: useEma && emaOk ? "ema33w" : "fixed", state, allocReason: allocWhy.trim(), checks: checklist.map((c) => ({ text: c.text, ok: okOf(c) })), pending: false, priceApprox: false });
    } else onSaveSell({ price, reason: reason.trim(), state, plan, lesson: lesson.trim(), pending: false, priceApprox: false });
  };
  return (
    <div className={`border rounded-lg px-4 py-3 ${buy ? "border-emerald-300" : "border-red-300"}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
        <span className="text-sm font-semibold">{buy ? "🟢 BOUGHT" : "🔴 SOLD"} {it.symbol}</span>
        <span className="text-xs text-slate-600">{fmtQty(it.qty)} units · {it.date}{buy && e?.allocPct != null ? ` · ${fmt(e.allocPct, 2, "%")} of portfolio` : ""}{buy && e?.rsiW != null ? ` · wkly RSI ${fmt(e.rsiW, 1)}` : ""}{buy && e?.ema200Pct != null ? ` · ${fmtSigned(e.ema200Pct, 1)} vs 200D` : ""}</span>
        <label className="text-xs text-slate-500 flex items-center gap-1">
          @ ₹<input type="number" step="any" value={px} onChange={(ev) => setPx(ev.target.value)} className="w-24 px-1.5 py-0.5 border border-slate-300 rounded text-xs" />
          {it.priceApprox && <span className="text-amber-700">approx — fix it if you know the fill</span>}
        </label>
        {!buy && sale && sale.matched > 0 && <span className={`text-xs font-medium ${sign(sale.pl)}`}>{sale.pl >= 0 ? "profit" : "loss"} {R(sale.pl)} ({fmtSigned((sale.pl / sale.cost) * 100, 1)})</span>}
        <button onClick={onDrop} className="ml-auto text-[11px] text-slate-400 hover:text-red-600" title="e.g. a corporate action or something that was not a decision of yours">not a real trade — drop it</button>
      </div>
      <div className="text-[11px] text-slate-500 mb-1">{buy ? "Why did you buy it? Tap what applies" : "Why did you sell it? Tap what applies"}</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {(buy ? WHY_CHIPS : SELL_CHIPS).map((w) => <button key={w} type="button" onClick={() => setReason(togglePhrase(reason, w, "; "))} className={chip(hasPhrase(reason, w, "; "))}>{w}</button>)}
      </div>
      <input value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="…or write it in your own words (at least a sentence)" className={`${input} mb-2`} />
      {buy && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <span className="text-xs text-slate-500">Fundamental trigger?</span>
          {(["yes", "no"] as const).map((v) => <button key={v} type="button" onClick={() => setTrig(v)} className={chip(trig === v)}>{v === "yes" ? "👍 YES" : "👎 NO"}</button>)}
          {trig === "yes" && <input value={trigNote} onChange={(ev) => setTrigNote(ev.target.value)} placeholder="in a few words" className="w-56 px-2 py-1 border border-slate-300 rounded-full text-xs" />}
          <span className="text-xs text-slate-500 ml-2">Stop</span>
          {emaOk && <button type="button" onClick={() => { setUseEma(true); setStopPct(null); }} className={chip(useEma)} title="Close below the weekly 33 EMA — trails up on its own">🔔 33W EMA ₹{fmt(ema33!, 2)}</button>}
          {STOP_PCTS.map((pc) => <button key={pc} type="button" onClick={() => { setUseEma(false); setStopPct(stopPct === pc ? null : pc); }} className={chip(!useEma && stopPct === pc)}>−{pc}%</button>)}
          {stopPx !== null && <span className="text-xs text-slate-500">₹{fmt(stopPx, 2)}</span>}
          {emaOk && useEma && ema33! >= it.price && <span className="text-xs text-amber-700">price is already below the 33W EMA</span>}
        </div>
      )}
      {buy && e?.allocPct != null && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <span className="text-xs text-slate-500">Why this size?</span>
          {ALLOC_WHY.map((w) => <button key={w} type="button" onClick={() => setAllocWhy(w)} className={chip(allocWhy === w)}>{w}</button>)}
        </div>
      )}
      {!buy && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <span className="text-xs text-slate-500">Followed the plan?</span>
          {PLAN_CHIPS.map((c) => <button key={c.v} type="button" onClick={() => setPlan(c.v)} className={chip(plan === c.v)}>{c.label}</button>)}
          <input value={lesson} onChange={(ev) => setLesson(ev.target.value)} placeholder="lesson (optional)" className="w-64 px-2 py-1 border border-slate-300 rounded-full text-xs ml-2" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {STATES.map((m) => <button key={m} type="button" onClick={() => setState(m)} title={m} className={`px-2 py-1 rounded-lg text-sm border ${state === m ? "border-indigo-500 bg-indigo-600 text-white" : "border-slate-300 hover:border-slate-400"}`}>{MOODS[m]}</button>)}
        <span className="text-xs text-slate-500">{state}</span>
        <button onClick={save} disabled={!ok} className={`ml-auto px-4 py-1.5 rounded-lg text-sm font-semibold ${ok ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>Save my reason</button>
      </div>
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 mb-4">
      <div className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${done ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"}`}>{done ? "✓" : n}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-700 mb-2">{title}</div>
        {children}
      </div>
    </div>
  );
}
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const score = (e: Pick<Entry, "checks">) => (e.checks.length ? e.checks.filter((c) => c.ok).length / e.checks.length : null);
function posStats(es: Pick<Entry, "qty" | "price" | "allocPct" | "rsiW" | "date" | "checks">[]) {
  const qty = es.reduce((a, e) => a + e.qty, 0);
  const invested = es.reduce((a, e) => a + e.qty * e.price, 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const dates = es.map((e) => e.date).filter(Boolean).sort();
  return {
    n: es.length,
    qty,
    invested,
    avg: qty ? invested / qty : 0,
    alloc: es.reduce((a, e) => a + (e.allocPct ?? 0), 0),
    avgRsi: mean(es.map((e) => e.rsiW).filter((v): v is number => v !== null)),
    avgScore: mean(es.map(score).filter((v): v is number => v !== null)),
    first: dates[0] ?? "",
    last: dates[dates.length - 1] ?? "",
  };
}
const R = (v: number) => (v < 0 ? "-" : "") + "₹" + fmt(Math.abs(v), 0);
const sign = (v: number) => (v < 0 ? "text-red-600" : "text-emerald-700");
const input = "w-full px-2 py-1.5 border border-slate-300 rounded text-sm";
const num = (s: string) => (s.trim() === "" ? NaN : parseFloat(s));

function F({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      <span>{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

// Edit a saved buy (2026-10-25, "unable to edit back once added") — every field of the entry, including the checklist
// ticks and the RSI / 200D values recorded on the day. Fields are held as strings while typing and parsed on Save.
function EditEntry({ e, onSave, onCancel }: { e: Entry; onSave: (p: Partial<Entry>) => void; onCancel: () => void }) {
  const n2s = (v: number | null) => (v === null ? "" : String(v));
  const [d, setD] = useState({
    symbol: e.symbol, date: e.date, qty: String(e.qty), price: String(e.price), allocPct: n2s(e.allocPct), allocReason: e.allocReason,
    stop0: n2s(e.stop0), stop: n2s(e.stop), stopMode: (e.stopMode ?? "fixed") as "fixed" | "ema33w", target: n2s(e.target), fundTrigger: e.fundTrigger, fundNote: e.fundNote, setup: e.setup,
    state: e.state, confidence: e.confidence, reason: e.reason, rsiW: n2s(e.rsiW), ema200Pct: n2s(e.ema200Pct), checks: e.checks.map((c) => ({ ...c })),
  });
  const set = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));
  const opt = (v: string) => (v.trim() !== "" && Number.isFinite(parseFloat(v)) ? parseFloat(v) : null);
  const ok = d.symbol.trim() !== "" && parseFloat(d.qty) > 0 && parseFloat(d.price) > 0 && !!d.date && d.reason.trim().length >= 3;
  const save = () =>
    onSave({
      symbol: d.symbol.trim().toUpperCase(), date: d.date, qty: parseFloat(d.qty), price: parseFloat(d.price),
      allocPct: opt(d.allocPct), allocReason: d.allocReason.trim(), stop0: opt(d.stop0), stop: opt(d.stop), stopMode: d.stopMode, target: opt(d.target),
      fundTrigger: d.fundTrigger, fundNote: d.fundNote.trim(), setup: d.setup, state: d.state, confidence: d.confidence,
      reason: d.reason.trim(), rsiW: opt(d.rsiW), ema200Pct: opt(d.ema200Pct), checks: d.checks,
    });
  const stateOpts = STATES.includes(d.state) ? STATES : [d.state, ...STATES];
  const setupOpts = SETUPS.includes(d.setup) ? SETUPS : [d.setup, ...SETUPS];
  return (
    <div onClick={(ev) => ev.stopPropagation()}>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-3">
        <F label="Symbol"><input value={d.symbol} onChange={(ev) => set({ symbol: ev.target.value.toUpperCase() })} className={input} /></F>
        <F label="Date"><input type="date" value={d.date} onChange={(ev) => set({ date: ev.target.value })} className={input} /></F>
        <F label="Quantity"><input type="number" value={d.qty} onChange={(ev) => set({ qty: ev.target.value })} className={input} /></F>
        <F label="Buy price (₹)"><input type="number" step="any" value={d.price} onChange={(ev) => set({ price: ev.target.value })} className={input} /></F>
        <F label="Allocation (%)"><input type="number" step="any" value={d.allocPct} onChange={(ev) => set({ allocPct: ev.target.value })} className={input} /></F>
        <F label="Target (₹)"><input type="number" step="any" value={d.target} onChange={(ev) => set({ target: ev.target.value })} className={input} /></F>
        <F label="Initial stop (₹)"><input type="number" step="any" value={d.stop0} onChange={(ev) => set({ stop0: ev.target.value })} className={input} /></F>
        <F label={d.stopMode === "ema33w" ? "Stop now — the live 33W EMA" : "Stop now (₹)"}>
          <input type="number" step="any" value={d.stopMode === "ema33w" ? "" : d.stop} disabled={d.stopMode === "ema33w"} placeholder={d.stopMode === "ema33w" ? "trailing" : ""} onChange={(ev) => set({ stop: ev.target.value })} className={input} />
        </F>
        <label className="flex items-end gap-2 text-xs text-slate-600 pb-2 cursor-pointer">
          <input type="checkbox" checked={d.stopMode === "ema33w"} onChange={(ev) => set({ stopMode: ev.target.checked ? "ema33w" : "fixed" })} /> Stop = 33W EMA (trailing)
        </label>
        <F label="Weekly RSI on the day"><input type="number" step="any" value={d.rsiW} onChange={(ev) => set({ rsiW: ev.target.value })} className={input} /></F>
        <F label="% vs 200D EMA on the day"><input type="number" step="any" value={d.ema200Pct} onChange={(ev) => set({ ema200Pct: ev.target.value })} className={input} /></F>
        <F label="Setup">
          <select value={d.setup} onChange={(ev) => set({ setup: ev.target.value })} className={input}>{setupOpts.map((x) => <option key={x}>{x}</option>)}</select>
        </F>
        <F label="State of mind">
          <select value={d.state} onChange={(ev) => set({ state: ev.target.value })} className={input}>{stateOpts.map((x) => <option key={x}>{x}</option>)}</select>
        </F>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="flex flex-col gap-3">
          <F label="Reason for this allocation"><input value={d.allocReason} onChange={(ev) => set({ allocReason: ev.target.value })} className={input} /></F>
          <div className="grid grid-cols-[auto_1fr] gap-3 items-end">
            <F label="Fundamental trigger?">
              <div className="flex rounded border border-slate-300 overflow-hidden text-sm">
                {(["yes", "no"] as const).map((v) => (
                  <button key={v} type="button" onClick={() => set({ fundTrigger: v })} className={`px-4 py-1.5 ${d.fundTrigger === v ? (v === "yes" ? "bg-emerald-600 text-white" : "bg-slate-600 text-white") : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                    {v === "yes" ? "YES" : "NO"}
                  </button>
                ))}
              </div>
            </F>
            <F label="The trigger, in a few words"><input value={d.fundNote} onChange={(ev) => set({ fundNote: ev.target.value })} className={input} /></F>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            Conviction
            <input type="range" min={1} max={5} value={d.confidence} onChange={(ev) => set({ confidence: parseInt(ev.target.value, 10) })} className="accent-indigo-600" />
            <b className="text-slate-800 w-4">{d.confidence}</b>
          </label>
        </div>
        <F label="Why I bought"><textarea value={d.reason} onChange={(ev) => set({ reason: ev.target.value })} rows={6} className={input} /></F>
        <div>
          <div className="text-xs text-slate-600 mb-1">Checklist on that day</div>
          {d.checks.map((c, i) => (
            <label key={i} className="flex items-start gap-2 text-xs py-0.5 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={c.ok} onChange={(ev) => set({ checks: d.checks.map((x, j) => (j === i ? { ...x, ok: ev.target.checked } : x)) })} />
              <span className={c.ok ? "text-emerald-700" : "text-red-600"}>{c.text}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex gap-3 mt-3">
        <button onClick={save} disabled={!ok} className={`px-4 py-1.5 rounded text-sm font-medium ${ok ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>Save changes</button>
        <button onClick={onCancel} className="px-3 py-1.5 rounded text-sm border border-slate-300 text-slate-600 hover:bg-slate-50">Cancel</button>
      </div>
    </div>
  );
}

export default function TradeJournal() {
  const [doc, setDoc] = useState<Doc>({ checklist: null, entries: [], sells: [] });
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [px, setPx] = useState<{ asOf?: string; map: Map<string, any> }>({ map: new Map() });
  const dirty = useRef(false);
  const ackRef = useRef<string[]>([]); // inbox ids merged into the doc, acked only once the doc is safely saved

  const checklist = doc.checklist ?? DEFAULT_CHECKLIST;
  const [editList, setEditList] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [openPos, setOpenPos] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // portfolio value + each holding's weight as of the last PF update — what the allocation % is worked out against
  const [pf, setPf] = useState<{ value: number; as_of?: string; weights: Record<string, number> } | null>(null);
  const blankSell = () => ({ symbol: "", date: today(), qty: "", price: "", reason: "", state: STATES[0], plan: "" as "" | "yes" | "partly" | "no", lesson: "" });
  const [sf, setSf] = useState(blankSell);
  const [sellEditId, setSellEditId] = useState<string | null>(null);

  const blank = () => ({
    symbol: "", date: today(), qty: "", price: "", setup: SETUPS[0], state: STATES[0], confidence: 3,
    fundTrigger: "" as "" | "yes" | "no", fundNote: "", allocPct: "", allocReason: "", stopPct: "", stopPx: "", stopMode: "ema33w" as "fixed" | "ema33w", target: "",
    reason: "", ticks: {} as Record<string, boolean>, amount: "",
  });
  const [f, setF] = useState(blank);

  // Kite trades the PF-update skill queued (pending buy/sell placeholders) are folded into the journal, then acked after a save
  const mergeInbox = (inbox: InboxItem[]) => {
    if (!inbox.length) return;
    dirty.current = true;
    setDoc((d) => {
      const have = new Set([...d.entries.map((e) => e.id), ...d.sells.map((x) => x.id)]);
      let entries = d.entries;
      let sells = d.sells;
      for (const it of inbox) {
        if (have.has(it.id)) continue;
        const { type, ...rest } = it as any;
        if (type === "buy") entries = [rest as Entry, ...entries];
        else sells = [...sells, rest as Sell];
      }
      return { ...d, entries, sells };
    });
    ackRef.current.push(...inbox.map((i) => i.id));
  };

  useEffect(() => {
    api
      .getJournal()
      .then((d) => {
        // a stop typed then cleared used to be stored as 0 — that means "no stop"
        const nz = (v: any) => (typeof v === "number" && v > 0 ? v : null);
        setDoc({ checklist: d.checklist ?? null, entries: (d.entries ?? []).map((e: Entry) => ({ ...e, stop: nz(e.stop), stop0: nz(e.stop0) })), sells: d.sells ?? [] });
        setLoaded(true);
        setPf(d.portfolio ?? null);
        mergeInbox(d.inbox ?? []);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    api
      .getBhavTechnicals()
      .then((r) => setPx({ asOf: r.as_of, map: new Map((r.rows ?? []).map((x: any) => [x.symbol, x])) }))
      .catch(() => {});
  }, []);

  // pick up trades queued by a PF update while this page is open (every 90s and whenever the tab regains focus)
  useEffect(() => {
    if (!loaded) return;
    const pull = () =>
      api
        .getJournal()
        .then((d) => {
          setPf(d.portfolio ?? null);
          mergeInbox(d.inbox ?? []);
        })
        .catch(() => {});
    const t = window.setInterval(pull, 90000);
    window.addEventListener("focus", pull);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", pull);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // debounced save — only after the first successful load, so a failed load can never overwrite the stored journal
  useEffect(() => {
    if (!loaded || !dirty.current) return;
    setSaving("saving");
    const t = setTimeout(() => {
      const ids = ackRef.current.slice();
      api
        .setJournal(doc)
        .then(() => {
          setSaving("saved");
          if (ids.length) api.ackJournal(ids).then(() => { ackRef.current = ackRef.current.filter((i) => !ids.includes(i)); }).catch(() => {});
        })
        .catch(() => setSaving("failed"));
    }, 600);
    return () => clearTimeout(t);
  }, [doc, loaded]);

  const update = (fn: (d: Doc) => Doc) => {
    dirty.current = true;
    setDoc(fn);
  };

  // entries as displayed: a trailing-33W-EMA stop is replaced by the live EMA level from the daily store
  const ents = useMemo(
    () => doc.entries.map((e) => (e.stopMode === "ema33w" ? { ...e, stop: stopLevel(e, px.map.get(e.symbol)) } : e)),
    [doc.entries, px],
  );
  const books = useMemo(() => buildBooks(ents, doc.sells), [ents, doc.sells]);
  const sym = f.symbol.trim().toUpperCase();
  const row = px.map.get(sym);
  const qty = num(f.qty);
  const price = num(f.price);
  const ema33 = ema33Level(row); // default stop (2026-10-25): the live weekly 33 EMA
  const useEma = f.stopMode === "ema33w" && ema33 !== null;
  const stopPx = useEma ? ema33! : f.stopMode === "ema33w" ? NaN : num(f.stopPx);
  const stopPct = useEma && price > 0 ? (1 - ema33! / price) * 100 : num(f.stopPct);
  const allocAuto = pf?.value && qty > 0 && price > 0 ? (qty * price) / pf.value * 100 : null; // worked out from the PF update's portfolio value
  const allocPct = f.allocPct.trim() !== "" ? num(f.allocPct) : allocAuto ?? NaN;
  const exW = pf?.weights[sym]; // what this holding already weighs
  const ema200Pct: number | null = row && typeof row.pct_200d_ema === "number" ? row.pct_200d_ema : null;
  const rsiW: number | null = row && typeof row.rsi_w === "number" ? row.rsi_w : null;

  // what each auto-item evaluates to right now; the two market items can still be overridden by hand
  const autoOk = (c: Check): boolean | null => {
    if (c.auto === "ema200") return ema200Pct === null ? null : ema200Pct > 0;
    if (c.auto === "rsiw") return rsiW === null ? null : rsiW > 66;
    if (c.auto === "fund") return f.fundTrigger === "yes" && f.fundNote.trim().length >= 3;
    if (c.auto === "alloc") return allocPct > 0 && f.allocReason.trim().length >= 5;
    if (c.auto === "stop") return stopPx > 0 && (!(price > 0) || stopPx < price);
    return null;
  };
  const derived = (c: Check) => c.auto === "fund" || c.auto === "alloc" || c.auto === "stop";
  const tick = (c: Check) => (derived(c) ? !!autoOk(c) : f.ticks[c.id] ?? autoOk(c) ?? false);
  const ticked = checklist.filter(tick).length;

  const setStopPct = (v: string) => {
    const p = num(v);
    setF((s) => ({ ...s, stopMode: "fixed", stopPct: v, stopPx: p > 0 && p < 100 && price > 0 ? (price * (1 - p / 100)).toFixed(2) : s.stopPx }));
  };
  const setStopPx = (v: string) => {
    const x = num(v);
    setF((s) => ({ ...s, stopMode: "fixed", stopPx: v, stopPct: x > 0 && price > 0 ? ((1 - x / price) * 100).toFixed(1) : s.stopPct }));
  };
  const setBuyPrice = (v: string) => {
    const p = num(v);
    setF((s) => {
      const sp = num(s.stopPct);
      return { ...s, price: v, stopPx: p > 0 && sp > 0 && sp < 100 ? (p * (1 - sp / 100)).toFixed(2) : s.stopPx };
    });
  };

  const setQty = (v: string) => setF((s) => ({ ...s, qty: v, allocPct: pf?.value ? "" : s.allocPct, amount: num(v) > 0 && num(s.price) > 0 ? String(Math.round(num(v) * num(s.price))) : "" }));
  const setAmount = (v: string) => setF((s) => ({ ...s, amount: v, allocPct: pf?.value ? "" : s.allocPct, qty: num(v) > 0 && num(s.price) > 0 ? String(Math.floor(num(v) / num(s.price))) : s.qty }));
  // pick a target % → the quantity that gets there (the % itself then stays derived from quantity × price)
  const pickAlloc = (a: number) =>
    setF((s) => {
      const px0 = num(s.price);
      if (pf?.value && px0 > 0) {
        const q0 = Math.max(1, Math.floor((pf.value * a) / 100 / px0));
        return { ...s, allocPct: "", qty: String(q0), amount: String(Math.round(q0 * px0)) };
      }
      return { ...s, allocPct: String(a) };
    });
  // typing a symbol that has store data fills the price in — one less thing to type
  useEffect(() => {
    if (row?.price && !f.price) setBuyPrice(String(row.price));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, row?.price]);
  const emaLevels = row && typeof row.price === "number"
    ? ([["20D EMA", row.pct_20d_ema], ["50D EMA", row.pct_50d_ema], ["33W EMA", row.pct_33w_ema]] as [string, any][])
        .filter(([, p]) => typeof p === "number")
        .map(([label, p]) => ({ label, px: row.price / (1 + p / 100) }))
        .filter((l) => price > 0 && l.px < price)
    : [];

  const risk = stopPx > 0 && qty > 0 && price > 0 ? qty * (price - stopPx) : null;
  const portfolioRisk = allocPct > 0 && stopPct > 0 ? (allocPct * stopPct) / 100 : null;
  const book = books.get(sym);
  const hist = book ? book.lots.map((l) => l.entry) : [];
  const histOpen = book ? book.lots.filter((l) => l.remaining > 0).map((l) => ({ ...l.entry, qty: l.remaining })) : []; // what is still held of each buy
  const hp = posStats(histOpen);
  const lastBuy = histOpen[histOpen.length - 1];
  const livePx: number | undefined = row?.price;
  const proj = histOpen.length > 0 && qty > 0 && price > 0 ? posStats([...histOpen, { qty, price, allocPct: allocPct > 0 ? allocPct : null, rsiW, date: f.date, checks: [] }]) : null;
  const warnings: string[] = [];
  if (histOpen.length > 0 && price > 0) {
    if (price < hp.avg * 0.97) warnings.push(`Averaging DOWN: ${fmt((1 - price / hp.avg) * 100, 1, "%")} below your average of ₹${fmt(hp.avg, 2)} on ${histOpen.length} earlier buy${histOpen.length === 1 ? "" : "s"} — is the original reason still valid?`);
    else if (lastBuy && price > lastBuy.price * 1.1) warnings.push(`Adding ${fmt((price / lastBuy.price - 1) * 100, 1, "%")} above your last buy (₹${fmt(lastBuy.price, 2)}) — chasing, or a planned add on strength?`);
    if (lastBuy?.stop != null && livePx !== undefined && livePx <= lastBuy.stop) warnings.push(`Your existing stop (₹${fmt(lastBuy.stop, 2)}) is already breached — your own plan says exit, not add.`);
  }
  if (f.stopMode === "ema33w" && ema33 === null) warnings.push(sym ? "No 33W EMA data for this symbol — pick a % stop or type a price." : "No stop-loss yet — it defaults to the 33W EMA once you pick a symbol.");
  else if (!(stopPx > 0)) warnings.push("No stop-loss — decide it before you buy.");
  else if (price > 0 && stopPx >= price) warnings.push(useEma ? `Price is already below the 33W EMA (₹${fmt(ema33!, 2)}) — your default exit rule is breached before you even buy.` : "Stop-loss is not below the buy price.");
  if (ema200Pct !== null && ema200Pct <= 0) warnings.push(`Price is ${fmt(Math.abs(ema200Pct), 1, "%")} BELOW the 200D EMA.`);
  if (rsiW !== null && rsiW <= 66) warnings.push(`Weekly RSI is ${fmt(rsiW, 1)} — not above 66.`);
  if (f.fundTrigger === "no") warnings.push("No fundamental trigger — this is a pure price/momentum buy.");
  if (ticked < checklist.length) warnings.push(`${checklist.length - ticked} checklist item${checklist.length - ticked === 1 ? "" : "s"} not satisfied — make sure the reason below covers why you're buying anyway.`);
  if (f.state !== STATES[0] && f.state !== STATES[1]) warnings.push(`You marked yourself "${f.state}" — emotion, not process, may be driving this one.`);
  const stepsDone = [sym.length > 0 && price > 0, qty > 0 && allocPct > 0 && f.allocReason.trim().length >= 5, stopPx > 0 && (!(price > 0) || stopPx < price), f.fundTrigger !== "" && f.reason.trim().length >= 10, true].filter(Boolean).length;
  const canSave = sym.length > 0 && qty > 0 && price > 0 && f.reason.trim().length >= 10 && !!f.date && f.fundTrigger !== "";

  const add = () => {
    if (!canSave) return;
    const stop = stopPx > 0 ? Math.round(stopPx * 100) / 100 : null;
    const e: Entry = {
      id: uid(), symbol: sym, date: f.date, qty, price,
      allocPct: allocPct > 0 ? allocPct : null, allocReason: f.allocReason.trim(),
      stop0: stop, stop, stopMode: useEma ? "ema33w" : "fixed", target: num(f.target) > 0 ? num(f.target) : null,
      fundTrigger: f.fundTrigger as "yes" | "no", fundNote: f.fundNote.trim(),
      ema200Pct, rsiW, setup: f.setup, reason: f.reason.trim(), state: f.state, confidence: f.confidence,
      checks: checklist.map((c) => ({ text: c.text, ok: tick(c) })),
    };
    const after = [e, ...doc.entries].sort((a, b) => b.date.localeCompare(a.date));
    let streak = 0;
    while (streak < after.length && processOk(after[streak])) streak++;
    update((d) => ({ ...d, checklist: d.checklist ?? DEFAULT_CHECKLIST, entries: [e, ...d.entries] }));
    setF(blank());
    setOpen(e.id);
    setToast(processOk(e) ? `🎉 ${e.symbol} logged — by the book! Process streak: ${streak} 🔥` : `📝 ${e.symbol} logged. Not every box was ticked — review it when the trade plays out.`);
    window.setTimeout(() => setToast(null), 5000);
  };
  const patch = (id: string, p: Partial<Entry>) => update((d) => ({ ...d, entries: d.entries.map((e) => (e.id === id ? { ...e, ...p } : e)) }));
  const patchReview = (id: string, p: Partial<Review>) =>
    update((d) => ({ ...d, entries: d.entries.map((e) => (e.id === id ? { ...e, review: { exitDate: "", exitPrice: "", plan: "", lesson: "", ...e.review, ...p } } : e)) }));
  const remove = (id: string, silent = false) => {
    if (silent || window.confirm("Delete this journal entry permanently?")) update((d) => ({ ...d, entries: d.entries.filter((e) => e.id !== id) }));
  };
  const patchSell = (id: string, p: Partial<Sell>) => update((d) => ({ ...d, sells: d.sells.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const removeSell = (id: string, silent = false) => {
    if (silent || window.confirm("Delete this sale permanently?")) update((d) => ({ ...d, sells: d.sells.filter((x) => x.id !== id) }));
  };

  const positions = useMemo(() => {
    return Array.from(books.values())
      .filter((b) => b.lots.length > 0)
      .map((book) => {
        const open = book.lots.filter((l) => l.remaining > 0).map((l) => ({ ...l.entry, qty: l.remaining }));
        const lastLot = book.lots[book.lots.length - 1];
        return { sym: book.symbol, book, s: posStats(open), entries: open, last: open[open.length - 1] ?? lastLot.entry, now: px.map.get(book.symbol)?.price as number | undefined };
      })
      .sort((a, b) => (b.book.left > 0 ? 1 : 0) - (a.book.left > 0 ? 1 : 0) || b.s.invested - a.s.invested || Math.abs(b.book.realized) - Math.abs(a.book.realized));
  }, [books, px]);
  const lotById = useMemo(() => {
    const m = new Map<string, { remaining: number; sold: number; realized: number }>();
    for (const b of books.values()) for (const l of b.lots) m.set(l.entry.id, l);
    return m;
  }, [books]);
  // ---- selling ----
  const sSym = sf.symbol.trim().toUpperCase();
  const sRow = px.map.get(sSym);
  const sBook = useMemo(() => buildBooks(doc.entries, doc.sells.filter((x) => x.id !== sellEditId)).get(sSym), [doc.entries, doc.sells, sellEditId, sSym]);
  const sQty = num(sf.qty);
  const sPrice = num(sf.price);
  const sPreview = sBook && sQty > 0 && sPrice > 0 ? matchSale(sBook.lots.map((l) => ({ ...l })), { date: sf.date, qty: sQty, price: sPrice }, false) : null;
  const sLeftAfter = sBook && sPreview ? sBook.left - sPreview.matched : null;
  const sAvgAfter = sBook && sPreview && sLeftAfter ? (sBook.costLeft - sPreview.cost) / sLeftAfter : null;
  const canSell = sSym.length > 0 && sQty > 0 && sPrice > 0 && sf.reason.trim().length >= 10 && !!sf.date;
  const sellWarnings: string[] = [];
  if (sSym && !sBook) sellWarnings.push("This symbol isn't in your journal — the sale is recorded, but its profit/loss can't be worked out. Log the original buy for a full picture.");
  if (sBook && sBook.left > 0 && sQty > sBook.left) sellWarnings.push(`You only hold ${fmtQty(sBook.left)} per the journal — ${fmtQty(sQty - sBook.left)} of this sale has no buy to match.`);
  if (sf.state !== STATES[0] && sf.state !== STATES[1]) sellWarnings.push(`You marked yourself "${sf.state}" — is this the plan or the emotion selling?`);
  if (sf.reason && !sf.plan) sellWarnings.push("Say whether this sale follows your plan.");
  useEffect(() => {
    if (sRow?.price && !sf.price && !sellEditId) setSf((v) => ({ ...v, price: String(sRow.price) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sSym, sRow?.price]);
  const addSale = () => {
    if (!canSell) return;
    const x: Sell = { id: sellEditId ?? uid(), symbol: sSym, date: sf.date, qty: sQty, price: sPrice, reason: sf.reason.trim(), state: sf.state, plan: sf.plan, lesson: sf.lesson.trim() };
    update((d) => ({ ...d, sells: sellEditId ? d.sells.map((y) => (y.id === sellEditId ? x : y)) : [...d.sells, x] }));
    setToast(sPreview && sPreview.matched > 0 ? `${sPreview.pl >= 0 ? "💰" : "📉"} ${sSym} sale logged — ${sPreview.pl >= 0 ? "profit" : "loss"} ${R(sPreview.pl)} (${fmtSigned((sPreview.pl / sPreview.cost) * 100, 1)}). ${x.plan === "yes" ? "By the plan. 👏" : "Review it when you have a minute."}` : `📝 ${sSym} sale logged.`);
    window.setTimeout(() => setToast(null), 5000);
    setSf(blankSell());
    setSellEditId(null);
  };
  const pendingBuys = doc.entries.filter((e) => e.pending);
  const pendingSells = doc.sells.filter((x) => x.pending);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return ents.filter((e) => !n || e.symbol.toLowerCase().includes(n) || e.reason.toLowerCase().includes(n) || e.setup.toLowerCase().includes(n)).sort((a, b) => b.date.localeCompare(a.date));
  }, [ents, q]);

  const alerts = useMemo(() => {
    const hit: { e: Entry; p: number }[] = [];
    const near: { e: Entry; p: number }[] = [];
    const rearm: string[] = []; // entries whose cleared alert no longer applies (stock is fine again) — the clear is dropped
    let hidden = 0;
    for (const e of ents) {
      if ((lotById.get(e.id)?.remaining ?? e.qty) <= 0) continue; // fully sold — nothing left to stop out
      const p = px.map.get(e.symbol)?.price;
      const st = stopState(e, p);
      if (e.alertAck && st === "ok") rearm.push(e.id);
      if (alertHidden(e, st)) {
        hidden++;
        continue;
      }
      if (st === "hit") hit.push({ e, p });
      else if (st === "near") near.push({ e, p });
    }
    return { hit, near, hidden, rearm };
  }, [ents, px, lotById]);
  // drop clears that went stale (the stock recovered, or got worse) so the alert can fire again next time
  useEffect(() => {
    if (!loaded || alerts.rearm.length === 0) return;
    update((d) => ({ ...d, entries: d.entries.map((e) => (alerts.rearm.includes(e.id) ? { ...e, alertAck: undefined } : e)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts.rearm.join(","), loaded]);
  const clearAlerts = (items: { e: Entry }[], state: "hit" | "near", snoozeDays?: number) => {
    const until = snoozeDays ? new Date(Date.now() + snoozeDays * 86400000).toISOString().slice(0, 10) : undefined;
    const ids = new Set(items.map((i) => i.e.id));
    update((d) => ({ ...d, entries: d.entries.map((e) => (ids.has(e.id) ? { ...e, alertAck: until ? { state, until } : { state } } : e)) }));
  };
  const showHidden = () => update((d) => ({ ...d, entries: d.entries.map((e) => (e.alertAck ? { ...e, alertAck: undefined } : e)) }));

  const streak = useMemo(() => {
    const es = doc.entries.filter((e) => !e.pending).sort((a, b) => b.date.localeCompare(a.date));
    let cur = 0;
    while (cur < es.length && processOk(es[cur])) cur++;
    let best = 0;
    let run = 0;
    for (const e of [...es].reverse()) {
      run = processOk(e) ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return { cur, best };
  }, [doc.entries]);

  const stats = useMemo(() => {
    const es = doc.entries.filter((e) => !e.pending);
    // every completed sale (and every buy closed through the older exit box) is one outcome
    const outcomes: { win: boolean; plan: string }[] = [];
    let realized = 0;
    for (const b of books.values()) {
      realized += b.realized;
      for (const sr of b.sales) if (sr.matched > 0 && !sr.sell.pending) outcomes.push({ win: sr.pl > 0, plan: sr.sell.plan });
      for (const l of b.lots) if (isClosed(l.entry)) outcomes.push({ win: l.realized > 0, plan: l.entry.review?.plan ?? "" });
    }
    const avg = (xs: Entry[]) => {
      const sc = xs.map(score).filter((v): v is number => v !== null);
      return sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : null;
    };
    const lots = Array.from(books.values()).flatMap((b) => b.lots).filter((l) => l.sold > 0 && !l.entry.pending);
    return {
      n: es.length,
      withStop: es.length ? es.filter((e) => e.stop0 !== null).length / es.length : null,
      avgScore: avg(es),
      closed: outcomes.length,
      realized,
      winRate: outcomes.length ? outcomes.filter((o) => o.win).length / outcomes.length : null,
      scoreWin: avg(lots.filter((l) => l.realized > 0).map((l) => l.entry)),
      scoreLose: avg(lots.filter((l) => l.realized <= 0).map((l) => l.entry)),
      followed: outcomes.length ? outcomes.filter((o) => o.plan === "yes").length / outcomes.length : null,
    };
  }, [doc.entries, books]);

  const pct = (v: number | null) => (v === null ? "—" : fmt(v * 100, 0, "%"));
  const th = "text-center px-2 py-2 border-b border-slate-200 sticky top-0 bg-white text-xs text-slate-500 font-normal";
  const td = "px-2 py-1.5 text-right tabular-nums";

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-3 mb-1">
        <h1 className="text-lg font-semibold">📓 Trade Journal</h1>
        <span className="text-xs text-slate-500">Checklist before the buy, the reason on the record, a review after — so process, not emotion, makes the call</span>
        <span className={`text-xs ml-auto ${saving === "failed" ? "text-red-600" : "text-slate-400"}`}>
          {saving === "saving" ? "saving…" : saving === "saved" ? "saved ✓" : saving === "failed" ? "save failed — retry by editing again" : ""}
        </span>
      </div>
      {err && <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">Could not load your journal ({err}). Nothing is saved until it loads — reload the page.</div>}

      {(alerts.hit.length > 0 || alerts.near.length > 0 || alerts.hidden > 0) && (
        <div className="my-3 space-y-2">
          {alerts.hit.map((it) => (
            <div key={it.e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-red-700 bg-red-50 border border-red-300 rounded px-3 py-2">
              <span>
                🛑 <b>{it.e.symbol}</b> closed at ₹{fmt(it.p, 2)} — at or below your stop of ₹{fmt(it.e.stop!, 2)}{it.e.stopMode === "ema33w" ? " (the 33W EMA)" : ""}. Your plan said to exit.
              </span>
              <span className="ml-auto flex items-center gap-2 text-xs whitespace-nowrap">
                <button onClick={() => { setSellEditId(null); setSf({ ...blankSell(), symbol: it.e.symbol, price: String(it.p) }); document.getElementById("tj-sell")?.scrollIntoView({ behavior: "smooth" }); }} className="px-2 py-1 rounded border border-red-400 hover:bg-red-100">💸 log the sale</button>
                <button onClick={() => clearAlerts([it], "hit", 7)} className="px-2 py-1 rounded border border-slate-400 text-slate-600 hover:bg-slate-100" title="hide this alert for 7 days">💤 snooze 7d</button>
                <button onClick={() => clearAlerts([it], "hit")} className="px-2 py-1 rounded border border-slate-400 text-slate-600 hover:bg-slate-100" title="hide until it changes — it comes back if the stock recovers and falls through the stop again">✕ dismiss</button>
              </span>
            </div>
          ))}
          {alerts.near.map((it) => (
            <div key={it.e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-amber-800 bg-amber-50 border border-amber-300 rounded px-3 py-2">
              <span>
                ⚠️ <b>{it.e.symbol}</b> at ₹{fmt(it.p, 2)} is within {NEAR_PCT}% of your stop (₹{fmt(it.e.stop!, 2)}{it.e.stopMode === "ema33w" ? ", the 33W EMA" : ""}).
              </span>
              <span className="ml-auto flex items-center gap-2 text-xs whitespace-nowrap">
                <button onClick={() => clearAlerts([it], "near", 7)} className="px-2 py-1 rounded border border-slate-400 text-slate-600 hover:bg-slate-100">💤 snooze 7d</button>
                <button onClick={() => clearAlerts([it], "near")} className="px-2 py-1 rounded border border-slate-400 text-slate-600 hover:bg-slate-100">✕ dismiss</button>
              </span>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
            <span>Based on the last close in the daily store{px.asOf ? ` (${px.asOf})` : ""}, refreshed each evening — not a live stop order.</span>
            {alerts.hit.length + alerts.near.length > 1 && (
              <button onClick={() => { clearAlerts(alerts.hit, "hit"); clearAlerts(alerts.near, "near"); }} className="text-slate-500 hover:underline">✕ dismiss all</button>
            )}
            {alerts.hidden > 0 && <button onClick={showHidden} className="text-slate-500 hover:underline">{alerts.hidden} cleared alert{alerts.hidden === 1 ? "" : "s"} · show again</button>}
          </div>
        </div>
      )}

      {(pendingBuys.length > 0 || pendingSells.length > 0) && (
        <div className="my-3 p-4 border border-indigo-400 rounded-lg">
          <div className="text-sm font-semibold mb-1">✍️ {pendingBuys.length + pendingSells.length} Kite trade{pendingBuys.length + pendingSells.length === 1 ? "" : "s"} waiting for your reason</div>
          <div className="text-xs text-slate-500 mb-3">The PF update found these in your holdings and recorded them. The numbers are in — the point of the journal is the <i>why</i>, so say it while you still remember it.</div>
          <div className="space-y-3">
            {pendingBuys.map((e) => (
              <QuickComment key={e.id} e={e} ema33={ema33Level(px.map.get(e.symbol))} checklist={checklist} onSaveBuy={(p) => patch(e.id, p)} onSaveSell={() => {}} onDrop={() => remove(e.id, true)} />
            ))}
            {pendingSells.map((x) => (
              <QuickComment key={x.id} x={x} sale={books.get(x.symbol)?.sales.find((r) => r.sell.id === x.id)} checklist={checklist} onSaveBuy={() => {}} onSaveSell={(p) => patchSell(x.id, p)} onDrop={() => removeSell(x.id, true)} />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4 bg-slate-50 rounded-lg p-4 my-3">
        <div>
          <div className="text-xs text-slate-500">Buys logged</div>
          <div className="text-lg font-semibold tabular-nums">{stats.n}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Had a stop-loss</div>
          <div className="text-lg font-semibold tabular-nums">{pct(stats.withStop)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Avg checklist score</div>
          <div className="text-lg font-semibold tabular-nums">{pct(stats.avgScore)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Closed trades</div>
          <div className="text-lg font-semibold tabular-nums">{stats.closed}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Realized P/L</div>
          <div className={`text-lg font-semibold tabular-nums ${stats.realized === 0 ? "" : sign(stats.realized)}`}>{stats.closed ? R(stats.realized) : "—"}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Win rate (closed)</div>
          <div className="text-lg font-semibold tabular-nums">{pct(stats.winRate)}</div>
        </div>
        <div title="Average checklist score of the winners vs the losers — if winners score higher, the checklist is earning its keep">
          <div className="text-xs text-slate-500">Score: winners / losers</div>
          <div className="text-lg font-semibold tabular-nums">
            {pct(stats.scoreWin)} <span className="text-sm font-medium text-slate-500">/ {pct(stats.scoreLose)}</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Followed the plan</div>
          <div className="text-lg font-semibold tabular-nums">{pct(stats.followed)}</div>
        </div>
      </div>

      {/* new buy — a guided, tap-first flow */}
      {toast && <div className="mb-3 text-sm text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-lg px-4 py-2.5">{toast}</div>}
      <div className="p-4 border border-slate-200 rounded-lg mb-4">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="text-base font-semibold text-slate-700">🚀 Log a buy</div>
          <span className="text-xs text-slate-500" title="Consecutive latest buys that had a stop-loss, a named trigger, a calm head and 70%+ of the checklist">
            🔥 process streak <b className="text-slate-800">{streak.cur}</b> · best {streak.best}
          </span>
          <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-400">
            <div className="w-32 h-1.5 bg-slate-200 rounded"><div className="h-1.5 rounded bg-emerald-500 transition-all" style={{ width: `${(stepsDone / 5) * 100}%` }} /></div>
            {stepsDone}/5 steps
          </div>
        </div>

        <Step n={1} title="🎯 What are you buying?" done={sym.length > 0 && price > 0}>
          <div className="flex flex-wrap items-end gap-3 mb-2">
            <div className="w-44">
              <input list="tj-syms" value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase(), ticks: {}, price: "", stopPx: "", amount: "" })} className={`${input} !text-base font-semibold`} placeholder="Symbol — e.g. KPRMILL" />
              <datalist id="tj-syms">{Array.from(px.map.keys()).slice(0, 4000).map((x) => <option key={x} value={x} />)}</datalist>
            </div>
            <div className="w-40"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={input} /></div>
            <div className="w-36">
              <F label="Buy price (₹)" hint={row?.price ? `store close ₹${fmt(row.price, 2)}` : undefined}>
                <input type="number" step="any" value={f.price} onChange={(e) => setBuyPrice(e.target.value)} className={input} />
              </F>
            </div>
            <div className="flex flex-wrap gap-2 pb-1">
              <span className={`px-2.5 py-1 rounded-full text-xs border ${ema200Pct === null ? "border-slate-300 text-slate-400" : ema200Pct > 0 ? "border-emerald-400 text-emerald-700" : "border-red-300 text-red-600"}`}>
                {ema200Pct === null ? "200D EMA —" : `${ema200Pct > 0 ? "✅" : "⚠️"} 200D EMA ${fmtSigned(ema200Pct, 1)}`}
              </span>
              <span className={`px-2.5 py-1 rounded-full text-xs border ${rsiW === null ? "border-slate-300 text-slate-400" : rsiW > 66 ? "border-emerald-400 text-emerald-700" : "border-red-300 text-red-600"}`}>
                {rsiW === null ? "Weekly RSI —" : `${rsiW > 66 ? "✅" : "⚠️"} Weekly RSI ${fmt(rsiW, 1)}`}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SETUPS.map((x) => <button key={x} type="button" onClick={() => setF({ ...f, setup: x })} className={chip(f.setup === x)}>{x}</button>)}
          </div>
        </Step>

        {hist.length > 0 && (
          <div className="mb-3 p-3 border border-slate-200 rounded-lg bg-slate-50">
            <div className="text-sm font-medium text-slate-700 mb-2">
              📚 Your history in {sym} — {hist.length} earlier buy{hist.length === 1 ? "" : "s"} ({histOpen.length} still open)
            </div>
            {histOpen.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-2">
                <div><div className="text-[11px] text-slate-500">Open quantity</div><div className="font-semibold tabular-nums">{fmt(hp.qty, 0)}</div></div>
                <div><div className="text-[11px] text-slate-500">Average price</div><div className="font-semibold tabular-nums">₹{fmt(hp.avg, 2)}</div></div>
                <div><div className="text-[11px] text-slate-500">Invested</div><div className="font-semibold tabular-nums">{R(hp.invested)}</div></div>
                <div><div className="text-[11px] text-slate-500">Allocated so far</div><div className="font-semibold tabular-nums">{hp.alloc > 0 ? fmt(hp.alloc, 1, "%") : "—"}</div></div>
                <div>
                  <div className="text-[11px] text-slate-500">Now</div>
                  <div className="font-semibold tabular-nums">
                    {livePx !== undefined ? <>₹{fmt(livePx, 2)} <span className={`text-xs ${sign(livePx / hp.avg - 1)}`}>{fmtSigned((livePx / hp.avg - 1) * 100, 1)}</span></> : "—"}
                  </div>
                </div>
                <div><div className="text-[11px] text-slate-500">Last buy</div><div className="font-semibold tabular-nums">{lastBuy ? `${lastBuy.date} @ ₹${fmt(lastBuy.price, 2)}` : "—"}</div></div>
                <div><div className="text-[11px] text-slate-500">Avg weekly RSI at buys</div><div className="font-semibold tabular-nums">{hp.avgRsi !== null ? fmt(hp.avgRsi, 1) : "—"}</div></div>
              </div>
            )}
            {proj && (
              <div className="text-xs text-slate-700 bg-white border border-slate-200 rounded px-3 py-1.5 mb-2">
                <b>If this buy goes ahead:</b> {fmt(proj.qty, 0)} units at an average of <b>₹{fmt(proj.avg, 2)}</b> ({hp.avg > 0 ? fmtSigned((proj.avg / hp.avg - 1) * 100, 1) : "—"} vs now), {R(proj.invested)} invested
                {proj.alloc > 0 ? <>, total allocation <b>{fmt(proj.alloc, 1, "%")}</b></> : ""}.
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse w-full" style={{ minWidth: 900 }}>
                <thead>
                  <tr className="text-slate-500">
                    <th className="text-left px-2 py-1 font-normal">Date</th>
                    <th className="text-right px-2 py-1 font-normal">Qty</th>
                    <th className="text-right px-2 py-1 font-normal">Price</th>
                    <th className="text-right px-2 py-1 font-normal">Alloc</th>
                    <th className="text-right px-2 py-1 font-normal">Stop</th>
                    <th className="text-right px-2 py-1 font-normal">Wkly RSI</th>
                    <th className="text-right px-2 py-1 font-normal">vs 200D</th>
                    <th className="text-left px-2 py-1 font-normal">State</th>
                    <th className="text-left px-2 py-1 font-normal">Status</th>
                    <th className="text-left px-2 py-1 font-normal">Why I bought</th>
                  </tr>
                </thead>
                <tbody>
                  {hist.map((e) => {
                    const lot = book?.lots.find((l) => l.entry.id === e.id);
                    const realPct = lot && lot.sold > 0 ? (lot.realized / (lot.sold * e.price)) * 100 : null;
                    return (
                      <tr key={e.id} className="border-t border-slate-200 align-top">
                        <td className="px-2 py-1 tabular-nums whitespace-nowrap">{e.date}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmt(e.qty, 0)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmt(e.price, 2)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{e.allocPct !== null ? fmt(e.allocPct, 1, "%") : "—"}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{e.stop !== null ? fmt(e.stop, 2) : "—"}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{e.rsiW !== null ? fmt(e.rsiW, 1) : "—"}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{e.ema200Pct !== null ? fmtSigned(e.ema200Pct, 1) : "—"}</td>
                        <td className="px-2 py-1">{e.state}</td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {lot && lot.remaining <= 0 && realPct !== null ? <span className={sign(realPct)}>sold out {fmtSigned(realPct, 1)}</span> : lot && realPct !== null ? <span className="text-slate-500">{fmtQty(lot.remaining)} left · sold part {fmtSigned(realPct, 1)}</span> : <span className="text-slate-500">open</span>}
                        </td>
                        <td className="px-2 py-1 max-w-[28rem]">
                          {e.fundNote && <b className="text-emerald-700">{e.fundTrigger === "yes" ? "Trigger: " : ""}{e.fundNote} · </b>}
                          {e.reason}
                          {e.review?.lesson && <div className="text-slate-500 mt-0.5">Lesson: {e.review.lesson}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <Step n={2} title="💰 How much?" done={qty > 0 && allocPct > 0 && f.allocReason.trim().length >= 5}>
          <div className="flex flex-wrap items-end gap-3 mb-2">
            <div className="w-28"><F label="Quantity"><input type="number" value={f.qty} onChange={(e) => setQty(e.target.value)} className={input} /></F></div>
            <div className="w-32"><F label="or ₹ amount"><input type="number" value={f.amount} onChange={(e) => setAmount(e.target.value)} className={input} /></F></div>
            <div className="text-xs text-slate-500 pb-2">{qty > 0 && price > 0 ? `≈ ${R(qty * price)} · ${fmt(qty, 0)} units` : "type units or an amount — the other follows"}</div>
          </div>
          <div className="text-[11px] text-slate-500 mb-1">
            Allocation — % of portfolio{" "}
            {pf?.value ? <span className="text-slate-400">· worked out from your last PF update ({pf.as_of}, ₹{fmt(pf.value / 1e5, 1)}L) — tap a % to size the buy, or type units</span> : <span className="text-amber-700">· run the PF update once and this fills itself; type it for now</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            {ALLOCS.map((a) => <button key={a} type="button" onClick={() => pickAlloc(a)} className={chip(Number.isFinite(allocPct) && Math.abs(allocPct - a) < (pf?.value ? 0.15 : 0.001))}>{a}%</button>)}
            <span className={`px-3 py-1 rounded-full text-xs border ${Number.isFinite(allocPct) && allocPct > 0 ? "border-emerald-400 text-emerald-700" : "border-slate-300 text-slate-400"}`}>
              {Number.isFinite(allocPct) && allocPct > 0 ? `= ${fmt(allocPct, 2, "%")} of portfolio` : "= —"}
            </span>
            {!pf?.value && <input type="number" step="any" value={f.allocPct} onChange={(e) => setF({ ...f, allocPct: e.target.value })} placeholder="other %" className="w-24 px-2 py-1 border border-slate-300 rounded-full text-xs" />}
            {exW !== undefined && Number.isFinite(allocPct) && allocPct > 0 && <span className="text-xs text-slate-500">· already {fmt(exW, 2, "%")} → <b className="text-slate-800">{fmt(exW + allocPct, 2, "%")}</b> after this buy</span>}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {ALLOC_WHY.map((w) => <button key={w} type="button" onClick={() => setF({ ...f, allocReason: w })} className={chip(f.allocReason === w)}>{w}</button>)}
          </div>
          <input value={f.allocReason} maxLength={120} onChange={(e) => setF({ ...f, allocReason: e.target.value })} placeholder="why this size? (tap one above or type)" className={input} />
        </Step>

        <Step n={3} title="🛑 Where's the exit?" done={stopPx > 0 && (!(price > 0) || stopPx < price)}>
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <button type="button" onClick={() => setF({ ...f, stopMode: "ema33w" })} disabled={ema33 === null} className={`${chip(useEma)} ${ema33 === null ? "opacity-50" : ""}`} title="Your default exit: close below the weekly 33 EMA. It trails up on its own.">
              🔔 33W EMA{ema33 !== null ? ` ₹${fmt(ema33, 2)}` : " (no data)"} · trailing
            </button>
            {STOP_PCTS.map((pc) => <button key={pc} type="button" onClick={() => setStopPct(String(pc))} className={chip(!useEma && stopPct === pc)}>−{pc}%</button>)}
            {emaLevels.filter((l) => l.label !== "33W EMA").map((l) => (
              <button key={l.label} type="button" onClick={() => setStopPx(l.px.toFixed(2))} className={chip(!useEma && Math.abs(stopPx - l.px) < 0.01)} title={`Stop just under the ${l.label}`}>
                {l.label} ₹{fmt(l.px, 2)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-28"><F label="Stop (% below)"><input type="number" step="any" value={useEma ? (stopPct > 0 ? stopPct.toFixed(1) : "") : f.stopPct} onChange={(e) => setStopPct(e.target.value)} className={input} /></F></div>
            <div className="w-32"><F label="Stop price (₹)" hint={useEma ? "= 33W EMA, trailing" : undefined}><input type="number" step="any" value={useEma ? stopPx.toFixed(2) : f.stopPx} onChange={(e) => setStopPx(e.target.value)} className={input} /></F></div>
            <div className="w-32"><F label="Target (₹, optional)"><input type="number" step="any" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} className={input} /></F></div>
            {stopPx > 0 && price > stopPx && (
              <div className="flex gap-1.5 pb-1">
                {[2, 3].map((k) => <button key={k} type="button" onClick={() => setF({ ...f, target: (price + k * (price - stopPx)).toFixed(2) })} className={chip(Math.abs(num(f.target) - (price + k * (price - stopPx))) < 0.01)}>target {k}R</button>)}
              </div>
            )}
            <div className="text-xs text-slate-500 pb-2">
              {risk !== null ? <>you risk <b className="text-slate-800">{R(risk)}</b></> : "pick a % or type a price"}
              {portfolioRisk !== null ? <> · <b className="text-slate-800">{fmt(portfolioRisk, 2, "%")}</b> of portfolio</> : ""}
            </div>
          </div>
        </Step>

        <Step n={4} title="🧠 Why this one?" done={f.fundTrigger !== "" && f.reason.trim().length >= 10}>
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span className="text-xs text-slate-500 mr-1">Fundamental trigger?</span>
            {(["yes", "no"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setF({ ...f, fundTrigger: v })} className={`px-3 py-1 rounded-full text-xs border ${f.fundTrigger === v ? (v === "yes" ? "bg-emerald-600 border-emerald-600 text-white" : "bg-slate-600 border-slate-600 text-white") : "border-slate-300 text-slate-600 hover:border-slate-400"}`}>
                {v === "yes" ? "👍 YES" : "👎 NO"}
              </button>
            ))}
            {f.fundTrigger === "yes" && FUND_CHIPS.map((c) => <button key={c} type="button" onClick={() => setF({ ...f, fundNote: togglePhrase(f.fundNote, c, " · ") })} className={chip(hasPhrase(f.fundNote, c, " · "))}>{c}</button>)}
          </div>
          {f.fundTrigger === "yes" && <input value={f.fundNote} onChange={(e) => setF({ ...f, fundNote: e.target.value })} placeholder="the trigger in a few words — e.g. Q2 sales +38%" className={`${input} mb-2`} />}
          <div className="text-[11px] text-slate-500 mb-1">Tap what applies — it writes the reason for you; edit freely below</div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {WHY_CHIPS.map((w) => <button key={w} type="button" onClick={() => setF({ ...f, reason: togglePhrase(f.reason, w, "; ") })} className={chip(hasPhrase(f.reason, w, "; "))}>{w}</button>)}
          </div>
          <textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} rows={3} placeholder="Why am I buying this, in my own words — this is what I'll judge myself against later." className={input} />
        </Step>

        <Step n={5} title="😌 How are you feeling?" done>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {STATES.map((m) => (
              <button key={m} type="button" onClick={() => setF({ ...f, state: m })} className={`px-3 py-1.5 rounded-lg text-xs border ${f.state === m ? "border-indigo-500 bg-indigo-600 text-white" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}>
                <span className="text-base mr-1">{MOODS[m]}</span>{m}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 text-xs text-slate-500">
            Conviction
            {[1, 2, 3, 4, 5].map((k) => (
              <button key={k} type="button" onClick={() => setF({ ...f, confidence: k })} className={`text-xl leading-none ${k <= f.confidence ? "text-amber-500" : "text-slate-300"}`} title={`${k}/5`}>★</button>
            ))}
          </div>
        </Step>

        <div className="border-t border-slate-200 pt-3 grid lg:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1.5">
              <span className="text-xs text-slate-600">Checklist — <b className={ticked === checklist.length ? "text-emerald-700" : "text-amber-700"}>{ticked}/{checklist.length}</b></span>
              <div className="flex-1 h-1.5 bg-slate-200 rounded max-w-[10rem]"><div className={`h-1.5 rounded ${ticked === checklist.length ? "bg-emerald-500" : ticked / checklist.length >= 0.7 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${(ticked / Math.max(checklist.length, 1)) * 100}%` }} /></div>
            </div>
            {checklist.map((c) => {
              const d = derived(c);
              const on = tick(c);
              return (
                <label key={c.id} className={`flex items-start gap-2 text-sm py-0.5 ${d ? "" : "cursor-pointer"}`}>
                  <input type="checkbox" className="mt-1" checked={on} disabled={d} onChange={(e) => setF({ ...f, ticks: { ...f.ticks, [c.id]: e.target.checked } })} />
                  <span className={on ? "" : "text-slate-500"}>
                    {c.text}
                    {c.auto === "ema200" && ema200Pct !== null && <span className="ml-1 text-xs text-slate-400">({fmtSigned(ema200Pct, 1)} vs 200D)</span>}
                    {c.auto === "rsiw" && rsiW !== null && <span className="ml-1 text-xs text-slate-400">(RSI {fmt(rsiW, 1)})</span>}
                    {d && <span className="ml-1 text-[10px] text-slate-400">auto</span>}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="flex flex-col gap-3">
            {warnings.length > 0 ? (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                <div className="font-medium mb-1">👀 Heads up before you log it</div>
                <ul className="list-disc pl-5 space-y-0.5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </div>
            ) : (
              <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-300 rounded px-3 py-2">✨ Everything lines up — stop set, trigger named, checklist complete.</div>
            )}
            <div>
              <button onClick={add} disabled={!canSave || !loaded} className={`px-5 py-2.5 rounded-lg text-sm font-semibold ${canSave && loaded ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
                🚀 Log it
              </button>
              <span className="text-[11px] text-slate-400 ml-3">
                {!canSave ? "Still needed: " + [!(sym.length > 0) && "symbol", !(price > 0) && "price", !(qty > 0) && "quantity", f.fundTrigger === "" && "trigger yes/no", f.reason.trim().length < 10 && "a reason"].filter(Boolean).join(", ") + " · " : ""}Records the trade only — it does not place an order.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* checklist editor */}
      <div className="mb-4">
        <button onClick={() => setEditList((v) => !v)} className="text-sm text-indigo-600 hover:underline">
          {editList ? "▾ Hide checklist editor" : "▸ Edit my checklist"}
        </button>
        {editList && (
          <div className="mt-2 p-4 border border-slate-200 rounded-lg">
            <div className="text-[11px] text-slate-500 mb-2">
              Changes apply to new buys; past entries keep the exact items that were on the list when you made them. Items marked auto fill themselves from the store / the fields above — you can reword them but not make them manual.
            </div>
            {checklist.map((c, i) => (
              <div key={c.id} className="flex items-center gap-2 mb-1.5">
                <span className="text-xs text-slate-400 w-5 text-right">{i + 1}</span>
                <input value={c.text} onChange={(e) => update((d) => ({ ...d, checklist: (d.checklist ?? DEFAULT_CHECKLIST).map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)) }))} className={input} />
                {c.auto && <span className="text-[10px] text-slate-400">auto</span>}
                <button title="move up" disabled={i === 0} onClick={() => update((d) => { const l = [...(d.checklist ?? DEFAULT_CHECKLIST)]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; return { ...d, checklist: l }; })} className="text-slate-400 hover:text-slate-700 disabled:opacity-30">↑</button>
                <button title="remove" onClick={() => update((d) => ({ ...d, checklist: (d.checklist ?? DEFAULT_CHECKLIST).filter((x) => x.id !== c.id) }))} className="text-slate-400 hover:text-red-600">✕</button>
              </div>
            ))}
            <div className="flex gap-3 mt-2">
              <button onClick={() => update((d) => ({ ...d, checklist: [...(d.checklist ?? DEFAULT_CHECKLIST), { id: uid(), text: "" }] }))} className="text-sm text-indigo-600 hover:underline">＋ Add an item</button>
              <button onClick={() => update((d) => ({ ...d, checklist: DEFAULT_CHECKLIST }))} className="text-xs text-slate-500 hover:underline">reset to the starting list</button>
            </div>
          </div>
        )}
      </div>

      {/* sell */}
      <div id="tj-sell" className="p-4 border border-slate-200 rounded-lg mb-4">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="text-base font-semibold text-slate-700">{sellEditId ? "✎ Edit a sale" : "💸 Log a sale"}</div>
          <span className="text-xs text-slate-500">matched to your buys oldest-first (FIFO), so every buy shows what it realised</span>
          {sellEditId && <button onClick={() => { setSellEditId(null); setSf(blankSell()); }} className="text-xs text-slate-500 hover:underline ml-auto">cancel edit</button>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <span className="text-xs text-slate-500 mr-1">Holding:</span>
          {positions.filter((p) => p.book.left > 0).map((p) => (
            <button key={p.sym} type="button" onClick={() => setSf({ ...blankSell(), symbol: p.sym, price: px.map.get(p.sym)?.price ? String(px.map.get(p.sym).price) : "" })} className={chip(sSym === p.sym)}>
              {p.sym} · {fmtQty(p.book.left)}
            </button>
          ))}
          {positions.every((p) => p.book.left <= 0) && <span className="text-xs text-slate-400">no open positions in the journal yet</span>}
        </div>
        <div className="flex flex-wrap items-end gap-3 mb-2">
          <div className="w-40">
            <F label="Symbol"><input list="tj-syms" value={sf.symbol} onChange={(e) => setSf({ ...sf, symbol: e.target.value.toUpperCase(), price: "" })} className={input} /></F>
          </div>
          <div className="w-40"><F label="Date"><input type="date" value={sf.date} onChange={(e) => setSf({ ...sf, date: e.target.value })} className={input} /></F></div>
          <div className="w-28"><F label="Quantity"><input type="number" value={sf.qty} onChange={(e) => setSf({ ...sf, qty: e.target.value })} className={input} /></F></div>
          <div className="w-32"><F label="Sell price (₹)" hint={sRow?.price ? `store close ₹${fmt(sRow.price, 2)}` : undefined}><input type="number" step="any" value={sf.price} onChange={(e) => setSf({ ...sf, price: e.target.value })} className={input} /></F></div>
          {sBook && sBook.left > 0 && (
            <div className="flex flex-wrap gap-1.5 pb-1">
              {([["¼", 0.25], ["⅓", 1 / 3], ["½", 0.5], ["¾", 0.75], ["All", 1]] as [string, number][]).map(([l, fr]) => {
                const q = fr === 1 ? sBook.left : Math.max(1, Math.floor(sBook.left * fr));
                return <button key={l} type="button" onClick={() => setSf({ ...sf, qty: String(q) })} className={chip(sQty === q)} title={`${fmtQty(q)} units`}>{l}</button>;
              })}
            </div>
          )}
        </div>
        {sBook && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs bg-slate-50 rounded px-3 py-2 mb-3">
            <div><div className="text-slate-500">Held now</div><b>{fmtQty(sBook.left)}</b> at ₹{fmt(sBook.avgLeft, 2)}</div>
            <div><div className="text-slate-500">Bought / sold so far</div><b>{fmtQty(sBook.bought)}</b> / {fmtQty(sBook.sold)}</div>
            <div><div className="text-slate-500">Now</div><b>{sRow?.price ? `₹${fmt(sRow.price, 2)}` : "—"}</b>{sRow?.price && sBook.left > 0 ? <span className={`ml-1 ${sign(sRow.price / sBook.avgLeft - 1)}`}>{fmtSigned((sRow.price / sBook.avgLeft - 1) * 100, 1)}</span> : null}</div>
            {sPreview && sPreview.matched > 0 && (
              <>
                <div><div className="text-slate-500">This sale realises</div><b className={sign(sPreview.pl)}>{R(sPreview.pl)} ({fmtSigned((sPreview.pl / sPreview.cost) * 100, 1)})</b></div>
                <div><div className="text-slate-500">Avg cost sold</div><b>₹{fmt(sPreview.cost / sPreview.matched, 2)}</b>{sPreview.heldDays !== null ? <span className="text-slate-400"> · held ~{sPreview.heldDays}d</span> : null}</div>
                <div><div className="text-slate-500">After this sale</div><b>{fmtQty(sLeftAfter ?? 0)}</b> left{sAvgAfter ? <> at ₹{fmt(sAvgAfter, 2)}</> : null}</div>
              </>
            )}
          </div>
        )}
        <div className="text-[11px] text-slate-500 mb-1">Why are you selling? Tap what applies</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {SELL_CHIPS.map((w) => <button key={w} type="button" onClick={() => setSf({ ...sf, reason: togglePhrase(sf.reason, w, "; ") })} className={chip(hasPhrase(sf.reason, w, "; "))}>{w}</button>)}
        </div>
        <textarea value={sf.reason} onChange={(e) => setSf({ ...sf, reason: e.target.value })} rows={2} placeholder="the reason in my own words — at least a sentence" className={`${input} mb-2`} />
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-xs text-slate-500">Followed the plan?</span>
          {PLAN_CHIPS.map((c) => <button key={c.v} type="button" onClick={() => setSf({ ...sf, plan: c.v })} className={chip(sf.plan === c.v)}>{c.label}</button>)}
          <span className="text-xs text-slate-500 ml-3">Feeling</span>
          {STATES.map((m) => <button key={m} type="button" onClick={() => setSf({ ...sf, state: m })} title={m} className={`px-2 py-1 rounded-lg text-sm border ${sf.state === m ? "border-indigo-500 bg-indigo-600 text-white" : "border-slate-300 hover:border-slate-400"}`}>{MOODS[m]}</button>)}
        </div>
        <input value={sf.lesson} onChange={(e) => setSf({ ...sf, lesson: e.target.value })} placeholder="lesson / what I'd do differently (optional)" className={`${input} mb-3`} />
        {sellWarnings.length > 0 && (
          <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 list-disc pl-6 space-y-0.5 mb-3">{sellWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
        )}
        <button onClick={addSale} disabled={!canSell || !loaded} className={`px-5 py-2.5 rounded-lg text-sm font-semibold ${canSell && loaded ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
          {sellEditId ? "Save changes" : "💸 Log the sale"}
        </button>
        <span className="text-[11px] text-slate-400 ml-3">Records the sale only — it does not place an order.</span>
      </div>

      {/* positions */}
      {positions.length > 0 && (
        <div className="mb-5">
          <h2 className="text-sm font-medium text-slate-700 mb-2">Positions — buys, sales and what's left, per stock / ETF</h2>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="text-sm border-collapse w-full" style={{ minWidth: 1250 }}>
              <thead>
                <tr>
                  <th className={`${th} text-left`}>Symbol</th>
                  <th className={th}>Buys / sells</th>
                  <th className={th}>First → last buy</th>
                  <th className={th}>Bought</th>
                  <th className={th}>Sold</th>
                  <th className={th}>Left</th>
                  <th className={th}>Avg cost (left)</th>
                  <th className={th}>Invested (left)</th>
                  <th className={th}>Now</th>
                  <th className={th}>Unrealised ₹ / %</th>
                  <th className={th}>Realised ₹</th>
                  <th className={th} title="Share of the portfolio as of your last PF update (falls back to what you typed when you bought)">Alloc %</th>
                  <th className={th}>Stop</th>
                </tr>
              </thead>
              <tbody>
                {positions.flatMap((p) => {
                  const isOpenP = openPos === p.sym;
                  const bk = p.book;
                  const closed = bk.left <= 0;
                  const unreal = p.now !== undefined && !closed ? (p.now - p.s.avg) * p.s.qty : null;
                  const plp = p.now !== undefined && !closed ? (p.now / p.s.avg - 1) * 100 : null;
                  const ss = !closed && p.last ? stopState(p.last, p.now) : "none";
                  const head = (
                    <tr key={p.sym} onClick={() => setOpenPos(isOpenP ? null : p.sym)} className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50 ${ss === "hit" ? "bg-red-50" : ss === "near" ? "bg-amber-50" : ""} ${closed ? "opacity-70" : ""}`}>
                      <td className="px-2 py-1.5 font-medium">
                        {p.sym}
                        {closed && <span className="ml-1 text-[10px] text-slate-500">closed</span>}
                        {ss === "hit" && <span className="ml-1 text-[10px] text-red-600">STOP HIT</span>}
                        {ss === "near" && <span className="ml-1 text-[10px] text-amber-700">near stop</span>}
                        {(p.book.lots.some((l) => l.entry.pending) || p.book.sales.some((r) => r.sell.pending)) && <span className="ml-1 text-[10px] text-indigo-600">✍ reason owed</span>}
                      </td>
                      <td className="px-2 py-1.5 text-center tabular-nums">{bk.lots.length} / {bk.sales.length}</td>
                      <td className="px-2 py-1.5 text-center text-xs text-slate-600 tabular-nums">{bk.lots[0].entry.date === bk.lots[bk.lots.length - 1].entry.date ? bk.lots[0].entry.date : `${bk.lots[0].entry.date} → ${bk.lots[bk.lots.length - 1].entry.date}`}</td>
                      <td className={td}>{fmtQty(bk.bought)}</td>
                      <td className={td}>{bk.sold ? fmtQty(bk.sold) : "—"}</td>
                      <td className={`${td} font-medium`}>{closed ? "—" : fmtQty(bk.left)}</td>
                      <td className={td}>{closed ? "—" : fmt(p.s.avg, 2)}</td>
                      <td className={td}>{closed ? "—" : R(p.s.invested)}</td>
                      <td className={td}>{p.now !== undefined ? <PriceLink symbol={p.sym} value={p.now} /> : "—"}</td>
                      <td className={`${td} ${unreal === null ? "" : sign(unreal)}`}>{unreal === null ? "—" : `${R(unreal)} / ${fmtSigned(plp!, 1)}`}</td>
                      <td className={`${td} ${bk.sold ? sign(bk.realized) : ""}`}>{bk.sold ? R(bk.realized) : "—"}</td>
                      <td className={`${td} text-slate-600`}>{!closed && pf?.weights[p.sym] !== undefined ? fmt(pf.weights[p.sym], 1, "%") : !closed && p.s.alloc > 0 ? fmt(p.s.alloc, 1, "%") : "—"}</td>
                      <td className={`${td} text-slate-600`}>{closed ? "—" : p.last?.stop != null ? <>{fmt(p.last.stop, 2)}{p.last.stopMode === "ema33w" && <span className="block text-[10px] text-slate-400">33W EMA</span>}</> : <span className="text-red-500">none</span>}</td>
                    </tr>
                  );
                  if (!isOpenP) return [head];
                  const totalPl = bk.realized + (unreal ?? 0);
                  return [
                    head,
                    <tr key={p.sym + "x"} className="bg-slate-50 border-t border-slate-100">
                      <td colSpan={13} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                          <span className="text-xs text-slate-500">Everything in {p.sym}: every buy with what is left of it, every sale with what it realised</span>
                          <span className="ml-auto flex gap-2">
                            <button onClick={(ev) => { ev.stopPropagation(); setF({ ...blank(), symbol: p.sym }); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="text-xs px-2 py-1 rounded border border-indigo-400 text-indigo-600 hover:bg-indigo-50">＋ log another buy</button>
                            {!closed && <button onClick={(ev) => { ev.stopPropagation(); setSellEditId(null); setSf({ ...blankSell(), symbol: p.sym, price: p.now ? String(p.now) : "" }); document.getElementById("tj-sell")?.scrollIntoView({ behavior: "smooth" }); }} className="text-xs px-2 py-1 rounded border border-red-400 text-red-600 hover:bg-red-50">💸 sell some / all</button>}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-3 text-xs">
                          <div><div className="text-slate-500">Bought</div><b>{fmtQty(bk.bought)}</b> @ avg ₹{fmt(bk.avgBuy, 2)}</div>
                          <div><div className="text-slate-500">Sold</div><b>{bk.sold ? fmtQty(bk.sold) : "—"}</b>{bk.avgSell !== null ? <> @ avg ₹{fmt(bk.avgSell, 2)}</> : null}</div>
                          <div><div className="text-slate-500">Left</div><b>{fmtQty(bk.left)}</b>{bk.left ? <> @ avg ₹{fmt(bk.avgLeft, 2)}</> : null}</div>
                          <div><div className="text-slate-500">Realised</div><b className={bk.sold ? sign(bk.realized) : ""}>{bk.sold ? `${R(bk.realized)} (${fmtSigned((bk.realized / bk.realizedCost) * 100, 1)})` : "—"}</b></div>
                          <div><div className="text-slate-500">Unrealised</div><b className={unreal === null ? "" : sign(unreal)}>{unreal === null ? "—" : R(unreal)}</b></div>
                          <div><div className="text-slate-500">Total P/L</div><b className={sign(totalPl)}>{R(totalPl)}</b></div>
                        </div>
                        <table className="text-xs border-collapse w-full mb-3" style={{ minWidth: 800 }}>
                          <thead>
                            <tr className="text-slate-500">
                              <th className="text-left px-2 py-1 font-normal">Buy date</th>
                              <th className="text-right px-2 py-1 font-normal">Qty</th>
                              <th className="text-right px-2 py-1 font-normal">Price</th>
                              <th className="text-right px-2 py-1 font-normal">Sold</th>
                              <th className="text-right px-2 py-1 font-normal">Left</th>
                              <th className="text-right px-2 py-1 font-normal">Realised ₹</th>
                              <th className="text-right px-2 py-1 font-normal">Wkly RSI</th>
                              <th className="text-left px-2 py-1 font-normal">Why I bought</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bk.lots.map((l) => (
                              <tr key={l.entry.id} className="border-t border-slate-200 align-top">
                                <td className="px-2 py-1 tabular-nums whitespace-nowrap">{l.entry.date}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{fmtQty(l.entry.qty)}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{fmt(l.entry.price, 2)}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{l.sold ? fmtQty(l.sold) : "—"}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{l.remaining ? fmtQty(l.remaining) : "—"}</td>
                                <td className={`px-2 py-1 text-right tabular-nums ${l.sold ? sign(l.realized) : ""}`}>{l.sold ? R(l.realized) : "—"}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{l.entry.rsiW !== null ? fmt(l.entry.rsiW, 1) : "—"}</td>
                                <td className="px-2 py-1 max-w-[30rem]">
                                  {l.entry.pending ? <span className="text-indigo-600">✍ reason owed</span> : <>{l.entry.fundNote && <b className="text-emerald-700">{l.entry.fundNote} · </b>}{l.entry.reason}</>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {bk.sales.length > 0 && (
                          <table className="text-xs border-collapse w-full" style={{ minWidth: 800 }}>
                            <thead>
                              <tr className="text-slate-500">
                                <th className="text-left px-2 py-1 font-normal">Sale date</th>
                                <th className="text-right px-2 py-1 font-normal">Qty</th>
                                <th className="text-right px-2 py-1 font-normal">Price</th>
                                <th className="text-right px-2 py-1 font-normal">Avg cost</th>
                                <th className="text-right px-2 py-1 font-normal">P/L ₹</th>
                                <th className="text-right px-2 py-1 font-normal">P/L %</th>
                                <th className="text-left px-2 py-1 font-normal">Plan</th>
                                <th className="text-left px-2 py-1 font-normal">Why I sold</th>
                              </tr>
                            </thead>
                            <tbody>
                              {bk.sales.map((r) => (
                                <tr key={r.sell.id} className="border-t border-slate-200 align-top">
                                  <td className="px-2 py-1 tabular-nums whitespace-nowrap">{r.sell.date}</td>
                                  <td className="px-2 py-1 text-right tabular-nums">{fmtQty(r.sell.qty)}</td>
                                  <td className="px-2 py-1 text-right tabular-nums">{fmt(r.sell.price, 2)}</td>
                                  <td className="px-2 py-1 text-right tabular-nums">{r.matched ? fmt(r.cost / r.matched, 2) : "—"}</td>
                                  <td className={`px-2 py-1 text-right tabular-nums ${r.matched ? sign(r.pl) : ""}`}>{r.matched ? R(r.pl) : "—"}</td>
                                  <td className={`px-2 py-1 text-right tabular-nums ${r.matched ? sign(r.pl) : ""}`}>{r.matched ? fmtSigned((r.pl / r.cost) * 100, 1) : "—"}</td>
                                  <td className="px-2 py-1">{r.sell.plan ? PLAN_CHIPS.find((c) => c.v === r.sell.plan)?.label : "—"}</td>
                                  <td className="px-2 py-1 max-w-[30rem]">{r.sell.pending ? <span className="text-indigo-600">✍ reason owed</span> : <>{r.sell.reason}{r.sell.lesson && <div className="text-slate-500 mt-0.5">Lesson: {r.sell.lesson}</div>}</>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>,
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* record */}
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <h2 className="text-sm font-medium text-slate-700">All buys (record)</h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search symbol, setup or reason…" className="px-2 py-1.5 border border-slate-300 rounded text-sm w-64" />
        <span className="text-xs text-slate-400">{shown.length} of {doc.entries.length}{px.asOf ? ` · prices as of ${px.asOf}` : ""}</span>
      </div>
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="text-sm border-collapse w-full" style={{ minWidth: 1450 }}>
          <thead>
            <tr>
              <th className={th}>Date</th>
              <th className={`${th} text-left`}>Symbol</th>
              <th className={th}>Qty</th>
              <th className={th}>Buy price</th>
              <th className={th}>Alloc %</th>
              <th className={th}>Wkly RSI</th>
              <th className={th}>vs 200D</th>
              <th className={th}>Stop (₹ / %)</th>
              <th className={th}>Risk</th>
              <th className={th}>Now / exit</th>
              <th className={th}>P/L %</th>
              <th className={th}>Checklist</th>
              <th className={`${th} text-left`}>Fund. trigger</th>
              <th className={`${th} text-left`}>State</th>
              <th className={th}>Review</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={15} className="px-3 py-8 text-center text-slate-400 text-sm">
                  {loaded ? "No buys logged yet — log your next one above before you place the order." : "Loading…"}
                </td>
              </tr>
            )}
            {shown.flatMap((e) => {
              const lot = lotById.get(e.id);
              const soldOut = !!lot && lot.remaining <= 0 && lot.sold > 0;
              const exit = soldOut ? e.price + lot!.realized / lot!.sold : NaN;
              const live = px.map.get(e.symbol)?.price as number | undefined;
              const now = soldOut ? exit : live;
              const plPct = soldOut ? (lot!.realized / (lot!.sold * e.price)) * 100 : now !== undefined ? (now / e.price - 1) * 100 : null;
              const sc = score(e);
              const rk = e.stop0 !== null && e.stop0 < e.price ? e.qty * (e.price - e.stop0) : null; // blank when the stop sits above the buy price (bought below the 33W EMA)
              const ss = soldOut ? "none" : stopState(e, live);
              const isOpen = open === e.id;
              const reviewed = !!(e.review && (e.review.lesson || e.review.plan || e.review.exitPrice));
              const tone = ss === "hit" ? "bg-red-50" : ss === "near" ? "bg-amber-50" : isOpen ? "bg-slate-50" : "";
              const main = (
                <tr key={e.id} onClick={() => setOpen(isOpen ? null : e.id)} className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50 ${tone}`}>
                  <td className="px-2 py-1.5 text-center tabular-nums text-slate-600">{e.date}</td>
                  <td className="px-2 py-1.5 font-medium">
                    {e.symbol}
                    {ss === "hit" && <span className="ml-1 text-[10px] text-red-600">STOP HIT</span>}
                    {ss === "near" && <span className="ml-1 text-[10px] text-amber-700">near stop</span>}
                  </td>
                  <td className={td}>
                    {fmtQty(e.qty)}
                    {lot && lot.sold > 0 && lot.remaining > 0 && <span className="text-[10px] text-slate-400"> ({fmtQty(lot.remaining)} left)</span>}
                  </td>
                  <td className={td}><PriceLink symbol={e.symbol} value={e.price} /></td>
                  <td className={`${td} text-slate-600`}>{e.allocPct !== null ? fmt(e.allocPct, 1, "%") : "—"}</td>
                  <td className={`${td} text-slate-600`}>{e.rsiW !== null ? fmt(e.rsiW, 1) : "—"}</td>
                  <td className={`${td} text-slate-600`}>{e.ema200Pct !== null ? fmtSigned(e.ema200Pct, 1) : "—"}</td>
                  <td className={`${td} text-slate-600`}>
                    {e.stop !== null ? <>{`${fmt(e.stop, 2)} / ${fmt((1 - e.stop / e.price) * 100, 1, "%")}`}{e.stopMode === "ema33w" && <span className="block text-[10px] text-slate-400">33W EMA</span>}</> : <span className="text-red-500">none</span>}
                  </td>
                  <td className={`${td} text-slate-500`}>{rk !== null ? R(rk) : "—"}</td>
                  <td className={td}>
                    {now !== undefined ? fmt(now, 2) : "—"}
                    {soldOut && <span className="ml-1 text-[10px] text-slate-400">sold avg</span>}
                  </td>
                  <td className={`${td} ${plPct === null ? "" : sign(plPct)}`}>{plPct === null ? "—" : fmtSigned(plPct, 1)}</td>
                  <td className={`${td} ${sc !== null && sc < 0.7 ? "text-amber-700" : ""}`}>{sc === null ? "—" : `${e.checks.filter((c) => c.ok).length}/${e.checks.length}`}</td>
                  <td className="px-2 py-1.5 text-xs text-slate-600 max-w-[16rem] truncate" title={e.fundNote}>
                    <b className={e.fundTrigger === "yes" ? "text-emerald-700" : "text-slate-500"}>{e.fundTrigger === "yes" ? "YES" : "NO"}</b>
                    {e.fundNote ? ` · ${e.fundNote}` : ""}
                  </td>
                  <td className={`px-2 py-1.5 text-xs ${e.pending ? "text-indigo-600" : e.state === STATES[0] || e.state === STATES[1] ? "text-slate-600" : "text-amber-700"}`}>{e.pending ? "✍ reason owed" : e.state}</td>
                  <td className="px-2 py-1.5 text-center text-xs">{reviewed ? <span className="text-emerald-700">✓</span> : <span className="text-slate-300">—</span>}</td>
                </tr>
              );
              if (!isOpen) return [main];
              const rv: Review = { exitDate: "", exitPrice: "", plan: "", lesson: "", ...e.review };
              return [
                main,
                <tr key={e.id + "x"} className="bg-slate-50 border-t border-slate-100">
                  <td colSpan={15} className="px-4 py-3">
                    {editId === e.id ? (
                      <EditEntry e={e} onCancel={() => setEditId(null)} onSave={(p) => { patch(e.id, e.pending && (p.reason ?? "").length >= 10 ? { ...p, pending: false } : p); setEditId(null); }} />
                    ) : (
                    <div className="grid lg:grid-cols-3 gap-4 text-sm">
                      <div className="flex flex-col gap-2">
                        <button onClick={() => setEditId(e.id)} className="self-start text-xs px-2 py-1 rounded border border-indigo-400 text-indigo-600 hover:bg-indigo-50">✎ Edit this entry</button>
                        <div className="text-xs text-slate-500">
                          Why I bought · {e.setup} · conviction {e.confidence}/5{e.target !== null ? ` · target ₹${fmt(e.target, 2)}` : ""}
                        </div>
                        <div className="whitespace-pre-wrap">{e.reason}</div>
                        <div className="text-xs text-slate-600">
                          <b>Allocation:</b> {e.allocPct !== null ? fmt(e.allocPct, 1, "%") : "—"} — {e.allocReason || "no reason given"}
                        </div>
                        <div className="text-xs text-slate-600">
                          <b>Fundamental trigger:</b> {e.fundTrigger === "yes" ? "YES" : "NO"} — {e.fundNote || "—"}
                        </div>
                        <div className="text-xs text-slate-600">
                          <b>On the day:</b> {e.ema200Pct !== null ? `${fmtSigned(e.ema200Pct, 1)} vs 200D EMA` : "200D n/a"} · {e.rsiW !== null ? `weekly RSI ${fmt(e.rsiW, 1)}` : "weekly RSI n/a"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Checklist on that day</div>
                        {e.checks.map((c, i) => (
                          <div key={i} className={`text-xs py-0.5 ${c.ok ? "text-emerald-700" : "text-red-600"}`}>
                            {c.ok ? "✓" : "✗"} {c.text}
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-col gap-2" onClick={(ev) => ev.stopPropagation()}>
                        {e.stopMode === "ema33w" ? (
                          <div className="text-xs">
                            <div className="text-slate-600 mb-1">Stop-loss: <b>33W EMA, trailing</b>{e.stop !== null ? <> — live ₹{fmt(e.stop, 2)}</> : " — no store data yet"}</div>
                            <button onClick={() => patch(e.id, { stopMode: "fixed" })} className="text-indigo-600 hover:underline">switch to a fixed stop price</button>
                          </div>
                        ) : (
                          <>
                            <F label="Stop-loss now (₹) — trail it up as the trade works" hint={e.stop0 !== null ? `started at ₹${fmt(e.stop0, 2)}` : undefined}>
                              <input type="number" step="any" value={e.stop ?? ""} onChange={(ev) => patch(e.id, { stop: ev.target.value === "" ? null : parseFloat(ev.target.value) })}
                                onBlur={() => e.stop0 === null && e.stop !== null && Number.isFinite(e.stop) && patch(e.id, { stop0: e.stop })} className={input} />
                            </F>
                            <button onClick={() => patch(e.id, { stopMode: "ema33w" })} className="text-xs text-indigo-600 hover:underline self-start">↺ use the 33W EMA as the stop</button>
                          </>
                        )}
                        <div className="text-xs text-slate-500 mt-1">Review</div>
                        <div className="grid grid-cols-2 gap-2">
                          <F label="Exit date"><input type="date" value={rv.exitDate} onChange={(ev) => patchReview(e.id, { exitDate: ev.target.value })} className={input} /></F>
                          <F label="Full exit price (₹) — or use Log a sale"><input type="number" step="any" value={rv.exitPrice} onChange={(ev) => patchReview(e.id, { exitPrice: ev.target.value })} className={input} /></F>
                        </div>
                        <F label="Did I follow my plan?">
                          <select value={rv.plan} onChange={(ev) => patchReview(e.id, { plan: ev.target.value as Review["plan"] })} className={input}>
                            <option value="">—</option>
                            <option value="yes">Yes — entry, stop and exit as planned</option>
                            <option value="partly">Partly</option>
                            <option value="no">No — emotion overrode the plan</option>
                          </select>
                        </F>
                        <F label="Lesson / what I'd do differently">
                          <textarea value={rv.lesson} onChange={(ev) => patchReview(e.id, { lesson: ev.target.value })} rows={3} className={input} />
                        </F>
                        <div className="flex justify-between">
                          <span className="text-[11px] text-slate-400">A good process can still lose money — judge the decision, not just the P/L.</span>
                          <span className="flex gap-3">
                            <button onClick={() => setEditId(e.id)} className="text-xs text-indigo-600 hover:underline">✎ edit entry</button>
                            <button onClick={() => remove(e.id)} className="text-xs text-red-600 hover:underline">delete entry</button>
                          </span>
                        </div>
                      </div>
                    </div>
                    )}
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      {doc.sells.length > 0 && (
        <div className="mt-5">
          <h2 className="text-sm font-medium text-slate-700 mb-2">Sales record ({doc.sells.length})</h2>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="text-sm border-collapse w-full" style={{ minWidth: 1100 }}>
              <thead>
                <tr>
                  <th className={th}>Date</th>
                  <th className={`${th} text-left`}>Symbol</th>
                  <th className={th}>Qty</th>
                  <th className={th}>Sell price</th>
                  <th className={th}>Avg cost</th>
                  <th className={th}>P/L ₹</th>
                  <th className={th}>P/L %</th>
                  <th className={th}>Held (days)</th>
                  <th className={`${th} text-left`}>Plan</th>
                  <th className={`${th} text-left`}>State</th>
                  <th className={`${th} text-left`}>Why I sold</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody>
                {Array.from(books.values())
                  .flatMap((b) => b.sales)
                  .sort((a, b) => b.sell.date.localeCompare(a.sell.date))
                  .map((r) => (
                    <tr key={r.sell.id} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-1.5 text-center tabular-nums text-slate-600">{r.sell.date}</td>
                      <td className="px-2 py-1.5 font-medium">{r.sell.symbol}</td>
                      <td className={td}>{fmtQty(r.sell.qty)}{r.short > 0 && <span className="text-[10px] text-amber-700" title="part of this sale has no buy to match"> ({fmtQty(r.short)} unmatched)</span>}</td>
                      <td className={td}>{fmt(r.sell.price, 2)}{r.sell.priceApprox && <span className="text-[10px] text-amber-700" title="price inferred — correct it"> ~</span>}</td>
                      <td className={`${td} text-slate-600`}>{r.matched ? fmt(r.cost / r.matched, 2) : "—"}</td>
                      <td className={`${td} ${r.matched ? sign(r.pl) : ""}`}>{r.matched ? R(r.pl) : "—"}</td>
                      <td className={`${td} ${r.matched ? sign(r.pl) : ""}`}>{r.matched ? fmtSigned((r.pl / r.cost) * 100, 1) : "—"}</td>
                      <td className={`${td} text-slate-600`}>{r.heldDays ?? "—"}</td>
                      <td className="px-2 py-1.5 text-xs">{r.sell.plan ? PLAN_CHIPS.find((c) => c.v === r.sell.plan)?.label : "—"}</td>
                      <td className={`px-2 py-1.5 text-xs ${r.sell.pending ? "text-indigo-600" : "text-slate-600"}`}>{r.sell.pending ? "✍ reason owed" : r.sell.state ? `${MOODS[r.sell.state] ?? ""} ${r.sell.state}` : "—"}</td>
                      <td className="px-2 py-1.5 text-xs max-w-[26rem]">{r.sell.reason || "—"}{r.sell.lesson && <div className="text-slate-500">Lesson: {r.sell.lesson}</div>}</td>
                      <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                        <button onClick={() => { setSellEditId(r.sell.id); setSf({ symbol: r.sell.symbol, date: r.sell.date, qty: String(r.sell.qty), price: String(r.sell.price), reason: r.sell.reason, state: r.sell.state || STATES[0], plan: r.sell.plan, lesson: r.sell.lesson }); document.getElementById("tj-sell")?.scrollIntoView({ behavior: "smooth" }); }} className="text-indigo-600 hover:underline mr-2">✎</button>
                        <button onClick={() => removeSell(r.sell.id)} className="text-red-600 hover:underline">✕</button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-2">
        Saved in your Valuation Ledger database (same on every device). "Now", the 200D EMA / weekly RSI checks and the stop-loss alert use the last close in the daily NSE store, not a live quote. Logging a buy here does not place an order and is not
        investment advice.
      </p>
    </div>
  );
}
