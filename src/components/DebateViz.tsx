import { Component, useRef, useState, type ReactNode } from "react";

// Charts for the Research Debate page (2026-11-01, "too many words can be translated better by figures / bar charts / graphs").
// Pure SVG, no chart library. Built to the dataviz skill's rules:
//   - form follows the data's job: growth of 3 series over time -> grouped columns; one trend -> a line; above/below a baseline -> diverging bars;
//     one value against a limit -> a meter; headline numbers -> stat tiles
//   - colours are tokens (light + dark), validated: categorical slots 1-3 (blue, orange, aqua) pass every check in both modes; the aqua is under 3:1 on the
//     light surface, so values are ALSO printed in the legend and in the tooltip, and the page has a table view (the overview table + "the numbers")
//   - marks: bars <= 24px with a 4px rounded data end and a square baseline, 2px lines, >= 8px end dots with a 2px surface ring, hairline solid grid
//   - labels are text tokens (never the data colour); a colour is never the only carrier (icon + word for status)

export const VIZ_CSS = `
.dbv{color-scheme:light;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--ring:rgba(11,11,11,.10);--wash:#f0efec;
  --s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--pos:#2a78d6;--neg:#e34948;--track:#cde2fb;--fill:#2a78d6;--good:#0ca30c;--good-text:#006300;--crit:#d03b3b;--warn:#fab219}
/* the app's own theme switch is the class "tv-dark" on <html> (dark is its default) — NOT the OS setting; surface = the app's card colour, series steps = the skill's validated dark steps */
html.tv-dark .dbv{color-scheme:dark;--surface:#1a1d26;--ink:#e6e6e6;--ink2:#b0b3ba;--muted:#7f828a;--grid:#2a2e39;--axis:#3c3d44;--ring:rgba(255,255,255,.10);--wash:#2a2e39;
  --s1:#3987e5;--s2:#d95926;--s3:#199e70;--pos:#3987e5;--neg:#e66767;--track:#184f95;--fill:#3987e5;--good-text:#0ca30c}
.dbv svg text{font-family:inherit}
.dbv .tt{position:absolute;pointer-events:none;z-index:20;background:var(--surface);color:var(--ink);border:1px solid var(--ring);border-radius:6px;padding:6px 8px;box-shadow:0 4px 14px rgba(0,0,0,.14);font-size:11px;line-height:1.35;white-space:nowrap}
.dbv .tt b{font-weight:600}.dbv .tt .sub{color:var(--ink2)}
`;

export type Num = number | "T" | null | undefined;
const isNum = (v: Num): v is number => typeof v === "number" && Number.isFinite(v);
const shortQ = (l: string) => l.replace(/^(\w{3}) 20(\d\d)$/, "$1 $2"); // "Sep 2026" -> "Sep 26"
export const fmtSigned = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---- tooltip: one at a time, built from React nodes (never innerHTML) -----------------------------------------------------------------------------
interface Tip { x: number; y: number; body: ReactNode }
function useTip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (e: { clientX: number; clientY: number }, body: ReactNode) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top, body });
  };
  const hide = () => setTip(null);
  const node = tip && (
    <div className="tt" style={{ left: Math.min(tip.x + 12, (box.current?.clientWidth ?? 300) - 150), top: Math.max(0, tip.y - 8) }}>
      {tip.body}
    </div>
  );
  return { box, show, hide, node };
}

const Key = ({ color, line }: { color: string; line?: boolean }) => (
  <span style={{ display: "inline-block", width: line ? 12 : 8, height: line ? 2 : 8, background: color, borderRadius: line ? 1 : 2, marginRight: 5, verticalAlign: "middle" }} />
);

