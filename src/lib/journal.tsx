import { useEffect, useState } from "react";
import { api } from "./api";

// Shared by the Trade Journal page and the 📓 nav badge (2026-10-25). The stop-loss ALERT works on the daily NSE store's
// last close (same feed as All Technicals), so it fires after the evening update, not intraday — a real-time stop still
// belongs in a broker GTT / Kite alert. "hit" = last close at or below the stop; "near" = within NEAR_PCT above it.

export type Snap = { text: string; ok: boolean };
export type Review = { exitDate: string; exitPrice: string; plan: "" | "yes" | "partly" | "no"; lesson: string };
export type Entry = {
  id: string;
  symbol: string;
  date: string;
  qty: number;
  price: number;
  allocPct: number | null; // % of the portfolio put into this buy
  allocReason: string;
  stop0: number | null; // stop-loss price decided at entry (risk is measured against this)
  stop: number | null; // stop-loss price now — trailed up as the trade works
  target: number | null;
  fundTrigger: "yes" | "no";
  fundNote: string; // the fundamental trigger, in a few words
  ema200Pct: number | null; // % above(+)/below(-) the 200D EMA on the day of the buy, from the store
  rsiW: number | null; // weekly RSI on the day of the buy, from the store
  setup: string;
  reason: string;
  state: string;
  confidence: number;
  checks: Snap[];
  review?: Review;
  // set on trades the PF-update skill noticed in Kite: the buy/sell is recorded, the reason is still owed
  pending?: boolean;
  source?: "kite";
  priceApprox?: boolean; // price was inferred (no executed price available) — correct it if you know it
};
export type Check = { id: string; text: string; auto?: "ema200" | "rsiw" | "fund" | "alloc" | "stop" };
export type Sell = {
  id: string;
  symbol: string;
  date: string;
  qty: number;
  price: number;
  reason: string;
  state: string;
  plan: "" | "yes" | "partly" | "no";
  lesson: string;
  pending?: boolean;
  source?: "kite";
  priceApprox?: boolean;
};
// what the server queues in `journal_inbox` — a pending Entry (type "buy") or Sell (type "sell")
export type InboxItem = ((Entry & { type: "buy" }) | (Sell & { type: "sell" }));
export type Doc = { checklist: Check[] | null; entries: Entry[]; sells: Sell[] };

export const NEAR_PCT = 3;
export type StopState = "hit" | "near" | "ok" | "none";

export const isClosed = (e: Entry) => !!e.review?.exitPrice && Number.isFinite(parseFloat(e.review.exitPrice));

// ---- selling (2026-10-25, "add selling section ... breakdown to the existing summary of the entry") ----
// Sales are logged per stock and matched against its buys oldest-first (FIFO, the same order the tax rules use), so every
// buy lot knows how much of it is still held and what the sold part realised. A buy fully closed through the older
// per-entry review box (exit price) counts as sold out at that price.
export type Lot = { entry: Entry; remaining: number; sold: number; realized: number };
export type SaleResult = { sell: Sell; pl: number; cost: number; matched: number; short: number; heldDays: number | null };
export type SymbolBook = {
  symbol: string;
  lots: Lot[]; // every buy lot, oldest first (including ones sold out)
  sales: SaleResult[];
  bought: number;
  sold: number;
  left: number;
  costLeft: number; // cost of what is still held
  avgLeft: number;
  avgBuy: number; // average over ALL buys
  avgSell: number | null;
  realized: number; // ₹, sales + legacy review exits
  realizedCost: number; // cost basis of what was sold
};
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export function matchSale(lots: Lot[], sale: { date: string; qty: number; price: number }, commit: boolean) {
  let left = sale.qty;
  let cost = 0;
  let firstDate: string | null = null;
  for (const l of lots) {
    if (left <= 0) break;
    if (l.entry.date > sale.date || l.remaining <= 0) continue;
    const take = Math.min(l.remaining, left);
    if (commit) {
      l.remaining -= take;
      l.sold += take;
      l.realized += take * (sale.price - l.entry.price);
    }
    cost += take * l.entry.price;
    firstDate = firstDate ?? l.entry.date;
    left -= take;
  }
  const matched = sale.qty - left;
  return { matched, short: left, cost, pl: matched * sale.price - cost, heldDays: firstDate ? days(firstDate, sale.date) : null };
}

