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
};
export type Check = { id: string; text: string; auto?: "ema200" | "rsiw" | "fund" | "alloc" | "stop" };
export type Doc = { checklist: Check[] | null; entries: Entry[] };

export const NEAR_PCT = 3;
export type StopState = "hit" | "near" | "ok" | "none";

export const isClosed = (e: Entry) => !!e.review?.exitPrice && Number.isFinite(parseFloat(e.review.exitPrice));

export function stopState(e: Entry, price: number | undefined): StopState {
  if (isClosed(e) || e.stop === null || price === undefined || !Number.isFinite(price)) return "none";
  if (price <= e.stop) return "hit";
  if (price <= e.stop * (1 + NEAR_PCT / 100)) return "near";
  return "ok";
}

/** Open journal entries whose last close is at/near the stop-loss. Loaded once, a few seconds after the app opens. */
export function useStopAlerts(delayMs = 0): { hit: Entry[]; near: Entry[] } {
  const [st, setSt] = useState<{ hit: Entry[]; near: Entry[] }>({ hit: [], near: [] });
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      Promise.all([api.getJournal(), api.getBhavTechnicals()])
        .then(([j, b]) => {
          if (cancelled) return;
          const px = new Map<string, number>((b.rows ?? []).map((x: any) => [x.symbol, x.price]));
          const hit: Entry[] = [];
          const near: Entry[] = [];
          for (const e of j.entries ?? []) {
            const s = stopState(e, px.get(e.symbol));
            if (s === "hit") hit.push(e);
            else if (s === "near") near.push(e);
          }
          setSt({ hit, near });
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
  const { hit, near } = useStopAlerts(3000);
  if (!hit.length && !near.length) return null;
  const red = hit.length > 0;
  return (
    <span
      className={`ml-1 text-[10px] leading-none px-1.5 py-0.5 rounded-full text-white align-middle ${red ? "bg-red-600" : "bg-amber-500"}`}
      title={red ? `Stop-loss hit: ${hit.map((e) => e.symbol).join(", ")}` : `Within ${NEAR_PCT}% of the stop: ${near.map((e) => e.symbol).join(", ")}`}
    >
      {red ? hit.length : near.length}
    </span>
  );
}