/** a bar with a 4px rounded data end and a square baseline; vertical (column) */
function colPath(x: number, w: number, y0: number, y1: number): string {
  const up = y1 < y0;
  const h = Math.abs(y1 - y0);
  const r = Math.min(4, w / 2, h);
  if (h < 0.5) return "";
  return up
    ? `M${x},${y0}L${x},${y1 + r}Q${x},${y1} ${x + r},${y1}L${x + w - r},${y1}Q${x + w},${y1} ${x + w},${y1 + r}L${x + w},${y0}Z`
    : `M${x},${y0}L${x},${y1 - r}Q${x},${y1} ${x + r},${y1}L${x + w - r},${y1}Q${x + w},${y1} ${x + w},${y1 - r}L${x + w},${y0}Z`;
}
/** horizontal bar, rounded at the data end */
function rowPath(y: number, h: number, x0: number, x1: number): string {
  const right = x1 > x0;
  const w = Math.abs(x1 - x0);
  const r = Math.min(4, h / 2, w);
  if (w < 0.5) return "";
  return right
    ? `M${x0},${y}L${x1 - r},${y}Q${x1},${y} ${x1},${y + r}L${x1},${y + h - r}Q${x1},${y + h} ${x1 - r},${y + h}L${x0},${y + h}Z`
    : `M${x0},${y}L${x1 + r},${y}Q${x1},${y} ${x1},${y + r}L${x1},${y + h - r}Q${x1},${y + h} ${x1 + r},${y + h}L${x0},${y + h}Z`;
}

