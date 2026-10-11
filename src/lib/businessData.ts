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

// ── materiality: which stories are worth reading ─────────────────────────────
// A keyword tag says what a headline is ABOUT, not whether it matters. A story (all the headlines about
// one event) is scored on: how big it is against the company (₹ amount / market cap), whether it is done
// or only planned, how many outlets carry it, and who they are.

export type Tier = "High" | "Medium" | "Low";
export const TIER_MIN: Record<Tier, number> = { High: 4, Medium: 2, Low: 0 };
export const TIER_CLASS: Record<Tier, string> = {
  High: "bg-emerald-600 text-white border-emerald-600",
  Medium: "bg-sky-100 text-sky-800 border-sky-300",
  Low: "bg-slate-100 text-slate-500 border-slate-300",
};

const TIER1 =
  /economic times|\bet\b|business standard|moneycontrol|mint\b|livemint|businessline|cnbc|ndtv profit|financial express|reuters|bloomberg|the hindu|\bpti\b|business today|zee business|hindustan times|times of india|india today|outlook business|forbes|ianslife|fortune india|exchange filing|bse|nse/i;
const CONFIRMED = /\b(bags?|bagged|wins?|won|secures?|secured|receives?|received|awarded|commissions?|commissioned|approves?|approved|completes?|completed|signs?|signed|inks?|inked|acquires?|acquired|launches?|launched|incorporates?|allots?|allotted|gets|raises|clears?|cleared|begins?|starts?|started|operationali[sz]es?)\b/i;
const SPECULATIVE = /\b(plans?|eyes?|may|could|likely|in talks|considers?|considering|proposes?|proposed|expects?|aims?|targets?|set to|looking to|to (acquire|invest|launch|set up|raise|buy)|mulls?|weighs?|bids?)\b/i;
const NOISE = /stocks? to (watch|buy)|buzzing|top gainers|technical|chart pattern|breakout stock|price target|target price|agm\b|\besg\b|rating (upgrade|downgrade)|record date|dividend|trading window|share price (today|live)|why is .* (stock|share)|should you (buy|sell)/i;

const STOPW = new Set(["the", "and", "for", "with", "from", "that", "this", "its", "has", "have", "will", "after", "over", "into", "shares", "share", "stock", "limited", "ltd", "crore", "worth", "rs"]);
function words(t: string): Set<string> {
  return new Set(
    t
      .toLowerCase()
      .replace(/[^a-z0-9₹. ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPW.has(w)),
  );
}
function jaccard(a: Set<string>, b: Set<string>): number {
  let n = 0;
  a.forEach((w) => b.has(w) && n++);
  const u = a.size + b.size - n;
  return u ? n / u : 0;
}

// Every ₹/$ amount in a headline (the stored `a` is only the largest). A headline can mention the deal AND
// something bigger ("₹412 crore order win; intake crosses ₹2,000 crore"), so stories are matched on any of them.
const AMT_RX = /(?:₹|rs\.?|inr)\s?([\d,]+(?:\.\d+)?)\s?(lakh crore|crores?|cr\b|lakh|bn\b|billion|mn\b|million)|(?:us ?\$|\$|usd)\s?([\d,]+(?:\.\d+)?)\s?(bn\b|billion|mn\b|million)/gi;
const NOT_A_DEAL_SIZE = /order ?book|backlog|pipeline|market ?cap|m-?cap|valuation|turnover|revenue|\bsales\b|net worth|\bdebt\b|borrowing|\bprofit|\bpat\b|ebitda|\bcash\b|\bgdv\b|intake/i;
const UNIT_CR: Record<string, number> = { "lakh crore": 1e5, crore: 1, crores: 1, cr: 1, lakh: 0.01, bn: 100, billion: 100, mn: 0.1, million: 0.1 };
function amountsOf(t: string): number[] {
  const out: number[] = [];
  for (const m of t.matchAll(AMT_RX)) {
    const around = t.slice(Math.max(0, (m.index ?? 0) - 24), (m.index ?? 0) + m[0].length + 14);
    if (NOT_A_DEAL_SIZE.test(around)) continue;
    const usd = m[3] != null;
    const num = parseFloat((usd ? m[3] : m[1]).replace(/,/g, ""));
    const unit = (usd ? m[4] : m[2]).toLowerCase();
    if (Number.isNaN(num)) continue;
    out.push(usd ? (num * (unit === "bn" || unit === "billion" ? 1e9 : 1e6) * 88) / 1e7 : num * (UNIT_CR[unit] ?? 1));
  }
  return out;
}
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, Math.min(a, b) * 0.02);