export function buildBooks(entries: Entry[], sells: Sell[]): Map<string, SymbolBook> {
  const books = new Map<string, SymbolBook>();
  for (const sym of new Set([...entries.map((e) => e.symbol), ...sells.map((x) => x.symbol)])) {
    const lots: Lot[] = entries
      .filter((e) => e.symbol === sym)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map((entry) => {
        const ex = isClosed(entry) ? parseFloat(entry.review!.exitPrice) : NaN;
        return Number.isFinite(ex) ? { entry, remaining: 0, sold: entry.qty, realized: entry.qty * (ex - entry.price) } : { entry, remaining: entry.qty, sold: 0, realized: 0 };
      });
    const sales: SaleResult[] = sells
      .filter((x) => x.symbol === sym)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map((sell) => {
        const m = matchSale(lots, sell, true);
        return { sell, pl: m.pl, cost: m.cost, matched: m.matched, short: m.short, heldDays: m.heldDays };
      });
    const bought = lots.reduce((a, l) => a + l.entry.qty, 0);
    const left = lots.reduce((a, l) => a + l.remaining, 0);
    const costLeft = lots.reduce((a, l) => a + l.remaining * l.entry.price, 0);
    const soldQty = lots.reduce((a, l) => a + l.sold, 0);
    const realizedCost = lots.reduce((a, l) => a + l.sold * l.entry.price, 0);
    const realized = lots.reduce((a, l) => a + l.realized, 0);
    books.set(sym, {
      symbol: sym, lots, sales, bought, sold: soldQty, left, costLeft,
      avgLeft: left ? costLeft / left : 0,
      avgBuy: bought ? lots.reduce((a, l) => a + l.entry.qty * l.entry.price, 0) / bought : 0,
      avgSell: soldQty ? (realized + realizedCost) / soldQty : null,
      realized, realizedCost,
    });
  }
  return books;
}

export function stopState(e: Entry, price: number | undefined): StopState {
  if (isClosed(e) || e.stop === null || !(e.stop > 0) || price === undefined || !Number.isFinite(price)) return "none";
  if (price <= e.stop) return "hit";
  if (price <= e.stop * (1 + NEAR_PCT / 100)) return "near";
  return "ok";
}

/** Open journal entries whose last close is at/near the stop-loss. Loaded once, a few seconds after the app opens. */
export function useStopAlerts(delayMs = 0): { hit: Entry[]; near: Entry[]; pending: number } {
  const [st, setSt] = useState<{ hit: Entry[]; near: Entry[]; pending: number }>({ hit: [], near: [], pending: 0 });
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      Promise.all([api.getJournal(), api.getBhavTechnicals()])
        .then(([j, b]) => {
          if (cancelled) return;
          const px = new Map<string, number>((b.rows ?? []).map((x: any) => [x.symbol, x.price]));
          const hit: Entry[] = [];
          const near: Entry[] = [];
          const books = buildBooks(j.entries ?? [], j.sells ?? []);
          const held = new Set<string>();
          for (const bk of books.values()) for (const l of bk.lots) if (l.remaining > 0) held.add(l.entry.id);
          for (const e of j.entries ?? []) {
            if (!held.has(e.id)) continue;
            const s = stopState(e, px.get(e.symbol));
            if (s === "hit") hit.push(e);
            else if (s === "near") near.push(e);
          }
          const pending = (j.inbox ?? []).length + (j.entries ?? []).filter((e: Entry) => e.pending).length + (j.sells ?? []).filter((x: Sell) => x.pending).length;
          setSt({ hit, near, pending });
        })
        .catch(() => {});
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [delayMs]);
  return st;
}

/** The count on the 📓 Journal nav link: red = stop-loss hit, amber = within NEAR_PCT of it. */
export function JournalNavBadge() {
  const { hit, near, pending } = useStopAlerts(3000);
  if (!hit.length && !near.length && !pending) return null;
  const red = hit.length > 0;
  const amber = !red && near.length > 0;
  return (
    <span
      className={`ml-1 text-[10px] leading-none px-1.5 py-0.5 rounded-full text-white align-middle ${red ? "bg-red-600" : amber ? "bg-amber-500" : "bg-indigo-600"}`}
      title={
        red ? `Stop-loss hit: ${hit.map((e) => e.symbol).join(", ")}` : amber ? `Within ${NEAR_PCT}% of the stop: ${near.map((e) => e.symbol).join(", ")}` : `${pending} Kite trade${pending === 1 ? "" : "s"} waiting for your reason`
      }
    >
      {red ? hit.length : amber ? near.length : `✍ ${pending}`}
    </span>
  );
}