// ---- 1. growth: Sales / Operating profit / Net profit YoY over the last quarters (grouped columns) ---------------------------------------------------
export function GrowthBars({ labels, sales, op, np }: { labels: string[]; sales: Num[]; op: Num[]; np: Num[] }) {
  const { box, show, hide, node } = useTip();
  const series = [
    { name: "Sales", color: "var(--s1)", data: sales },
    { name: "Operating profit", color: "var(--s2)", data: op },
    { name: "Net profit", color: "var(--s3)", data: np },
  ];
  const nums = series.flatMap((s) => s.data.filter(isNum));
  const hi = clamp(Math.max(20, ...nums), 20, 120), lo = Math.min(0, clamp(Math.min(0, ...nums), -60, 0));
  const W = 320, H = 150, L = 34, R = 6, T = 8, B = 20;
  const pw = W - L - R, ph = H - T - B;
  const y = (v: number) => T + ((hi - clamp(v, lo, hi)) / (hi - lo)) * ph;
  const n = labels.length, gw = pw / n, bw = Math.min(11, gw / 3 - 2);
  const ticks = [0, ...(hi > 60 ? [50, 100].filter((t) => t <= hi) : [Math.round(hi / 2 / 10) * 10, Math.round(hi / 10) * 10]), ...(lo < 0 ? [Math.round(lo / 10) * 10] : [])];
  const last = n - 1;
  const latest = (d: Num[]) => (d[last] === "T" ? "T" : isNum(d[last]) ? `${fmtSigned(d[last] as number)}%` : "—");
  return (
    <div ref={box} style={{ position: "relative" }}>
      <div style={{ fontSize: 11, color: "var(--ink2)", marginBottom: 2, display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
        {series.map((s) => (
          <span key={s.name}><Key color={s.color} />{s.name} <b style={{ color: "var(--ink)", fontWeight: 600 }}>{latest(s.data)}</b></span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Year-on-year growth of sales, operating profit and net profit over ${labels.join(", ")}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            <text x={L - 4} y={y(t) + 3} textAnchor="end" fontSize={9} fill="var(--muted)">{t}%</text>
          </g>
        ))}
        {labels.map((l, i) => {
          const cx = L + gw * i + gw / 2;
          return (
            <g key={l}>
              {series.map((s, k) => {
                const v = s.data[i];
                const x = cx - (bw * 3 + 4) / 2 + k * (bw + 2);
                if (v === "T") return <text key={k} x={x + bw / 2} y={y(0) - 3} textAnchor="middle" fontSize={9} fontWeight={600} fill="var(--ink)">T</text>;
                if (!isNum(v)) return null;
                const clipped = v > hi || v < lo;
                return (
                  <g key={k}>
                    <path d={colPath(x, bw, y(0), y(v))} fill={s.color} />
                    {clipped && <text x={x + bw / 2} y={v > 0 ? T + 7 : H - B - 2} textAnchor="middle" fontSize={8} fill="var(--ink2)">{v > 0 ? "▲" : "▼"}</text>}
                  </g>
                );
              })}
              <text x={cx} y={H - 6} textAnchor="middle" fontSize={9} fill={i === last ? "var(--ink2)" : "var(--muted)"} fontWeight={i === last ? 600 : 400}>{shortQ(l)}</text>
              <rect x={L + gw * i} y={T} width={gw} height={ph + B} fill="transparent" style={{ cursor: "default" }}
                onMouseMove={(e) => show(e, <>
                  <b>{l}</b>
                  {series.map((s) => (
                    <div key={s.name}><Key color={s.color} line /><b>{s.data[i] === "T" ? "turned profitable" : isNum(s.data[i]) ? `${fmtSigned(s.data[i] as number)}%` : "—"}</b> <span className="sub">{s.name} (YoY)</span></div>
                  ))}
                </>)}
                onMouseLeave={hide} />
            </g>
          );
        })}
      </svg>
      {(series.some((s) => s.data.some((v) => !isNum(v) && v !== "T")) || series.some((s) => s.data.includes("T"))) && (
        <div style={{ fontSize: 10, color: "var(--muted)" }}>
          {series.some((s) => s.data.some((v) => !isNum(v) && v !== "T")) && "A missing bar means growth cannot be worked out (a loss in either quarter)."}
          {series.some((s) => s.data.includes("T")) && " T = turned profitable."}
        </div>
      )}
      {node}
    </div>
  );
}

// ---- 2. operating margin over the quarters (one line, labelled end) --------------------------------------------------------------------------------
export function MarginLine({ labels, opm }: { labels: string[]; opm: Num[] }) {
  const { box, show, hide, node } = useTip();
  const [hover, setHover] = useState<number | null>(null);
  const pts = opm.map((v) => (isNum(v) ? v : null));
  const vals = pts.filter((v): v is number => v !== null);
  if (vals.length < 2) return <div style={{ fontSize: 11, color: "var(--muted)" }}>No margin series in the data.</div>;
  const mn = Math.min(...vals), mx = Math.max(...vals), pad = Math.max(1, (mx - mn) * 0.2);
  const lo = mn - pad, hi = mx + pad;
  const W = 320, H = 130, L = 8, R = 54, T = 12, B = 20;
  const pw = W - L - R, ph = H - T - B;
  const x = (i: number) => L + (pw * i) / Math.max(1, pts.length - 1);
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * ph;
  const path = pts.map((v, i) => (v === null ? "" : `${i === 0 || pts[i - 1] === null ? "M" : "L"}${x(i)},${y(v)}`)).join("");
  const lastI = pts.length - 1 - [...pts].reverse().findIndex((v) => v !== null);
  const lastV = pts[lastI] as number;
  const area = `${path}L${x(lastI)},${y(Math.max(lo, Math.min(0, hi)) || lo)}L${x(0)},${y(Math.max(lo, Math.min(0, hi)) || lo)}Z`;
  const up = lastV >= (vals[0] ?? lastV);
  return (
    <div ref={box} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Operating margin by quarter: ${labels.map((l, i) => `${l} ${pts[i] ?? "n/a"}%`).join(", ")}`}
        onMouseLeave={() => { setHover(null); hide(); }}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = clamp(Math.round(((px - L) / pw) * (pts.length - 1)), 0, pts.length - 1);
          setHover(i);
          show(e, <><b>{labels[i]}</b><div><Key color="var(--s1)" line /><b>{pts[i] === null ? "—" : `${(pts[i] as number).toFixed(1)}%`}</b> <span className="sub">operating margin</span></div></>);
        }}>
        {lo < 0 && hi > 0 && <g><line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--axis)" strokeWidth={1} /><text x={L + 2} y={y(0) - 3} fontSize={9} fill="var(--muted)">0%</text></g>}
        <path d={area} fill="var(--s1)" opacity={0.1} />
        <path d={path} fill="none" stroke="var(--s1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && pts[hover] !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--axis)" strokeWidth={1} />}
        {pts.map((v, i) => v !== null && (i === lastI || i === hover) && <g key={i}><circle cx={x(i)} cy={y(v)} r={6} fill="var(--surface)" /><circle cx={x(i)} cy={y(v)} r={4} fill="var(--s1)" /></g>)}
        <text x={x(lastI) + 9} y={y(lastV) + 4} fontSize={11} fontWeight={600} fill="var(--ink)" stroke="var(--surface)" strokeWidth={3} paintOrder="stroke">{lastV.toFixed(1)}%</text>
        <text x={x(0) + 2} y={y(pts[0] ?? vals[0]) - 8} fontSize={9} fill="var(--ink2)" stroke="var(--surface)" strokeWidth={3} paintOrder="stroke">{(pts[0] ?? vals[0]).toFixed(1)}%</text>
        <text x={L} y={H - 6} fontSize={9} fill="var(--muted)">{shortQ(labels[0])}</text>
        <text x={x(lastI)} y={H - 6} textAnchor="end" fontSize={9} fill="var(--ink2)" fontWeight={600}>{shortQ(labels[lastI])}</text>
      </svg>
      <div style={{ fontSize: 11, color: "var(--ink2)" }}>{up ? "▲" : "▼"} {mn.toFixed(1)}% low · {mx.toFixed(1)}% high over the period</div>
      {node}
    </div>
  );
}

// ---- 3. trend position: distance from the moving averages and from the high (diverging bars) ------------------------------------------------------
export function TrendBars({ tech }: { tech: Record<string, number | null> }) {
  const { box, show, hide, node } = useTip();
  const rows = [
    { k: "pct_20d_ema", label: "vs 20-day EMA", say: (v: number) => `price is ${Math.abs(v).toFixed(1)}% ${v >= 0 ? "above" : "below"} its 20-day EMA` },
    { k: "pct_50d_ema", label: "vs 50-day EMA", say: (v: number) => `price is ${Math.abs(v).toFixed(1)}% ${v >= 0 ? "above" : "below"} its 50-day EMA` },
    { k: "pct_200d_ema", label: "vs 200-day EMA", say: (v: number) => `price is ${Math.abs(v).toFixed(1)}% ${v >= 0 ? "above" : "below"} its 200-day EMA` },
    { k: "pct_33w_ema", label: "vs 33-week EMA", say: (v: number) => `price is ${Math.abs(v).toFixed(1)}% ${v >= 0 ? "above" : "below"} its 33-week EMA` },
    { k: "pct_from_ath", label: "from the high", say: (v: number) => `price is ${Math.abs(v).toFixed(1)}% ${v >= 0 ? "above" : "below"} its all-time high` },
  ].filter((r) => isNum(tech[r.k]));
  if (!rows.length) return <div style={{ fontSize: 11, color: "var(--muted)" }}>No price data.</div>;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(tech[r.k] as number)));
  const D = clamp(Math.ceil((maxAbs * 1.7) / 10) * 10, 20, 100); // headroom for the value label beyond the bar tip
  const W = 320, rowH = 24, H = rows.length * rowH + 4, labW = 92, L = labW, R = 6;
  const pw = W - L - R, cx = L + pw / 2;
  const sx = (v: number) => cx + (clamp(v, -D, D) / D) * (pw / 2);
  return (
    <div ref={box} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Distance from moving averages and the high: ${rows.map((r) => `${r.label} ${(tech[r.k] as number).toFixed(1)}%`).join(", ")}`}>
        <line x1={cx} x2={cx} y1={0} y2={H} stroke="var(--axis)" strokeWidth={1} />
        {rows.map((r, i) => {
          const v = tech[r.k] as number;
          const y = i * rowH + 6;
          const tip = sx(v);
          const right = v >= 0;
          return (
            <g key={r.k}>
              <text x={0} y={y + 9} fontSize={10} fill="var(--ink2)">{r.label}</text>
              <path d={rowPath(y, 12, cx, tip)} fill={right ? "var(--pos)" : "var(--neg)"} />
              <text x={right ? tip + 5 : tip - 5} y={y + 10} textAnchor={right ? "start" : "end"} fontSize={10} fontWeight={600} fill="var(--ink)">{fmtSigned(v)}%</text>
              <rect x={0} y={i * rowH} width={W} height={rowH} fill="transparent"
                onMouseMove={(e) => show(e, <><b>{fmtSigned(v)}%</b> <span className="sub">{r.say(v)}</span></>)} onMouseLeave={hide} />
            </g>
          );
        })}
      </svg>
      <div style={{ fontSize: 10, color: "var(--muted)", display: "flex", gap: 10 }}>
        <span><Key color="var(--pos)" />above</span><span><Key color="var(--neg)" />below</span>
      </div>
      {node}
    </div>
  );
}

// ---- 4. weekly RSI against the 66 bar (meter) ------------------------------------------------------------------------------------------------------
export function RsiMeter({ rsi, bar = 66 }: { rsi: number | null | undefined; bar?: number }) {
  if (!isNum(rsi)) return <div style={{ fontSize: 11, color: "var(--muted)" }}>No RSI.</div>;
  const ok = rsi > bar;
  const W = 320, pad = 4, tw = W - pad * 2;
  const px = (v: number) => pad + (clamp(v, 0, 100) / 100) * tw;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 11, color: "var(--ink2)" }}>Weekly RSI</span>
        <b style={{ fontSize: 15, color: "var(--ink)" }}>{rsi.toFixed(1)}</b>
        <span style={{ fontSize: 11, color: ok ? "var(--good-text)" : "var(--crit)", fontWeight: 600 }}>{ok ? "✓ above" : "✗ below"} your {bar} bar</span>
      </div>
      <svg viewBox={`0 0 ${W} 34`} width="100%" role="img" aria-label={`Weekly RSI ${rsi.toFixed(1)}, ${ok ? "above" : "below"} the ${bar} bar`}>
        <rect x={pad} y={6} width={tw} height={8} rx={4} fill="var(--track)" />
        <rect x={pad} y={6} width={px(rsi) - pad} height={8} rx={4} fill="var(--fill)" />
        <line x1={px(bar)} x2={px(bar)} y1={2} y2={18} stroke="var(--ink)" strokeWidth={2} />
        <text x={px(bar)} y={30} textAnchor="middle" fontSize={9} fill="var(--ink2)">{bar}</text>
        <text x={pad} y={30} fontSize={9} fill="var(--muted)">0</text>
        <text x={W - pad} y={30} textAnchor="end" fontSize={9} fill="var(--muted)">100</text>
      </svg>
    </div>
  );
}


