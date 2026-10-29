import { fmtNum } from "./ScreenerTable";

// % below a high (0 = at the high); green within 10%, amber 10-25% below, red further — the same zones as the Portfolio page.
// Shared by Blockbuster Results and Blockbuster Guidances (2026-10-29).
export function FromHigh({ v, what, at }: { v: number | null | undefined; what: string; at: string }) {
  if (v == null) return <span className="text-slate-300" title={`no ${what} figure in the daily store for this stock`}>—</span>;
  const cls = v >= -10 ? "text-emerald-600" : v >= -25 ? "text-amber-600" : "text-red-600";
  return (
    <span className={`${cls} font-medium`} title={v >= -0.05 ? `at or making a fresh ${what}` : `${fmtNum(-v, 1)}% below the ${what}`}>
      {v >= -0.05 ? at : fmtNum(v, 1)}
    </span>
  );
}
