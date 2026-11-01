import { Key, colPath, fmtSigned, useTip } from "./DebateViz";

// Charts for the Shareholding & Pledges page. Same rules as DebateViz: pure SVG, validated categorical tokens (promoters s1, FIIs s2, DIIs s3, public s4), 4px rounded data end on the top segment only,
// a 2px surface gap between stacked segments, hairline grid, text in text tokens, a tooltip on every column (and the list on the page is the table view).

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const OWNERS = [
  { k: "promoters", label: "Promoters", color: "var(--s1)" },
  { k: "fiis", label: "FIIs", color: "var(--s2)" },
  { k: "diis", label: "DIIs", color: "var(--s3)" },
  { k: "public", label: "Public", color: "var(--s4)" },
] as const;
export type OwnerKey = (typeof OWNERS)[number]["k"];

/** who owns the company at each quarter end: columns stacked to the whole company (100%) */
export function OwnershipStack({ labels, series }: { labels: string[]; series: Record<OwnerKey, (number | null)[]> & { others?: (number | null)[]; government?: (number | null)[] } }) {
  const { box, show, hide, node } = useTip();
  const n = labels.length;
  if (!n) return <div style={{ fontSize: 12, color: "var(--muted)" }}>No shareholding history.</div>;
  const W = 560, H = 210, L = 34, R = 8, T = 16, B = 28, pw = W - L - R, ph = H - T - B, slot = pw / n, bw = Math.min(30, slot - 8);
  const y = (v: number) => T + ph - (v / 100) * ph;
  const sl = (l: string) => { const m = l.match(/^(\w{3}) 20(\d\d)$/); return m ? `${m[1]} ’${m[2]}` : l; };
  return (
    <div ref={box} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: "none" }} role="img" aria-label={`Ownership by quarter: ${labels.map((l, i) => `${l} ${OWNERS.map((o) => `${o.label} ${series[o.k][i] ?? "n/a"}%`).join(", ")}`).join("; ")}`}>
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            <text x={L - 6} y={y(t) + 3} textAnchor="end" fontSize={9.5} fill="var(--muted)">{t}%</text>
          </g>
        ))}
        {labels.map((l, i) => {
          const x = L + i * slot + (slot - bw) / 2;
          const vals = OWNERS.map((o) => series[o.k][i]);
          const known = vals.reduce<number>((a, v) => a + (isNum(v) ? v : 0), 0);
          const rest = Math.max(0, 100 - known); // others / government / rounding: shown as a faint cap so the column always reaches the whole company
          let acc = 0;
          const segs = OWNERS.map((o, j) => ({ o, v: vals[j] })).filter((s) => isNum(s.v) && (s.v as number) > 0);
          return (
            <g key={l}>
              {segs.map((s, j) => {
                const v = s.v as number, y0 = y(acc) - (acc ? 1 : 0), y1 = y(acc + v) + 1;
                acc += v;
                const top = j === segs.length - 1 && rest < 0.5;
                return <path key={s.o.k} d={top ? colPath(x, bw, y0, y1) : `M${x},${y0}L${x},${y1}L${x + bw},${y1}L${x + bw},${y0}Z`} fill={s.o.color} />;
              })}
              {rest >= 0.5 && <path d={colPath(x, bw, y(acc) - 1, y(100))} fill="var(--wash)" />}
              {(i === 0 || i === n - 1 || n <= 6) && isNum(vals[0]) && (vals[0] as number) >= 6 && <text x={x + bw / 2} y={y((vals[0] as number) / 2) + 3} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="#fff">{Math.round(vals[0] as number)}</text>}
              <text x={x + bw / 2} y={H - 10} textAnchor="middle" fontSize={9} fill="var(--muted)">{i % 2 === (n - 1) % 2 ? sl(l) : ""}</text>
              <rect x={L + i * slot} y={0} width={slot} height={H} fill="transparent" onMouseMove={(e) => show(e, <><b>{l}</b>{OWNERS.map((o, j) => <div key={o.k}><Key color={o.color} />{o.label} <b>{isNum(vals[j]) ? `${vals[j]}%` : "—"}</b></div>)}{rest >= 0.5 && <div className="sub">others {rest.toFixed(1)}%</div>}</>)} onMouseLeave={hide} />
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 11, color: "var(--ink2)", marginTop: 4 }}>{OWNERS.map((o) => <span key={o.k}><Key color={o.color} />{o.label}</span>)}</div>
      {node}
    </div>
  );
}