/** one bad record must never blank a whole page: wrap each card / row / table in a Guard */
export class Guard extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? (
      <div className="rounded-xl p-3 text-sm" style={{ border: "1px solid var(--ring)", color: "var(--ink2)" }}>Could not draw {this.props.label} (unexpected data). The record is still stored.</div>
    ) : this.props.children;
  }
}

// ---- generic: diverging horizontal bars for a few labelled values (percent), e.g. "median return vs the index" -----------------------------------
export function DeltaBars({ rows }: { rows: { label: string; value: number | null | undefined; note?: string }[] }) {
  const { box, show, hide, node } = useTip();
  const real = rows.filter((r) => isNum(r.value as Num));
  if (!real.length) return <div style={{ fontSize: 11, color: "var(--muted)" }}>Not enough data.</div>;
  const maxAbs = Math.max(...real.map((r) => Math.abs(r.value as number)));
  const D = clamp(Math.ceil((maxAbs * 1.7) / 5) * 5, 10, 150);
  const W = 320, rowH = 26, H = rows.length * rowH + 4, L = 118, R = 6, pw = W - L - R, cx = L + pw / 2;
  const sx = (v: number) => cx + (clamp(v, -D, D) / D) * (pw / 2);
  return (
    <div ref={box} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={rows.map((r) => `${r.label} ${isNum(r.value as Num) ? (r.value as number).toFixed(1) + "%" : "n/a"}`).join(", ")}>
        <line x1={cx} x2={cx} y1={0} y2={H} stroke="var(--axis)" strokeWidth={1} />
        {rows.map((r, i) => {
          const y = i * rowH + 7;
          if (!isNum(r.value as Num)) return <g key={r.label}><text x={0} y={y + 10} fontSize={10} fill="var(--ink2)">{r.label}</text><text x={cx + 6} y={y + 10} fontSize={10} fill="var(--muted)">n/a</text></g>;
          const v = r.value as number, right = v >= 0, tip = sx(v);
          return (
            <g key={r.label}>
              <text x={0} y={y + 10} fontSize={10} fill="var(--ink2)">{r.label}</text>
              <path d={rowPath(y, 12, cx, tip)} fill={right ? "var(--pos)" : "var(--neg)"} />
              <text x={right ? tip + 5 : tip - 5} y={y + 10} textAnchor={right ? "start" : "end"} fontSize={10} fontWeight={600} fill="var(--ink)">{fmtSigned(v)}%</text>
              <rect x={0} y={i * rowH} width={W} height={rowH} fill="transparent" onMouseMove={(e) => show(e, <><b>{fmtSigned(v)}%</b> <span className="sub">{r.label}{r.note ? ` · ${r.note}` : ""}</span></>)} onMouseLeave={hide} />
            </g>
          );
        })}
      </svg>
      {node}
    </div>
  );
}

