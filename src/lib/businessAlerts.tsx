import { useMemo, useState } from "react";
import { useData, useScreeners } from "../App";
import { Radar, Story, buildStories, ageDays, useBusinessData } from "./businessData";

// High-worth news on the stocks you actually hold or watch. "New" means dated after the day you last
// pressed "Mark as seen" (kept in localStorage); the Radar card lists the last 7 days either way.

export interface Alert {
  symbol: string;
  name: string;
  mine: "holding" | "watchlist" | "both";
  story: Story;
  isNew: boolean;
}

const SEEN_KEY = "biz.alertsSeen";
const today = () => new Date().toISOString().slice(0, 10);
function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function useBusinessAlerts(delayMs = 0, windowDays = 7): { alerts: Alert[]; unseen: number; markSeen: () => void; ready: boolean } {
  const { bundle } = useData();
  useScreeners(["portfolioAllocation"]);
  const { radar, tech } = useBusinessData(delayMs);
  const [seen, setSeen] = useState(readSeen);
  const holdings = useMemo(() => new Set<string>(((bundle.momentum_screeners as any)?.portfolioAllocation?.rows ?? []).filter((r: any) => !r.is_fund).map((r: any) => r.symbol)), [bundle]);
  const watch = useMemo(() => new Set<string>(bundle.watchlist?.tickers ?? []), [bundle]);

  const alerts = useMemo<Alert[]>(() => {
    if (!radar || (holdings.size === 0 && watch.size === 0)) return [];
    return computeAlerts(radar, tech, holdings, watch, windowDays, seen);
  }, [radar, tech, holdings, watch, windowDays, seen]);

  return {
    alerts,
    unseen: alerts.filter((a) => a.isNew).length,
    markSeen: () => {
      const d = today();
      setSeen(d);
      try {
        localStorage.setItem(SEEN_KEY, d);
      } catch {
        // best-effort persistence
      }
    },
    ready: !!radar,
  };
}

export function computeAlerts(radar: Radar, tech: Map<string, any>, holdings: Set<string>, watch: Set<string>, windowDays: number, seenDay: string): Alert[] {
  const now = Date.now();
  const out: Alert[] = [];
  for (const sym of new Set([...holdings, ...watch])) {
    const all = radar.items[sym];
    if (!all) continue;
    const mcap = tech.get(sym)?.market_cap_cr ?? null;
    for (const st of buildStories(all.filter((i) => ageDays(i.d, now) <= windowDays + 2), mcap)) {
      if (st.tier !== "High" || ageDays(st.last, now) > windowDays) continue;
      out.push({
        symbol: sym,
        name: radar.names[sym] ?? sym,
        mine: holdings.has(sym) && watch.has(sym) ? "both" : holdings.has(sym) ? "holding" : "watchlist",
        story: st,
        isNew: st.last > seenDay,
      });
    }
  }
  // holdings before watchlist, then newest, then most worthy
  const rank = (a: Alert) => (a.mine === "watchlist" ? 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b) || (a.story.last < b.story.last ? 1 : a.story.last > b.story.last ? -1 : b.story.worth - a.story.worth));
}

/** The red count on the 🧭 Business nav link (loads the data a few seconds after the app opens). */
export function BusinessNavBadge() {
  const { unseen } = useBusinessAlerts(4000);
  if (!unseen) return null;
  return (
    <span className="ml-1 text-[10px] leading-none px-1.5 py-0.5 rounded-full bg-red-600 text-white align-middle" title={`${unseen} new High-worth stories on your holdings/watchlist`}>
      {unseen}
    </span>
  );
}