export interface Story {
  tag: string; // strongest tag
  tags: string[];
  items: Item[]; // every headline about it, newest first
  lead: Item; // the headline to show (best source, newest)
  sources: number; // distinct outlets
  first: string;
  last: string;
  amount: number | null;
  confirmed: boolean | null; // null = unclear
  pct: number | null; // amount as % of market cap
  worth: number;
  tier: Tier;
  why: string[]; // the reasons behind the score, for the tooltip
}

export function buildStories(all: Item[], mcap: number | null): Story[] {
  const sorted = all.filter((i) => !NOISE.test(i.t)).sort((a, b) => (a.d < b.d ? 1 : -1));
  const clusters: { items: Item[]; w: Set<string>; pt: string; amt: number | null; amts: number[][] }[] = [];
  for (const it of sorted) {
    const pt = primaryTag(it.g);
    const w = words(it.t);
    const ams = amountsOf(it.t);
    let hit: (typeof clusters)[number] | undefined;
    for (const c of clusters) {
      if (c.pt !== pt) continue;
      const near = Math.abs(new Date(c.items[0].d).getTime() - new Date(it.d).getTime()) <= 6 * 86400000;
      const sameAmt = ams.some((x) => c.amts.some((set) => set.some((y) => close(x, y))));
      if ((sameAmt && near) || (near && jaccard(w, c.w) >= 0.45)) {
        hit = c;
        break;
      }
    }
    if (hit) {
      hit.items.push(it);
      hit.amts.push(ams);
    } else clusters.push({ items: [it], w, pt, amt: null, amts: [ams] });
  }
  for (const c of clusters) {
    // the story's amount = the figure most of its headlines agree on (ties: the smaller, i.e. the deal not the backdrop)
    const tally = new Map<number, number>();
    for (const set of c.amts) for (const x of set) {
      const key = Array.from(tally.keys()).find((k) => close(k, x)) ?? x;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    let best: number | null = null;
    let bestN = 0;
    tally.forEach((n, k) => {
      if (n > bestN || (n === bestN && best != null && k < best)) {
        best = k;
        bestN = n;
      }
    });
    c.amt = best;
  }
  return clusters.map((c) => {
    const srcSet = new Set(c.items.map((i) => (i.s || "").toLowerCase()).filter(Boolean));
    const sources = Math.max(1, srcSet.size);
    const lead = c.items.slice().sort((a, b) => Number(TIER1.test(b.s)) - Number(TIER1.test(a.s)) || (a.d < b.d ? 1 : -1))[0];
    const tags = Array.from(new Set(c.items.flatMap((i) => i.g)));
    const text = c.items.map((i) => i.t).join(" | ");
    const confirmed = CONFIRMED.test(lead.t) ? true : SPECULATIVE.test(text) ? false : null;
    const why: string[] = [];
    let w = Math.abs(TAG_WEIGHT[c.pt] ?? 1);
    why.push(`${c.pt} ${w}`);
    let size = 0.9;
    const pct = c.amt != null && mcap ? (c.amt / mcap) * 100 : null;
    if (pct != null) {
      size = pct >= 10 ? 2 : pct >= 3 ? 1.5 : pct >= 1 ? 1.1 : pct >= 0.3 ? 0.8 : 0.4;
      why.push(`₹${fmtCr(c.amt)} Cr = ${pct.toFixed(1)}% of mcap ×${size}`);
    } else if (c.amt != null) why.push(`₹${fmtCr(c.amt)} Cr`);
    const conf = confirmed === true ? 1 : confirmed === false ? 0.6 : 0.8;
    why.push(confirmed === true ? "done deal" : confirmed === false ? "planned/possible ×0.6" : "status unclear ×0.8");
    const corr = sources >= 3 ? 1.3 : sources === 2 ? 1.1 : 0.8;
    why.push(`${sources} outlet${sources > 1 ? "s" : ""} ×${corr}`);
    const src = TIER1.test(lead.s) ? 1.1 : 1;
    if (src > 1) why.push("major outlet ×1.1");
    w = w * size * conf * corr * src;
    const worth = Math.round(w * 10) / 10;
    return {
      tag: c.pt,
      tags,
      items: c.items,
      lead,
      sources,
      first: c.items[c.items.length - 1].d,
      last: c.items[0].d,
      amount: c.amt,
      confirmed,
      pct,
      worth,
      tier: worth >= TIER_MIN.High ? "High" : worth >= TIER_MIN.Medium ? "Medium" : "Low",
      why,
    };
  });
}

export interface Stats {
  items: Item[]; // headlines of the kept stories, newest first
  stories: Story[];
  nStories: number;
  tagCounts: Record<string, number>; // stories per strongest tag
  score: number;
  raw: number; // Σ worth, no age decay (window-vs-window comparisons)
  valueCr: number;
  last: string;
}

/** Stories of one company between `from` and `to` days old that are at least `minTier` worthy. Risk stories
 *  count against the score. */
export function storyStats(all: Item[], from: number, to: number, now: number, mcap: number | null, minTier: Tier = "Medium"): Stats | null {
  const inWin = all.filter((i) => {
    const a = ageDays(i.d, now);
    return a >= from && a <= to;
  });
  if (!inWin.length) return null;
  const kept = buildStories(inWin, mcap).filter((st) => st.worth >= TIER_MIN[minTier]);
  if (!kept.length) return null;
  const tagCounts: Record<string, number> = {};
  let score = 0;
  let raw = 0;
  let valueCr = 0;
  for (const st of kept) {
    tagCounts[st.tag] = (tagCounts[st.tag] ?? 0) + 1;
    const sign = st.tag === "Risk" ? -1 : 1;
    score += sign * st.worth * Math.pow(0.5, ageDays(st.last, now) / 30);
    raw += sign * st.worth;
    if (st.amount != null && ["Order", "Capex", "M&A / JV"].includes(st.tag)) valueCr += st.amount;
  }
  kept.sort((a, b) => (a.last < b.last ? 1 : -1));
  return {
    items: kept.flatMap((st) => st.items).sort((a, b) => (a.d < b.d ? 1 : -1)),
    stories: kept,
    nStories: kept.length,
    tagCounts,
    score: Math.round(score * 10) / 10,
    raw: Math.round(raw * 10) / 10,
    valueCr,
    last: kept[0].last,
  };
}

export function useMinTier(): [Tier, (t: Tier) => void] {
  const [t, setT] = useState<Tier>(() => {
    try {
      const v = localStorage.getItem("biz.minTier");
      return v === "High" || v === "Low" || v === "Medium" ? v : "Medium";
    } catch {
      return "Medium";
    }
  });
  return [
    t,
    (v: Tier) => {
      setT(v);
      try {
        localStorage.setItem("biz.minTier", v);
      } catch {
        // best-effort persistence
      }
    },
  ];
}

let radarP: Promise<Radar> | null = null;
let techP: Promise<Map<string, any>> | null = null;

export function useBusinessData(delayMs = 0): { radar: Radar | null; tech: Map<string, any>; err: string | null } {
  const [radar, setRadar] = useState<Radar | null>(null);
  const [tech, setTech] = useState<Map<string, any>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    let timer: any = null;
    const go = () => {
    radarP = radarP ?? api.getBusinessRadar();
    radarP.then((r) => !off && setRadar(r)).catch((e: any) => {
      radarP = null;
      if (!off) setErr(String(e?.message ?? e));
    });
    techP = techP ?? api.getBhavTechnicals().then((r) => new Map<string, any>((r.rows ?? []).map((x: any) => [x.symbol, x])));
    techP.then((m) => !off && setTech(m)).catch(() => {
      techP = null;
    });
    };
    if (delayMs > 0) timer = setTimeout(go, delayMs);
    else go();
    return () => {
      off = true;
      clearTimeout(timer);
    };
  }, []);
  return { radar, tech, err };
}
