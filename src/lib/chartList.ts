// The Charts page can browse either the portfolio or the list currently on
// screen in All Technicals (filters + sort included). All Technicals writes the
// list here when "Open in Charts" is clicked; the Charts page reads it. Plain
// localStorage: the list is a snapshot, so a later filter change in the other
// tab doesn't reshuffle the chart sidebar under you.
export interface ChartListItem {
  symbol: string;
  name?: string;
  metric: number | null; // 3M % for the technicals list
  day: number | null;
  ath: number | null;
  wh52: number | null;
}

export interface ChartList {
  label: string; // e.g. "ATH within 10% · 3M > 27%"
  savedAt: string;
  items: ChartListItem[];
}

const LIST_KEY = "chartsTechnicalsList";
const SOURCE_KEY = "chartsListSource";
export type ChartSource = "portfolio" | "technicals";

export function saveChartList(list: ChartList) {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
    localStorage.setItem(SOURCE_KEY, "technicals");
  } catch {
    // best-effort
  }
}

export function loadChartList(): ChartList | null {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (!raw) return null;
    const l = JSON.parse(raw);
    return l && Array.isArray(l.items) ? l : null;
  } catch {
    return null;
  }
}

export function loadChartSource(): ChartSource {
  try {
    return localStorage.getItem(SOURCE_KEY) === "technicals" ? "technicals" : "portfolio";
  } catch {
    return "portfolio";
  }
}

export function saveChartSource(s: ChartSource) {
  try {
    localStorage.setItem(SOURCE_KEY, s);
  } catch {
    // best-effort
  }
}
