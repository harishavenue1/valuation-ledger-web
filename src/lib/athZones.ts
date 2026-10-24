// A/B/C zones by % from all-time high — shared by Portfolio Allocation and Watchlist (2026-10-24)

export const ZONES: { label: string; letter: string; title: string; tint: string; badge: { bg: string; fg: string } }[] = [
  { label: "🔥 0% to -10%", letter: "A", title: "A · 🔥 Near ATH — within 10% of the all-time high", tint: "bg-[rgba(46,160,67,0.14)]", badge: { bg: "#2ea043", fg: "#ffffff" } },
  { label: "🚶 -10% to -25%", letter: "B", title: "B · 🚶 Mid — 10% to 25% below the all-time high", tint: "bg-[rgba(250,204,21,0.17)]", badge: { bg: "#facc15", fg: "#3b3200" } },
  { label: "🐢 Below -25%", letter: "C", title: "C · 🐢 Below — more than 25% under the all-time high", tint: "bg-[rgba(249,115,22,0.15)]", badge: { bg: "#f97316", fg: "#ffffff" } },
  { label: "Unclassified", letter: "", title: "No ATH data", tint: "", badge: { bg: "", fg: "" } },
];

export function proximityBucketFor(pctFromHigh: number | null | undefined): string {
  if (pctFromHigh == null) return "Unclassified";
  if (pctFromHigh >= -10) return "🔥 0% to -10%";
  if (pctFromHigh >= -25) return "🚶 -10% to -25%";
  return "🐢 Below -25%";
}
