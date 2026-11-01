import type { ReactNode } from "react";
import { Key, colPath, fmtSigned, useTip } from "./DebateViz";

// Charts for the Company Edge page: a number management STATED on calls over the years, the listed peer group on sales, and how many calls were read per year.
// Same rules as DebateViz (pure SVG, tokens, 4px rounded data ends on a square baseline, hairline grid, tooltip on every mark, text in text tokens).

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** a figure stated on calls, one column per call in date order (the tooltip carries the sentence it was read from) */
export function StatedBars({ points, unit = "%", max, color = "var(--s1)" }: { points: { label: string; v: number; tip: ReactNode }[]; unit?: string; max?: number; color?: string }) {
  const { box, show, hide, node } = useTip();
  if (!points.length) return <div style={{ fontSize: 12, color: "var(--muted)" }}>Never stated as a number on the calls read.</div>;
  const n = points.length;
  const top = max ?? Math.max(10, Math.ceil(Math.max(...points.map((p) => p.v)) / 10) * 10);
  const W = 420, H = 150, L = 30, R = 6, T = 14, B = 34, pw = W - L - R, ph = H - T - B, slot = pw / n, bw = Math.min(26, slot - 6);
  const y = (v: number) => T + ph - (Math.min(v, top) / top) * ph;
  return (
    <div ref={box} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={points.map((p) => `${p.label} ${p.v}${unit}`).join(", ")}>
        {[0, top / 2, top].map((t, i) => (
          <g key={`g${i}`}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={i === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            <text x={L - 5} y={y(t) + 3} textAnchor="end" fontSize={9.5} fill="var(--muted)">{t}{i === 2 ? unit : ""}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = L + i * slot + (slot - bw) / 2;
          return (
            <g key={i}>
              <path d={colPath(x, bw, T + ph, y(p.v))} fill={color} />
              <text x={x + bw / 2} y={y(p.v) - 4} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="var(--ink)">{p.v % 1 ? p.v.toFixed(1) : p.v}</text>
              <text x={x + bw / 2} y={H - 18} textAnchor="middle" fontSize={8.5} fill="var(--muted)">{p.label.split(" ")[0]}</text>
              <text x={x + bw / 2} y={H - 7} textAnchor="middle" fontSize={8.5} fill="var(--muted)">’{p.label.slice(-2)}</text>
              <rect x={L + i * slot} y={0} width={slot} height={H} fill="transparent" onMouseMove={(e) => show(e, p.tip)} onMouseLeave={hide} />
            </g>
          );
        })}
      </svg>
      {node}
    </div>
  );
}

/** the listed peer group on latest-quarter sales, the company highlighted: how big is it against the others it is compared with */
export function PeerBars({ rows, me }: { rows: { symbol: string; name: string; sales_q: number | null; mcap_cr: number | null }[]; me: string }) {
  const { box, show, hide, node } = useTip();
  const list = rows.filter((r) => isNum(r.sales_q)).sort((a, b) => (b.sales_q as number) - (a.sales_q as number)).slice(0, 12);
  if (list.length < 2) return <div style={{ fontSize: 12, color: "var(--muted)" }}>Too few listed peers to compare.</div>;
  const mx = Math.max(...list.map((r) => r.sales_q as number));
  const rowH = 24, W = 420, L = 118, R = 56, H = list.length * rowH + 6, pw = W - L - R;
  return (
    <div ref={box} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={list.map((r) => `${r.name} ${Math.round(r.sales_q as number)} crore`).join(", ")}>
        <line x1={L} x2={L} y1={0} y2={H} stroke="var(--axis)" strokeWidth={1} />
        {list.map((r, i) => {
          const w = ((r.sales_q as number) / mx) * pw, y = i * rowH + 5, isMe = r.symbol === me;
          return (
            <g key={r.symbol}>
              <text x={L - 8} y={y + 11} textAnchor="end" fontSize={10} fontWeight={isMe ? 700 : 400} fill={isMe ? "var(--ink)" : "var(--ink2)"}>{r.name.length > 18 ? r.name.slice(0, 17) + "…" : r.name}</text>
              <path d={`M${L},${y}L${L + Math.max(2, w) - 4},${y}Q${L + Math.max(2, w)},${y} ${L + Math.max(2, w)},${y + 4}L${L + Math.max(2, w)},${y + 12}Q${L + Math.max(2, w)},${y + 16} ${L + Math.max(2, w) - 4},${y + 16}L${L},${y + 16}Z`} fill={isMe ? "var(--s1)" : "var(--track)"} />
              <text x={L + w + 5} y={y + 12} fontSize={10} fontWeight={isMe ? 700 : 400} fill="var(--ink)">{Math.round(r.sales_q as number).toLocaleString("en-IN")}</text>
              <rect x={0} y={i * rowH} width={W} height={rowH} fill="transparent" onMouseMove={(e) => show(e, <><b>{r.name}</b> <span className="sub">sales last quarter ₹{Math.round(r.sales_q as number).toLocaleString("en-IN")} Cr{isNum(r.mcap_cr) ? ` · market cap ₹${Math.round(r.mcap_cr).toLocaleString("en-IN")} Cr` : ""}</span></>)} onMouseLeave={hide} />
            </g>
          );
        })}
      </svg>
      <div style={{ fontSize: 10.5, color: "var(--muted)" }}><Key color="var(--s1)" />this company <span style={{ marginLeft: 10 }}><Key color="var(--track)" />listed peers · sales last quarter, ₹ Cr</span></div>
      {node}
    </div>
  );
}

/** how many concalls were read in each year: shows how deep the evidence goes */
export function YearCounts({ calls }: { calls: { year: number }[] }) {
  if (!calls.length) return null;
  const years = [...new Set(calls.map((c) => c.year))].sort();
  const lo = years[0], hi = years[years.length - 1];
  const all = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const count = (y: number) => calls.filter((c) => c.year === y).length;
  const mx = Math.max(...all.map(count));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 46 }} role="img" aria-label={`Concalls read per year: ${all.map((y) => `${y}: ${count(y)}`).join(", ")}`}>
      {all.map((y) => (
        <div key={y} title={`${y}: ${count(y)} call${count(y) === 1 ? "" : "s"} read`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div style={{ width: 16, height: Math.max(3, (count(y) / mx) * 26), background: count(y) ? "var(--s1)" : "var(--grid)", borderRadius: "3px 3px 0 0" }} />
          <span style={{ fontSize: 9, color: "var(--muted)" }}>’{String(y).slice(2)}</span>
        </div>
      ))}
    </div>
  );
}

export const fmtPct = (v: number | null | undefined, d = 0) => (isNum(v) ? `${fmtSigned(v, d)}%` : "—");
