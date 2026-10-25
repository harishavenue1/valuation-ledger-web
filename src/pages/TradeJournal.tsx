import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { fmt, fmtSigned } from "../lib/model";
import { PriceLink } from "../components/ScreenerTable";
import { Check, Doc, Entry, NEAR_PCT, Review, isClosed, stopState } from "../lib/journal";

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
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const score = (e: Entry) => (e.checks.length ? e.checks.filter((c) => c.ok).length / e.checks.length : null);
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

export default function TradeJournal() {
  const [doc, setDoc] = useState<Doc>({ checklist: null, entries: [] });
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [px, setPx] = useState<{ asOf?: string; map: Map<string, any> }>({ map: new Map() });
  const dirty = useRef(false);

  const checklist = doc.checklist ?? DEFAULT_CHECKLIST;
  const [editList, setEditList] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const blank = () => ({
    symbol: "", date: today(), qty: "", price: "", setup: SETUPS[0], state: STATES[0], confidence: 3,
    fundTrigger: "" as "" | "yes" | "no", fundNote: "", allocPct: "", allocReason: "", stopPct: "", stopPx: "", target: "",
    reason: "", ticks: {} as Record<string, boolean>,
  });
  const [f, setF] = useState(blank);

  useEffect(() => {
    api
      .getJournal()
      .then((d) => {
        setDoc({ checklist: d.checklist ?? null, entries: d.entries ?? [] });
        setLoaded(true);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    api
      .getBhavTechnicals()
      .then((r) => setPx({ asOf: r.as_of, map: new Map((r.rows ?? []).map((x: any) => [x.symbol, x])) }))
      .catch(() => {});
  }, []);

  // debounced save — only after the first successful load, so a failed load can never overwrite the stored journal
  useEffect(() => {
    if (!loaded || !dirty.current) return;
    setSaving("saving");
    const t = setTimeout(() => {
      api
        .setJournal(doc)
        .then(() => setSaving("saved"))
        .catch(() => setSaving("failed"));
    }, 600);
    return () => clearTimeout(t);
  }, [doc, loaded]);

  const update = (fn: (d: Doc) => Doc) => {
    dirty.current = true;
    setDoc(fn);
  };

  const sym = f.symbol.trim().toUpperCase();
  const row = px.map.get(sym);
  const qty = num(f.qty);
  const price = num(f.price);
  const stopPx = num(f.stopPx);
  const stopPct = num(f.stopPct);
  const allocPct = num(f.allocPct);
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
    setF((s) => ({ ...s, stopPct: v, stopPx: p > 0 && p < 100 && price > 0 ? (price * (1 - p / 100)).toFixed(2) : s.stopPx }));
  };
  const setStopPx = (v: string) => {
    const x = num(v);
    setF((s) => ({ ...s, stopPx: v, stopPct: x > 0 && price > 0 ? ((1 - x / price) * 100).toFixed(1) : s.stopPct }));
  };
  const setBuyPrice = (v: string) => {
    const p = num(v);
    setF((s) => {
      const sp = num(s.stopPct);
      return { ...s, price: v, stopPx: p > 0 && sp > 0 && sp < 100 ? (p * (1 - sp / 100)).toFixed(2) : s.stopPx };
    });
  };

  const risk = stopPx > 0 && qty > 0 && price > 0 ? qty * (price - stopPx) : null;
  const portfolioRisk = allocPct > 0 && stopPct > 0 ? (allocPct * stopPct) / 100 : null;
  const warnings: string[] = [];
  if (!(stopPx > 0)) warnings.push("No stop-loss — decide it before you buy.");
  else if (price > 0 && stopPx >= price) warnings.push("Stop-loss is not below the buy price.");
  if (ema200Pct !== null && ema200Pct <= 0) warnings.push(`Price is ${fmt(Math.abs(ema200Pct), 1, "%")} BELOW the 200D EMA.`);
  if (rsiW !== null && rsiW <= 66) warnings.push(`Weekly RSI is ${fmt(rsiW, 1)} — not above 66.`);
  if (f.fundTrigger === "no") warnings.push("No fundamental trigger — this is a pure price/momentum buy.");
  if (ticked < checklist.length) warnings.push(`${checklist.length - ticked} checklist item${checklist.length - ticked === 1 ? "" : "s"} not satisfied — make sure the reason below covers why you're buying anyway.`);
  if (f.state !== STATES[0] && f.state !== STATES[1]) warnings.push(`You marked yourself "${f.state}" — emotion, not process, may be driving this one.`);
  const canSave = sym.length > 0 && qty > 0 && price > 0 && f.reason.trim().length >= 10 && !!f.date && f.fundTrigger !== "";

  const add = () => {
    if (!canSave) return;
    const stop = stopPx > 0 ? stopPx : null;
    const e: Entry = {
      id: uid(), symbol: sym, date: f.date, qty, price,
      allocPct: allocPct > 0 ? allocPct : null, allocReason: f.allocReason.trim(),
      stop0: stop, stop, target: num(f.target) > 0 ? num(f.target) : null,
      fundTrigger: f.fundTrigger as "yes" | "no", fundNote: f.fundNote.trim(),
      ema200Pct, rsiW, setup: f.setup, reason: f.reason.trim(), state: f.state, confidence: f.confidence,
      checks: checklist.map((c) => ({ text: c.text, ok: tick(c) })),
    };
    update((d) => ({ ...d, checklist: d.checklist ?? DEFAULT_CHECKLIST, entries: [e, ...d.entries] }));
    setF(blank());
    setOpen(e.id);
  };
  const patch = (id: string, p: Partial<Entry>) => update((d) => ({ ...d, entries: d.entries.map((e) => (e.id === id ? { ...e, ...p } : e)) }));
  const patchReview = (id: string, p: Partial<Review>) =>
    update((d) => ({ ...d, entries: d.entries.map((e) => (e.id === id ? { ...e, review: { exitDate: "", exitPrice: "", plan: "", lesson: "", ...e.review, ...p } } : e)) }));
  const remove = (id: string) => {
    if (window.confirm("Delete this journal entry permanently?")) update((d) => ({ ...d, entries: d.entries.filter((e) => e.id !== id) }));
  };

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return doc.entries.filter((e) => !n || e.symbol.toLowerCase().includes(n) || e.reason.toLowerCase().includes(n) || e.setup.toLowerCase().includes(n)).sort((a, b) => b.date.localeCompare(a.date));
  }, [doc.entries, q]);

  const alerts = useMemo(() => {
    const hit: { e: Entry; p: number }[] = [];
    const near: { e: Entry; p: number }[] = [];
    for (const e of doc.entries) {
      const p = px.map.get(e.symbol)?.price;
      const s = stopState(e, p);
      if (s === "hit") hit.push({ e, p });
      else if (s === "near") near.push({ e, p });
    }
    return { hit, near };
  }, [doc.entries, px]);

  const stats = useMemo(() => {
    const es = doc.entries;
    const closed = es.filter(isClosed);
    const ret = (e: Entry) => parseFloat(e.review!.exitPrice) / e.price - 1;
    const win = closed.filter((e) => ret(e) > 0);
    const lose = closed.filter((e) => ret(e) <= 0);
    const avg = (xs: Entry[]) => {
      const s = xs.map(score).filter((v): v is number => v !== null);
      return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
    };
    return {
      n: es.length,
      withStop: es.length ? es.filter((e) => e.stop0 !== null).length / es.length : null,
      avgScore: avg(es),
      closed: closed.length,
      winRate: closed.length ? win.length / closed.length : null,
      scoreWin: avg(win),
      scoreLose: avg(lose),
      followed: closed.length ? closed.filter((e) => e.review?.plan === "yes").length / closed.length : null,
    };
  }, [doc.entries]);

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

      {(alerts.hit.length > 0 || alerts.near.length > 0) && (
        <div className="my-3 space-y-2">
          {alerts.hit.map(({ e, p }) => (
            <div key={e.id} className="text-sm text-red-700 bg-red-50 border border-red-300 rounded px-3 py-2">
              🛑 <b>{e.symbol}</b> closed at ₹{fmt(p, 2)} — at or below your stop of ₹{fmt(e.stop!, 2)}. Your plan said to exit; log the exit in its review below.
            </div>
          ))}
          {alerts.near.map(({ e, p }) => (
            <div key={e.id} className="text-sm text-amber-800 bg-amber-50 border border-amber-300 rounded px-3 py-2">
              ⚠️ <b>{e.symbol}</b> at ₹{fmt(p, 2)} is within {NEAR_PCT}% of your stop (₹{fmt(e.stop!, 2)}).
            </div>
          ))}
          <div className="text-[11px] text-slate-400">Based on the last close in the daily store{px.asOf ? ` (${px.asOf})` : ""}, refreshed each evening — not a live stop order.</div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 bg-slate-50 rounded-lg p-4 my-3">
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
          <div className="text-xs text-slate-500">Reviewed / closed</div>
          <div className="text-lg font-semibold tabular-nums">{stats.closed}</div>
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

      {/* new buy */}
      <div className="p-4 border border-slate-200 rounded-lg mb-4">
        <div className="text-sm font-medium text-slate-700 mb-3">Log a buy</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
          <F label="Symbol">
            <input list="tj-syms" value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase(), ticks: {} })} className={input} placeholder="e.g. KPRMILL" />
            <datalist id="tj-syms">{Array.from(px.map.keys()).slice(0, 4000).map((s) => <option key={s} value={s} />)}</datalist>
          </F>
          <F label="Date">
            <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={input} />
          </F>
          <F label="Quantity">
            <input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} className={input} />
          </F>
          <F label="Buy price (₹)" hint={row?.price ? `store close ₹${fmt(row.price, 2)}` : undefined}>
            <input type="number" step="any" value={f.price} onChange={(e) => setBuyPrice(e.target.value)} className={input} />
          </F>
          <F label="Setup">
            <select value={f.setup} onChange={(e) => setF({ ...f, setup: e.target.value })} className={input}>
              {SETUPS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </F>
          <F label="State of mind">
            <select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} className={input}>
              {STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </F>
        </div>

        {/* market check, filled from the store */}
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <div className={`px-3 py-2 rounded border text-sm ${ema200Pct === null ? "border-slate-200 text-slate-500" : ema200Pct > 0 ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-700"}`}>
            <span className="text-xs text-slate-500">Above 200D EMA?</span>{" "}
            <b>{ema200Pct === null ? (sym ? "no store data for this symbol" : "type a symbol") : ema200Pct > 0 ? `YES · ${fmt(ema200Pct, 1, "%")} above` : `NO · ${fmt(Math.abs(ema200Pct), 1, "%")} below`}</b>
          </div>
          <div className={`px-3 py-2 rounded border text-sm ${rsiW === null ? "border-slate-200 text-slate-500" : rsiW > 66 ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-700"}`}>
            <span className="text-xs text-slate-500">Weekly RSI &gt; 66?</span>{" "}
            <b>{rsiW === null ? (sym ? "no store data for this symbol" : "type a symbol") : `${rsiW > 66 ? "YES" : "NO"} · RSI ${fmt(rsiW, 1)}`}</b>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-3 mb-3">
          <div className="grid grid-cols-[auto_1fr] gap-3 items-end">
            <F label="Fundamental trigger?">
              <div className="flex rounded border border-slate-300 overflow-hidden text-sm">
                {(["yes", "no"] as const).map((v) => (
                  <button key={v} type="button" onClick={() => setF({ ...f, fundTrigger: v })} className={`px-4 py-1.5 ${f.fundTrigger === v ? (v === "yes" ? "bg-emerald-600 text-white" : "bg-slate-600 text-white") : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                    {v === "yes" ? "YES" : "NO"}
                  </button>
                ))}
              </div>
            </F>
            <F label="The trigger, in a few words">
              <input value={f.fundNote} maxLength={100} onChange={(e) => setF({ ...f, fundNote: e.target.value })} placeholder="e.g. Q2 sales +38%, order book 3x revenue" className={input} />
            </F>
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-3 items-end">
            <F label="Allocation (% of portfolio)" hint={portfolioRisk !== null ? `risks ${fmt(portfolioRisk, 2, "%")} of portfolio` : undefined}>
              <input type="number" step="any" value={f.allocPct} onChange={(e) => setF({ ...f, allocPct: e.target.value })} className={input} />
            </F>
            <F label="Reason for this allocation">
              <input value={f.allocReason} maxLength={120} onChange={(e) => setF({ ...f, allocReason: e.target.value })} placeholder="e.g. half size — result not out yet" className={input} />
            </F>
          </div>
        </div>

        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
          <F label="Stop-loss (% below buy)">
            <input type="number" step="any" value={f.stopPct} onChange={(e) => setStopPct(e.target.value)} className={input} />
          </F>
          <F label="Stop-loss price (₹)" hint={risk !== null ? `you risk ${R(risk)}` : "type either — the other follows"}>
            <input type="number" step="any" value={f.stopPx} onChange={(e) => setStopPx(e.target.value)} className={input} />
          </F>
          <F label="Target (₹, optional)">
            <input type="number" step="any" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} className={input} />
          </F>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-slate-600">
                Checklist — <b className={ticked === checklist.length ? "text-emerald-700" : "text-amber-700"}>{ticked}/{checklist.length}</b>
              </span>
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
            <F label="Why am I buying this? (the full reason, in my own words)" hint="At least a sentence. This is what you will judge yourself against at review time.">
              <textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} rows={4} className={input} />
            </F>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              Conviction
              <input type="range" min={1} max={5} value={f.confidence} onChange={(e) => setF({ ...f, confidence: parseInt(e.target.value, 10) })} className="accent-indigo-600" />
              <b className="text-slate-800 w-4">{f.confidence}</b>
              <span className="text-slate-400">/ 5</span>
            </label>
            {warnings.length > 0 && (
              <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 list-disc pl-6 space-y-0.5">
                {warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
            <div>
              <button onClick={add} disabled={!canSave || !loaded} className={`px-4 py-2 rounded text-sm font-medium ${canSave && loaded ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
                Save to journal
              </button>
              <span className="text-[11px] text-slate-400 ml-3">
                {!canSave && f.fundTrigger === "" ? "Answer the fundamental-trigger question to save · " : ""}Records the trade only — it does not place an order.
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

      {/* record */}
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <h2 className="text-sm font-medium text-slate-700">Buy record</h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search symbol, setup or reason…" className="px-2 py-1.5 border border-slate-300 rounded text-sm w-64" />
        <span className="text-xs text-slate-400">{shown.length} of {doc.entries.length}{px.asOf ? ` · prices as of ${px.asOf}` : ""}</span>
      </div>
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="text-sm border-collapse w-full" style={{ minWidth: 1250 }}>
          <thead>
            <tr>
              <th className={th}>Date</th>
              <th className={`${th} text-left`}>Symbol</th>
              <th className={th}>Qty</th>
              <th className={th}>Buy price</th>
              <th className={th}>Alloc %</th>
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
                <td colSpan={13} className="px-3 py-8 text-center text-slate-400 text-sm">
                  {loaded ? "No buys logged yet — log your next one above before you place the order." : "Loading…"}
                </td>
              </tr>
            )}
            {shown.flatMap((e) => {
              const exit = isClosed(e) ? parseFloat(e.review!.exitPrice) : NaN;
              const live = px.map.get(e.symbol)?.price as number | undefined;
              const now = Number.isFinite(exit) ? exit : live;
              const plPct = now !== undefined ? (now / e.price - 1) * 100 : null;
              const sc = score(e);
              const rk = e.stop0 !== null ? e.qty * (e.price - e.stop0) : null;
              const ss = stopState(e, live);
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
                  <td className={td}>{fmt(e.qty, 0)}</td>
                  <td className={td}><PriceLink symbol={e.symbol} value={e.price} /></td>
                  <td className={`${td} text-slate-600`}>{e.allocPct !== null ? fmt(e.allocPct, 1, "%") : "—"}</td>
                  <td className={`${td} text-slate-600`}>
                    {e.stop !== null ? `${fmt(e.stop, 2)} / ${fmt((1 - e.stop / e.price) * 100, 1, "%")}` : <span className="text-red-500">none</span>}
                  </td>
                  <td className={`${td} text-slate-500`}>{rk !== null ? R(rk) : "—"}</td>
                  <td className={td}>
                    {now !== undefined ? fmt(now, 2) : "—"}
                    {Number.isFinite(exit) && <span className="ml-1 text-[10px] text-slate-400">exit</span>}
                  </td>
                  <td className={`${td} ${plPct === null ? "" : sign(plPct)}`}>{plPct === null ? "—" : fmtSigned(plPct, 1)}</td>
                  <td className={`${td} ${sc !== null && sc < 0.7 ? "text-amber-700" : ""}`}>{sc === null ? "—" : `${e.checks.filter((c) => c.ok).length}/${e.checks.length}`}</td>
                  <td className="px-2 py-1.5 text-xs text-slate-600 max-w-[16rem] truncate" title={e.fundNote}>
                    <b className={e.fundTrigger === "yes" ? "text-emerald-700" : "text-slate-500"}>{e.fundTrigger === "yes" ? "YES" : "NO"}</b>
                    {e.fundNote ? ` · ${e.fundNote}` : ""}
                  </td>
                  <td className={`px-2 py-1.5 text-xs ${e.state === STATES[0] || e.state === STATES[1] ? "text-slate-600" : "text-amber-700"}`}>{e.state}</td>
                  <td className="px-2 py-1.5 text-center text-xs">{reviewed ? <span className="text-emerald-700">✓</span> : <span className="text-slate-300">—</span>}</td>
                </tr>
              );
              if (!isOpen) return [main];
              const rv: Review = { exitDate: "", exitPrice: "", plan: "", lesson: "", ...e.review };
              return [
                main,
                <tr key={e.id + "x"} className="bg-slate-50 border-t border-slate-100">
                  <td colSpan={13} className="px-4 py-3">
                    <div className="grid lg:grid-cols-3 gap-4 text-sm">
                      <div className="flex flex-col gap-2">
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
                        <F label="Stop-loss now (₹) — trail it up as the trade works" hint={e.stop0 !== null ? `started at ₹${fmt(e.stop0, 2)}` : undefined}>
                          <input type="number" step="any" value={e.stop ?? ""} onChange={(ev) => patch(e.id, { stop: ev.target.value === "" ? null : parseFloat(ev.target.value) })} className={input} />
                        </F>
                        <div className="text-xs text-slate-500 mt-1">Review</div>
                        <div className="grid grid-cols-2 gap-2">
                          <F label="Exit date"><input type="date" value={rv.exitDate} onChange={(ev) => patchReview(e.id, { exitDate: ev.target.value })} className={input} /></F>
                          <F label="Exit price (₹)"><input type="number" step="any" value={rv.exitPrice} onChange={(ev) => patchReview(e.id, { exitPrice: ev.target.value })} className={input} /></F>
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
                          <button onClick={() => remove(e.id)} className="text-xs text-red-600 hover:underline">delete entry</button>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">
        Saved in your Valuation Ledger database (same on every device). "Now", the 200D EMA / weekly RSI checks and the stop-loss alert use the last close in the daily NSE store, not a live quote. Logging a buy here does not place an order and is not
        investment advice.
      </p>
    </div>
  );
}