// ---- generic: one dot per event along a percent axis, with the median marked (shows the SPREAD an average hides) ------------------------------------
export function StripPlot({ points, median }: { points: { x: number; tip: string }[]; median: number | null | undefined }) {
  const { box, show, hide, node } = useTip();
  if (!points.length) return <div style={{ fontSize: 11, color: "var(--muted)" }}>No events.</div>;
  const sorted = points.map((p) => Math.abs(p.x)).sort((a, b) => a - b);
  const D = clamp(Math.ceil((sorted[Math.floor(sorted.length * 0.9)] * 1.15) / 10) * 10, 20, 120);
  const W = 320, H = 70, L = 8, R = 8, pw = W - L - R, cx = L + pw / 2;
  const sx = (v: number) => cx + (clamp(v, -D, D) / D) * (pw / 2);
  // simple beeswarm: dots in the same horizontal bucket stack into lanes so none sits on another
  const lanes: Record<number, number> = {};
  const placed = [...points].sort((a, b) => a.x - b.x).map((p) => { const b = Math.round(sx(p.x) / 9); const lane = lanes[b] ?? 0; lanes[b] = lane + 1; return { ...p, cy: 30 - (lane % 5) * 8 * (lane % 2 ? 1 : -1) }; });
  return (
    <div ref={box} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${points.length} events; median ${isNum(median as Num) ? (median as number).toFixed(1) + "%" : "n/a"}`}>
        <line x1={L} x2={W - R} y1={30} y2={30} stroke="var(--grid)" strokeWidth={1} />
        <line x1={cx} x2={cx} y1={8} y2={52} stroke="var(--axis)" strokeWidth={1} />
        {placed.map((p, i) => (
          <g key={i}>
            <circle cx={sx(p.x)} cy={p.cy} r={5} fill="var(--surface)" />
            <circle cx={sx(p.x)} cy={p.cy} r={3.5} fill={p.x >= 0 ? "var(--pos)" : "var(--neg)"} />
            <circle cx={sx(p.x)} cy={p.cy} r={11} fill="transparent" onMouseMove={(e) => show(e, <>{p.tip}</>)} onMouseLeave={hide} />
          </g>
        ))}
        {isNum(median as Num) && <g><line x1={sx(median as number)} x2={sx(median as number)} y1={6} y2={54} stroke="var(--ink)" strokeWidth={2} /><text x={sx(median as number)} y={H - 4} textAnchor="middle" fontSize={9} fontWeight={600} fill="var(--ink)">median {fmtSigned(median as number)}%</text></g>}
        <text x={L} y={H - 4} fontSize={9} fill="var(--muted)">{-D}%</text>
        <text x={W - R} y={H - 4} textAnchor="end" fontSize={9} fill="var(--muted)">+{D}%</text>
      </svg>
      {node}
    </div>
  );
}

// ---- small pieces ----------------------------------------------------------------------------------------------------------------------------------
export function StatTile({ label, value, sub, subGood }: { label: string; value: ReactNode; sub?: ReactNode; subGood?: boolean | null }) {
  return (
    <div style={{ border: "1px solid var(--ring)", borderRadius: 8, padding: "6px 10px", minWidth: 96, background: "var(--surface)" }}>
      <div style={{ fontSize: 11, color: "var(--ink2)" }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 600, color: "var(--ink)", lineHeight: 1.25 }}>{value}</div>
      {sub !== undefined && <div style={{ fontSize: 10.5, color: subGood === true ? "var(--good-text)" : subGood === false ? "var(--crit)" : "var(--muted)" }}>{sub}</div>}
    </div>
  );
}

const RULES: [string, string][] = [["weekly_rsi_gt_66", "RSI > 66"], ["above_33w_ema", "Above 33W EMA"], ["margins_held_qoq_yoy", "Margins held"], ["stage2_uptrend", "Stage 2"]];
export function RuleTiles({ rules }: { rules: Record<string, boolean | null> | undefined }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {RULES.map(([k, label]) => {
        const v = rules?.[k];
        const color = v === true ? "var(--good-text)" : v === false ? "var(--crit)" : "var(--muted)";
        return (
          <span key={k} title={v === null || v === undefined ? "the data cannot answer this one" : v ? "passes" : "fails"}
            style={{ border: `1px solid ${color}`, color: "var(--ink)", borderRadius: 6, padding: "2px 8px", fontSize: 11 }}>
            <b style={{ color, marginRight: 4 }}>{v === true ? "✓" : v === false ? "✗" : "?"}</b>{label}
          </span>
        );
      })}
    </div>
  );
}

/** compact rule marks for the overview table: four small squares */
export function RuleDots({ rules }: { rules: Record<string, boolean | null> | undefined }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }} title={RULES.map(([k, l]) => `${l}: ${rules?.[k] === true ? "yes" : rules?.[k] === false ? "no" : "unknown"}`).join(" · ")}>
      {RULES.map(([k]) => {
        const v = rules?.[k];
        return <span key={k} style={{ width: 14, height: 14, lineHeight: "14px", fontSize: 9, textAlign: "center", borderRadius: 3, fontWeight: 700, color: v === null || v === undefined ? "var(--muted)" : "#fff",
          background: v === true ? "var(--good)" : v === false ? "var(--crit)" : "var(--wash)" }}>{v === true ? "✓" : v === false ? "✗" : "?"}</span>;
      })}
    </span>
  );
}

export function ConvictionBar({ n }: { n: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 2, verticalAlign: "middle" }} title={`Conviction ${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} style={{ width: 10, height: 6, borderRadius: 2, background: i <= n ? "var(--s1)" : "var(--wash)" }} />)}
    </span>
  );
}