/** how many people hold the shares, by quarter (a surge usually means retail crowding in, a fall means they are leaving) */
export function HoldersBars({ labels, values }: { labels: string[]; values: (number | null)[] }) {
  const { box, show, hide, node } = useTip();
  const n = labels.length;
  const nums = values.filter(isNum);
  if (n < 2 || !nums.length) return <div style={{ fontSize: 12, color: "var(--muted)" }}>No shareholder count.</div>;
  const mx = Math.max(...nums);
  const W = 560, H = 120, L = 6, R = 6, T = 16, B = 22, pw = W - L - R, ph = H - T - B, slot = pw / n, bw = Math.min(30, slot - 8);
  const fmt = (v: number) => (v >= 1e5 ? `${(v / 1e5).toFixed(v >= 1e6 ? 1 : 2)}L` : `${(v / 1e3).toFixed(0)}k`);
  return (
    <div ref={box} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: "none" }} role="img" aria-label={`Number of shareholders: ${labels.map((l, i) => `${l} ${values[i] ?? "n/a"}`).join(", ")}`}>
        <line x1={L} x2={W - R} y1={T + ph} y2={T + ph} stroke="var(--axis)" strokeWidth={1} />
        {values.map((v, i) => {
          if (!isNum(v)) return null;
          const x = L + i * slot + (slot - bw) / 2, h = (v / mx) * ph, prev = values[i - 1];
          const up = isNum(prev) && prev > 0 && v / prev - 1 > 0.1;
          return (
            <g key={i}>
              <path d={colPath(x, bw, T + ph, T + ph - h)} fill={up ? "var(--s2)" : "var(--s1)"} />
              {(i === 0 || i === n - 1) && <text x={x + bw / 2} y={T + ph - h - 4} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="var(--ink)">{fmt(v)}</text>}
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={9} fill="var(--muted)">{i % 2 === (n - 1) % 2 ? labels[i].replace(/^(\w{3}) 20(\d\d)$/, "$1 ’$2") : ""}</text>
              <rect x={L + i * slot} y={0} width={slot} height={H} fill="transparent" onMouseMove={(e) => show(e, <><b>{v.toLocaleString("en-IN")} shareholders</b> <span className="sub">{labels[i]}{isNum(prev) && prev > 0 ? ` · ${fmtSigned((v / prev - 1) * 100, 1)}% on the quarter before` : ""}</span></>)} onMouseLeave={hide} />
            </g>
          );
        })}
      </svg>
      <div style={{ fontSize: 11, color: "var(--ink2)", marginTop: 2 }}><Key color="var(--s1)" />shareholders <span style={{ marginLeft: 10 }}><Key color="var(--s2)" />up over 10% in a quarter</span></div>
      {node}
    </div>
  );
}

/** the pledged share of the promoters' own holding, against a 0 to 100 scale */
export function PledgeMeter({ pct }: { pct: number | null | undefined }) {
  const v = isNum(pct) ? pct : 0;
  const color = v >= 50 ? "var(--crit)" : v >= 20 ? "var(--warn)" : "var(--s1)";
  return (
    <div role="img" aria-label={`${v}% of the promoters' holding is pledged`}>
      <div style={{ position: "relative", height: 10, borderRadius: 5, background: "var(--track)", overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, v)}%`, height: "100%", background: color, borderRadius: 5 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--muted)", marginTop: 3 }}><span>0</span><span>50</span><span>100% of the promoters' shares</span></div>
    </div>
  );
}
