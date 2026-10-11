import { useEffect, useState } from "react";
import { api } from "./api";

// Shared by the three Business tabs (Radar, Sectors, Company): the accumulated
// news items (api/_business.py), the all-stocks technicals for price/mcap, and the
// scoring rules, so the tabs always agree with each other.

export interface Item {
  d: string; // ISO date
  t: string; // headline
  s: string; // source
  u?: string; // link (the list payload only carries the newest one's)
  g: string[]; // tags
  a: number | null; // ₹ crore mentioned in the headline
}
export interface Radar {
  as_of: string | null;
  updated?: string;
  items: Record<string, Item[]>;
  names: Record<string, string>;
  sectors?: Record<string, string>;
  stats?: Record<string, any>;
  keep_days?: number;
}

// weight of a story by its strongest tag; Risk counts against
export const TAG_WEIGHT: Record<string, number> = {
  Order: 3,
  Capex: 3,
  "M&A / JV": 2,
  "Approval / Launch": 2,
  Partnership: 1.5,
  Funding: 1,
  Outlook: 1,
  "Concall / Presentation": 0.5,
  Risk: -2,
};
export const TAG_ORDER = Object.keys(TAG_WEIGHT);
export const TAG_CLASS: Record<string, string> = {
  Order: "bg-emerald-50 text-emerald-700 border-emerald-300",
  Capex: "bg-sky-50 text-sky-700 border-sky-300",
  "M&A / JV": "bg-violet-50 text-violet-700 border-violet-300",
  "Approval / Launch": "bg-teal-50 text-teal-700 border-teal-300",
  Partnership: "bg-indigo-50 text-indigo-700 border-indigo-300",
  Funding: "bg-amber-50 text-amber-700 border-amber-300",
  Outlook: "bg-slate-100 text-slate-700 border-slate-300",
  "Concall / Presentation": "bg-slate-100 text-slate-600 border-slate-300",
  Risk: "bg-red-50 text-red-700 border-red-300",
};

export function primaryTag(tags: string[]): string {
  return tags.slice().sort((a, b) => Math.abs(TAG_WEIGHT[b] ?? 0) - Math.abs(TAG_WEIGHT[a] ?? 0))[0] ?? "";
}
export function ageDays(d: string, now: number): number {
  return Math.max(0, (now - new Date(d + "T00:00:00Z").getTime()) / 86400000);
}
export function fmtCr(v: number | null | undefined): string {
  if (v == null || !isFinite(v) || v <= 0) return "";
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0);
}
export const tvUrl = (sym: string) => `https://www.tradingview.com/chart/?symbol=NSE%3A${encodeURIComponent(sym)}`;
export const chartPath = (sym: string) => `/portfolio-charts/${encodeURIComponent(sym)}`;
export const companyPath = (sym: string) => `/business-radar?tab=company&symbol=${encodeURIComponent(sym)}`;

export interface Stats {
  items: Item[]; // in the window, newest first
  stories: number;
  tagCounts: Record<string, number>;
  score: number;
  raw: number; // tag weights summed over the distinct stories, no age decay (for window-vs-window comparisons)
  valueCr: number;
  last: string;
}

/** Items of one company between `from` and `to` days old, as distinct stories. A story is the strongest tag plus
 *  the ₹ amount (outlets repeat the same news a dozen times, so one order counts once). */
export function storyStats(all: Item[], from: number, to: number, now: number): Stats | null {
  const inWin = all.filter((i) => {
    const a = ageDays(i.d, now);
    return a >= from && a <= to;
  });
  if (!inWin.length) return null;
  const seen = new Set<string>();
  const tagCounts: Record<string, number> = {};
  let score = 0;
  let raw = 0;
  let valueCr = 0;
  let stories = 0;
  for (const i of inWin) {
    const pt = primaryTag(i.g);
    const key = i.a != null ? `${pt}:${Math.round(i.a)}` : `${pt}:${i.t.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 50)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stories++;
    for (const g of i.g) tagCounts[g] = (tagCounts[g] ?? 0) + 1;
    score += (TAG_WEIGHT[pt] ?? 0) * Math.pow(0.5, ageDays(i.d, now) / 30);
    raw += TAG_WEIGHT[pt] ?? 0;
    if (i.a != null && ["Order", "Capex", "M&A / JV"].includes(pt)) valueCr += i.a;
  }
  return { items: inWin, stories, tagCounts, score: Math.round(score * 10) / 10, raw, valueCr, last: inWin[0].d };
}

let radarP: Promise<Radar> | null = null;
let techP: Promise<Map<string, any>> | null = null;

export function useBusinessData(): { radar: Radar | null; tech: Map<string, any>; err: string | null } {
  const [radar, setRadar] = useState<Radar | null>(null);
  const [tech, setTech] = useState<Map<string, any>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    radarP = radarP ?? api.getBusinessRadar();
    radarP.then((r) => !off && setRadar(r)).catch((e: any) => {
      radarP = null;
      if (!off) setErr(String(e?.message ?? e));
    });
    techP = techP ?? api.getBhavTechnicals().then((r) => new Map<string, any>((r.rows ?? []).map((x: any) => [x.symbol, x])));
    techP.then((m) => !off && setTech(m)).catch(() => {
      techP = null;
    });
    return () => {
      off = true;
    };
  }, []);
  return { radar, tech, err };
}