/** tiny table-cell visuals */
export function MiniFromHigh({ v }: { v: number | null | undefined }) {
  if (!isNum(v)) return <span style={{ color: "var(--muted)" }}>—</span>;
  const w = clamp((Math.abs(v) / 40) * 44, 1, 44);
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 44, display: "inline-block", textAlign: "right" }}><span style={{ display: "inline-block", width: w, height: 8, borderRadius: 4, background: v >= -10 ? "var(--pos)" : "var(--neg)" }} /></span><span style={{ fontSize: 11 }}>{fmtSigned(v)}%</span></span>;
}
export function MiniRsi({ v, bar = 66 }: { v: number | null | undefined; bar?: number }) {
  if (!isNum(v)) return <span style={{ color: "var(--muted)" }}>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <svg width={52} height={12} aria-hidden><rect x={0} y={4} width={52} height={4} rx={2} fill="var(--track)" /><rect x={0} y={4} width={clamp(v, 0, 100) * 0.52} height={4} rx={2} fill="var(--fill)" /><line x1={bar * 0.52} x2={bar * 0.52} y1={1} y2={11} stroke="var(--ink)" strokeWidth={1.5} /></svg>
      <span style={{ fontSize: 11 }}>{v.toFixed(0)}</span>
    </span>
  );
}
export function MiniSpark({ vals }: { vals: Num[] | null | undefined }) {
  const v = (vals ?? []).filter(isNum);
  if (v.length < 2) return <span style={{ color: "var(--muted)" }}>—</span>;
  const mn = Math.min(...v), mx = Math.max(...v), W = 52, H = 16;
  const pts = v.map((a, i) => [(i / (v.length - 1)) * (W - 6) + 1, H - 3 - ((a - mn) / (mx - mn || 1)) * (H - 6)]);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <svg width={W} height={H} aria-hidden><path d={pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join("")} fill="none" stroke="var(--s1)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /><circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.5} fill="var(--s1)" /></svg>
      <span style={{ fontSize: 11 }}>{v[v.length - 1].toFixed(1)}%</span>
    </span>
  );
}
