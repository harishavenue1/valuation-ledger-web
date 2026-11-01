import { Key, colPath, fmtSigned, useTip } from "./DebateViz";

// Charts for the Capacity & Technology page. Same rules as DebateViz: pure SVG, token colours (categorical slots s1-s4 validated in light and dark), 4px rounded data ends on a square baseline,
// a 2px surface gap between stacked segments, hairline grid, text in text tokens, a tooltip on every mark, and the list below the chart is the table view.

export type EvType = "Expansion" | "Commissioned" | "Technology" | "Important";
export const TYPES: EvType[] = ["Expansion", "Commissioned", "Technology", "Important"];
export const TYPE_META: Record<EvType, { label: string; icon: string; color: string; blurb: string }> = {
  Expansion: { label: "New capacity", icon: "🏗️", color: "var(--s1)", blurb: "capacity being added: plants, lines, units" },
  Commissioned: { label: "Now live", icon: "⚡", color: "var(--s3)", blurb: "commercial production started" },
  Technology: { label: "New technology", icon: "🧪", color: "var(--s2)", blurb: "products, tie-ups, licences" },
  Important: { label: "Important", icon: "⭐", color: "var(--s4)", blurb: "big orders, deals, approvals, disruptions" },
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const mondayOf = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const short = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** filings per week, stacked by type (the flow of news at a glance) */
export function WeeklyStack({ events, weeks = 13 }: { events: { date: string; type: string }[]; weeks?: number }) {
  const { box, show, hide, node } = useTip();
  const start = mondayOf(new Date());
  start.setDate(start.getDate() - 7 * (weeks - 1));
  const cols = Array.from({ length: weeks }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + 7 * i); return { d, n: Object.fromEntries(TYPES.map((t) => [t, 0])) as Record<EvType, number> }; });
  for (const e of events) {
    const w = Math.floor((mondayOf(new Date(e.date)).getTime() - start.getTime()) / (7 * 864e5));
    if (w >= 0 && w < weeks && e.type in cols[w].n) cols[w].n[e.type as EvType] += 1;
  }
  const totals = cols.map((c) => TYPES.reduce((a, t) => a + c.n[t], 0));
  const mx = Math.max(10, ...totals);
  const top = Math.ceil(mx / 50) * 50 || 50;
  const W = 640, H = 190, L = 34, R = 8, T = 14, B = 26, pw = W - L - R, ph = H - T - B, slot = pw / weeks, bw = Math.min(30, slot - 8);
  const y = (v: number) => T + ph - (v / top) * ph;
  const ticks = [0, top / 2, top];
  return (
    <div ref={box} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: "none" }} role="img" aria-label={`Filings per week by type, last ${weeks} weeks: ${cols.map((c, i) => `${short(c.d)} ${totals[i]}`).join(", ")}`}>
        {ticks.map((t, i) => (
          <g key={`tick${i}`}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={i === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            <text x={L - 6} y={y(t) + 3} textAnchor="end" fontSize={9.5} fill="var(--muted)">{t}</text>
          </g>
        ))}
        {cols.map((c, i) => {
          const x = L + i * slot + (slot - bw) / 2;
          let acc = 0;
          return (
            <g key={i}>
              {TYPES.map((t) => {
                const n = c.n[t];
                if (!n) return null;
                const y0 = y(acc) - (acc ? 1 : 0), y1 = y(acc + n) + 1;
                acc += n;
                const topmost = acc === totals[i];
                const path = topmost ? colPath(x, bw, y0, y1) : `M${x},${y0}L${x},${y1}L${x + bw},${y1}L${x + bw},${y0}Z`;
                return <path key={t} d={path} fill={TYPE_META[t].color} />;
              })}
              {totals[i] > 0 && <text x={x + bw / 2} y={y(totals[i]) - 4} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="var(--ink)">{totals[i]}</text>}
              {(i % 2 === 0 || weeks <= 8) && <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={9.5} fill="var(--muted)">{short(c.d)}</text>}
              <rect x={L + i * slot} y={0} width={slot} height={H} fill="transparent" onMouseMove={(e) => show(e, <><b>Week of {short(c.d)}</b>{TYPES.filter((t) => c.n[t]).map((t) => <div key={t}><Key color={TYPE_META[t].color} />{TYPE_META[t].label} <b>{c.n[t]}</b></div>)}{!totals[i] && <div className="sub">nothing filed</div>}</>)} onMouseLeave={hide} />
            </g>
          );
        })}
      </svg>
      {node}
    </div>
  );
}

/** how far the stock has moved against the index since the announcement: a short diverging bar with the number */
export function MoveBar({ v, range = 60 }: { v: number | null | undefined; range?: number }) {
  if (!isNum(v)) return <span style={{ fontSize: 11, color: "var(--muted)" }}>not enough price history</span>;
  const pct = v * 100, w = Math.min(50, (Math.abs(pct) / range) * 50);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }} title={`${fmtSigned(pct, 1)}% relative to the Nifty Midcap 150, from the first close after the filing`}>
      <svg width={84} height={10} viewBox="0 0 100 10" role="img" aria-label={`${fmtSigned(pct, 1)} percent against the index`}>
        <rect x={0} y={4} width={100} height={2} fill="var(--grid)" />
        <rect x={pct >= 0 ? 50 : 50 - w} y={1} width={w} height={8} rx={2} fill={pct >= 0 ? "var(--pos)" : "var(--neg)"} />
        <line x1={50} x2={50} y1={0} y2={10} stroke="var(--axis)" strokeWidth={1} />
      </svg>
      <b style={{ fontSize: 12, color: pct >= 0 ? "var(--ink)" : "var(--crit)", minWidth: 44 }}>{fmtSigned(pct, 0)}%</b>
    </div>
  );
}
