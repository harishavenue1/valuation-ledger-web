import { useMemo, useState } from "react";
import { fmtNum, fmtSigned } from "./ScreenerTable";
import { ChartCard, Delta, GREEN, LineChart, RED, Tile, YIELD_KEYS, pct } from "./PulseCharts";
import type { Key, PulseRow } from "./PulseCharts";
import { CORR_SERIES, dailyChanges, MIN_PAIRS, pairCorr, rollingCorr } from "../lib/pulseMacro";

// Market Pulse's macro / geopolitical section and its FII / DII section (2026-10-25: "under the pulse screen, we also need to add
// geo political reasons.. like USDINR, US Bond & IN Bond Yields... and all correlations" and "pulse screen needs the FII and DII data").
// Geopolitics reaches the Indian market through a handful of prices — crude, the dollar, US yields, gold, the VIXes and the rupee —
// so those are what is tracked here; nothing on this page reads the news.

const bp = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : (a - b) * 100);

/** Adds the two derived spreads (percentage points) to every daily row. */
export function withMacroDerived(rows: PulseRow[]): PulseRow[] {
  return rows.map((r) => ({
    ...r,
    spread: r.in10y != null && r.us10y != null ? r.in10y - r.us10y : null,
    curve: r.us10y != null && r.us3m != null ? r.us10y - r.us3m : null,
  }));
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-2.5 py-1 text-xs ${on ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
      {children}
    </button>
  );
}

function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-3 flex-wrap mt-6 mb-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {note && <span className="text-xs text-slate-500">{note}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- macro

function yieldTile(label: string, key: Key, all: PulseRow[], title?: string) {
  const last = all[all.length - 1];
  const prev = all[all.length - 2];
  const month = all[all.length - 23];
  const v = last?.[key] as number | null | undefined;
  return (
    <div title={title}>
      <Tile label={label} unit="%" value={v} digits={2} day={bp(v, prev?.[key] as number | null)} month={bp(v, month?.[key] as number | null)} dayDigits={0} dayLabel=" bp" invert />
    </div>
  );
}

function readThrough(all: PulseRow[]): string[] {
  const last = all[all.length - 1];
  const m = all[all.length - 23];
  if (!last || !m) return [];
  const out: string[] = [];
  const inr = pct(last.usdinr, m.usdinr);
  const dxy = pct(last.dxy, m.dxy);
  if (inr != null && dxy != null) {
    if (inr > 0.3 && dxy > 0.3) out.push(`The rupee is ${fmtNum(inr, 1)}% weaker over a month while the dollar index is up ${fmtNum(dxy, 1)}% — mostly a strong-dollar story, not a rupee-specific one.`);
    else if (inr > 0.3) out.push(`The rupee is ${fmtNum(inr, 1)}% weaker over a month but the dollar index is ${dxy >= 0 ? "up only " : "down "}${fmtNum(Math.abs(dxy), 1)}% — more than the dollar explains, so the pressure is India-specific (crude, FPI selling, trade gap).`);
    else if (inr < -0.3) out.push(`The rupee has gained ${fmtNum(-inr, 1)}% over a month (dollar index ${fmtSigned(dxy, 1)}%).`);
    else out.push(`The rupee is flat over a month (${fmtSigned(inr, 1)}%) with the dollar index ${fmtSigned(dxy, 1)}%.`);
  }
  if (last.spread != null) {
    const d = bp(last.spread, m.spread);
    out.push(`India 10Y trades ${fmtNum(last.spread * 100, 0)} bp over the US 10Y${d != null ? `, ${d < -5 ? "narrowed" : d > 5 ? "widened" : "little changed"} by ${fmtNum(Math.abs(d), 0)} bp in a month` : ""}. A narrowing gap leaves less carry to hold rupee debt — a headwind for FPI debt flows and the rupee.`);
  }
  if (last.curve != null) out.push(`US 10Y minus 3-month bill is ${fmtSigned(last.curve * 100, 0)} bp — ${last.curve < 0 ? "an inverted curve, the classic late-cycle / recession warning" : "a normal, upward-sloping curve"}.`);
  const oil = pct(last.brent, m.brent);
  if (oil != null && Math.abs(oil) > 3) out.push(`Brent is ${fmtSigned(oil, 1)}% over a month — ${oil > 0 ? "India imports most of its oil, so a rise weighs on the rupee, inflation and the OMC / paint / aviation names" : "cheaper crude eases the import bill, inflation and the rupee"}.`);
  const iv = last.indiavix;
  const iv0 = m.indiavix;
  if (iv != null && iv0 != null) out.push(`India VIX is ${fmtNum(iv, 1)} (${fmtSigned(pct(iv, iv0), 0)}% in a month)${last.vix != null ? ` against the US VIX at ${fmtNum(last.vix, 1)}` : ""}${last.gold && m.gold ? `; gold ${fmtSigned(pct(last.gold, m.gold), 1)}% over the month` : ""}.`);
  return out;
}

export function MacroSection({ all, rows }: { all: PulseRow[]; rows: PulseRow[] }) {
  const last = all[all.length - 1];
  const prev = all[all.length - 2];
  const month = all[all.length - 23];
  const has = all.some((r) => r.usdinr != null);
  const lines = useMemo(() => readThrough(all), [all]);
  if (!has) {
    return (
      <>
        <SectionHead title="🌍 Macro & geopolitical drivers" />
        <div className="text-sm text-slate-400 border border-slate-200 rounded-lg p-4">The macro series (USD/INR, yields, VIX) arrive with the next Market Pulse run — click Run now above.</div>
      </>
    );
  }
  const estNow = last?.in10y_est === 1;
  const pc = (k: Key, ref?: PulseRow) => (last && ref ? pct(last[k] as number | null, ref[k] as number | null) : null);
  return (
    <>
      <SectionHead title="🌍 Macro & geopolitical drivers" note="the prices through which wars, sanctions, oil shocks and Fed moves reach Indian stocks" />
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-4">
        <Tile label="USD/INR" unit="₹" value={last?.usdinr} digits={2} day={pc("usdinr", prev)} month={pc("usdinr", month)} dayDigits={2} dayLabel="%" invert />
        <Tile label="Dollar Index" value={last?.dxy} digits={2} day={pc("dxy", prev)} month={pc("dxy", month)} dayDigits={2} dayLabel="%" />
        {yieldTile("US 10Y yield", "us10y", all)}
        {yieldTile(estNow ? "India 10Y yield (est.)" : "India 10Y yield", "in10y", all, "India 10Y government-bond yield")}
        {yieldTile("India − US 10Y", "spread", all, "India 10Y minus US 10Y, in percentage points")}
        {yieldTile("US 10Y − 3M curve", "curve", all, "US 10-year yield minus the 3-month bill; below zero = inverted")}
        <Tile label="US VIX" value={last?.vix} digits={1} day={pc("vix", prev)} month={pc("vix", month)} dayDigits={1} dayLabel="%" invert />
        <Tile label="India VIX" value={last?.indiavix} digits={1} day={pc("indiavix", prev)} month={pc("indiavix", month)} dayDigits={1} dayLabel="%" invert />
      </div>

      {lines.length > 0 && (
        <div className="border border-slate-200 rounded-lg p-3 mb-4">
          <div className="text-sm font-semibold mb-1">What the numbers say today</div>
          <ul className="list-disc pl-5 text-sm space-y-1 text-slate-700">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <div className="text-[11px] text-slate-400 mt-2">Mechanical reads of the month's moves, not forecasts and not news.</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-2">
        <ChartCard title="USD/INR" unit="₹ per $" rows={rows} digits={2} invert={["usdinr"]} series={[{ key: "usdinr", name: "USD/INR", color: "#dc2626" }]} />
        <ChartCard title="Dollar Index" rows={rows} digits={2} series={[{ key: "dxy", name: "DXY", color: "#0891b2" }]} />
        <ChartCard
          title="US vs India 10-year yield"
          unit="%"
          rows={rows}
          digits={2}
          invert={["us10y", "in10y"]}
          series={[
            { key: "us10y", name: "US 10Y", color: "#6366f1" },
            { key: "in10y", name: "India 10Y", color: "#d97706" },
          ]}
        />
        <ChartCard title="India − US 10Y spread" unit="pp" rows={rows} digits={2} series={[{ key: "spread", name: "Spread", color: "#16a34a" }]} />
        <ChartCard title="US yield curve: 10Y − 3M" unit="pp (below 0 = inverted)" rows={rows} digits={2} series={[{ key: "curve", name: "10Y − 3M", color: "#7c3aed" }]} />
        <ChartCard
          title="Fear gauges"
          unit="VIX"
          rows={rows}
          digits={1}
          invert={["vix", "indiavix"]}
          series={[
            { key: "vix", name: "US VIX", color: "#64748b" },
            { key: "indiavix", name: "India VIX", color: "#dc2626" },
          ]}
        />
      </div>
      {rows.some((r) => r.in10y_est === 1) && (
        <div className="text-xs text-amber-700 mb-2">
          India 10Y before {all.find((r) => r.in10y != null && r.in10y_est !== 1)?.date ?? "the first real reading"} is an estimate rebuilt from the Nifty 10-yr Benchmark G-Sec index (yield move ≈ price move ÷ 6.5 duration): daily changes are good to a basis point or two,
          the level drifts over months. Real readings (CNBC) are stored from then on.
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------- correlations

const WINDOWS = [
  { label: "3M", days: 66 },
  { label: "6M", days: 132 },
  { label: "1Y", days: 252 },
  { label: "3Y", days: 756 },
];

function heat(r: number | null): React.CSSProperties {
  if (r == null) return {};
  const a = Math.min(1, Math.abs(r)) * 0.75;
  return { backgroundColor: r >= 0 ? `rgba(99,102,241,${a})` : `rgba(234,88,12,${a})` };
}

export function CorrelationSection({ all }: { all: PulseRow[] }) {
  const [win, setWin] = useState(WINDOWS[1]);
  const [lagUs, setLagUs] = useState(true);
  const [focus, setFocus] = useState("nifty500");
  const ch = useMemo(() => CORR_SERIES.map((s) => dailyChanges(all, s)), [all]);
  const from = Math.max(1, all.length - win.days);
  const matrix = useMemo(() => CORR_SERIES.map((sa, i) => CORR_SERIES.map((sb, j) => (i === j ? { r: 1, n: 0 } : pairCorr(ch[i], ch[j], sa, sb, lagUs, from, all.length)))), [ch, lagUs, from, all.length]);
  const usable = CORR_SERIES.map((_, i) => matrix[i].some((c, j) => j !== i && c.r != null));
  const idx = CORR_SERIES.map((_, i) => i).filter((i) => usable[i]);
  const fi = Math.max(0, CORR_SERIES.findIndex((s) => s.key === focus));
  const ranked = idx
    .filter((j) => j !== fi && matrix[fi][j].r != null)
    .map((j) => ({ s: CORR_SERIES[j], ...matrix[fi][j] }))
    .sort((a, b) => Math.abs(b.r!) - Math.abs(a.r!));

  // rolling 60-session correlation of the focus series with four drivers
  const driverKeys = ["usdinr", "us10y", "brent", "dxy"].filter((k) => k !== focus);
  const colors: Record<string, string> = { usdinr: "#dc2626", us10y: "#6366f1", brent: "#0891b2", dxy: "#d97706" };
  const shown = all.slice(-Math.min(all.length, win.days));
  const roll = useMemo(
    () =>
      driverKeys.map((k) => {
        const j = CORR_SERIES.findIndex((s) => s.key === k);
        const full = rollingCorr(ch[fi], ch[j], CORR_SERIES[fi], CORR_SERIES[j], lagUs, 60);
        return { name: CORR_SERIES[j].label, color: colors[k], data: full.slice(-shown.length).map((v) => (v == null ? null : Math.round(v * 100) / 100)) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ch, fi, lagUs, shown.length],
  );
  const [hover, setHover] = useState<number | null>(null);
  const hi = hover ?? shown.length - 1;

  if (all.length < 40 || !all.some((r) => r.usdinr != null)) return null;
  return (
    <>
      <SectionHead title="🔗 Correlations" note={`daily changes over the last ${win.label}; +1 = move together, −1 = move opposite`} />
      <div className="flex flex-wrap items-center gap-3 mb-2 text-xs text-slate-500">
        <span className="inline-flex rounded-md border border-slate-200 overflow-hidden">
          {WINDOWS.map((w) => (
            <Chip key={w.label} on={win.label === w.label} onClick={() => setWin(w)}>
              {w.label}
            </Chip>
          ))}
        </span>
        <label className="inline-flex items-center gap-1.5" title="US-hours markets close after India does, so a US move reaches Nifty on the next session; this pairs them that way">
          <input type="checkbox" checked={lagUs} onChange={(e) => setLagUs(e.target.checked)} /> US moves hit India next session
        </label>
        <label className="inline-flex items-center gap-1.5">
          Focus on
          <select value={focus} onChange={(e) => setFocus(e.target.value)} className="border border-slate-300 rounded px-1.5 py-0.5 bg-transparent">
            {CORR_SERIES.map((s, i) => usable[i] && <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 mb-2">
        <div className="overflow-auto border border-slate-200 rounded-lg">
          <table className="text-[11px] tabular-nums border-collapse w-full">
            <thead>
              <tr>
                <th className="px-2 py-1.5"></th>
                {idx.map((j) => (
                  <th key={j} className="px-1 py-1.5 font-medium text-slate-500 text-center whitespace-nowrap align-bottom" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", height: 92 }}>
                    {CORR_SERIES[j].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {idx.map((i) => (
                <tr key={i} className={CORR_SERIES[i].key === focus ? "outline outline-1 outline-slate-400" : ""}>
                  <th className="text-left px-2 py-1 font-medium whitespace-nowrap text-slate-600">
                    <button onClick={() => setFocus(CORR_SERIES[i].key)} className="hover:underline">{CORR_SERIES[i].label}</button>
                  </th>
                  {idx.map((j) => {
                    const c = matrix[i][j];
                    return (
                      <td key={j} style={i === j ? {} : heat(c.r)} className={`px-1 py-1 text-center border border-slate-100 ${i === j ? "text-slate-300" : ""}`} title={i === j ? "" : c.r == null ? `only ${c.n} overlapping days (need ${MIN_PAIRS})` : `${CORR_SERIES[i].label} vs ${CORR_SERIES[j].label}: ${c.r.toFixed(2)} over ${c.n} days`}>
                        {i === j ? "·" : c.r == null ? "–" : c.r.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border border-slate-200 rounded-lg p-3">
          <div className="text-sm font-semibold mb-2">Strongest links to {CORR_SERIES[fi].label}</div>
          <div className="space-y-1">
            {ranked.slice(0, 8).map((x) => (
              <div key={x.s.key} className="flex items-center gap-2 text-xs">
                <span className="w-32 shrink-0 text-slate-600">{x.s.label}</span>
                <div className="flex-1 h-3 relative bg-slate-100 rounded">
                  <div className="absolute top-0 h-3 rounded" style={{ left: x.r! >= 0 ? "50%" : `${50 + x.r! * 50}%`, width: `${Math.abs(x.r!) * 50}%`, background: x.r! >= 0 ? "#6366f1" : "#ea580c" }} />
                  <div className="absolute left-1/2 top-0 h-3 w-px bg-slate-400" />
                </div>
                <span className="w-10 text-right tabular-nums">{x.r!.toFixed(2)}</span>
              </div>
            ))}
            {ranked.length === 0 && <div className="text-xs text-slate-400">Not enough overlapping days yet.</div>}
          </div>
          <div className="text-[11px] text-slate-400 mt-2">Below about ±0.2 is noise. Correlation is not cause, and it shifts between regimes — see the rolling view below.</div>
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg p-3 mb-2">
        <div className="flex items-baseline gap-3 flex-wrap mb-1">
          <div className="text-sm font-semibold">
            Rolling 60-session correlation with {CORR_SERIES[fi].label} <span className="text-xs font-normal text-slate-400">is the link stable or flipping?</span>
          </div>
          <div className="ml-auto flex items-baseline gap-3 text-xs tabular-nums">
            {roll.map((s) => (
              <span key={s.name} className="whitespace-nowrap">
                <span style={{ color: s.color }}>●</span> <span className="text-slate-500">{s.name}</span> <b>{s.data[hi] == null ? "—" : s.data[hi]!.toFixed(2)}</b>
              </span>
            ))}
            <span className="text-slate-400">{shown[hi]?.date}</span>
          </div>
        </div>
        <LineChart dates={shown.map((r) => r.date)} series={roll} digits={1} onHover={setHover} />
      </div>
      <div className="text-[11px] text-slate-400 mb-2">
        Pearson correlation of daily changes — % for prices and the VIXes, points for yields, ₹ Cr for FII / DII flows — using only days both series have; needs at least {MIN_PAIRS} overlapping days (FII / DII daily history builds up from the
        past month onward, so those cells fill in over time). India 10Y is partly estimated before its first real reading.
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------------------------- FII / DII

function FlowBars({ dates, fii, dii, label }: { dates: string[]; fii: (number | null)[]; dii: (number | null)[]; label: (d: string) => string }) {
  const [hi, setHi] = useState<number | null>(null);
  const n = dates.length;
  if (n < 2) return <div className="text-xs text-slate-400 py-10 text-center">Not enough data yet</div>;
  const W = 640;
  const H = 200;
  const PAD = { l: 54, r: 10, t: 10, b: 22 };
  const vals = [...fii, ...dii].filter((v): v is number => v != null);
  const mx = Math.max(...vals.map(Math.abs), 1);
  const y = (v: number) => PAD.t + (1 - (v + mx) / (2 * mx)) * (H - PAD.t - PAD.b);
  const slot = (W - PAD.l - PAD.r) / n;
  const bw = Math.max(1, Math.min(10, slot * 0.4));
  const ticks = [-mx, 0, mx];
  const cur = hi ?? n - 1;
  return (
    <div>
      <div className="flex items-baseline gap-3 text-xs tabular-nums mb-1 justify-end">
        <span><span style={{ color: "#6366f1" }}>●</span> <span className="text-slate-500">FII</span> <b>{fii[cur] == null ? "—" : fmtSigned(fii[cur], 0)}</b></span>
        <span><span style={{ color: "#d97706" }}>●</span> <span className="text-slate-500">DII</span> <b>{dii[cur] == null ? "—" : fmtSigned(dii[cur], 0)}</b></span>
        <span className="text-slate-400">{label(dates[cur])}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" onMouseLeave={() => setHi(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className={t === 0 ? "stroke-slate-400" : "stroke-slate-200"} strokeWidth={1} />
            <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-400" fontSize={10}>{fmtNum(t, 0)}</text>
          </g>
        ))}
        {dates.map((d, i) => {
          const x = PAD.l + slot * i + slot / 2;
          const bar = (v: number | null, dx: number, color: string) => (v == null ? null : <rect x={x + dx} y={Math.min(y(v), y(0))} width={bw} height={Math.max(1, Math.abs(y(v) - y(0)))} fill={color} rx={1} />);
          return (
            <g key={d} onMouseEnter={() => setHi(i)}>
              <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={H - PAD.t - PAD.b} fill="transparent" />
              {hi === i && <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={H - PAD.t - PAD.b} className="fill-slate-100" opacity={0.6} />}
              {bar(fii[i], -bw, "#6366f1")}
              {bar(dii[i], 0, "#d97706")}
            </g>
          );
        })}
        {[0, Math.floor((n - 1) / 2), n - 1].map((i, k) => (
          <text key={k} x={PAD.l + slot * i + slot / 2} y={H - 6} textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"} className="fill-slate-400" fontSize={10}>{label(dates[i])}</text>
        ))}
      </svg>
    </div>
  );
}

const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, v) => a + (v ?? 0), 0);

export function FlowSection({ all, rows, months }: { all: PulseRow[]; rows: PulseRow[]; months: PulseRow[] }) {
  const flow = all.filter((r) => r.fii != null || r.dii != null);
  const win = rows.filter((r) => r.fii != null || r.dii != null);
  const [mView, setMView] = useState(24);
  const dayLabel = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const monLabel = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
  const cum = useMemo(() => {
    let a = 0;
    let b = 0;
    return win.map((r) => ({ date: r.date, fii: (a += r.fii ?? 0), dii: (b += r.dii ?? 0) }));
  }, [win]);
  const [hoverC, setHoverC] = useState<number | null>(null);
  if (!flow.length) {
    return (
      <>
        <SectionHead title="🏦 FII & DII flows" />
        <div className="text-sm text-slate-400 border border-slate-200 rounded-lg p-4">FII / DII data arrives with the next Market Pulse run — click Run now above.</div>
      </>
    );
  }
  const last = flow[flow.length - 1];
  const prevMonth = last.date.slice(0, 7);
  const mtd = flow.filter((r) => r.date.slice(0, 7) === prevMonth);
  const w5 = flow.slice(-5);
  const mrows = months.slice(-mView);
  const streak = (key: "fii" | "dii") => {
    let n = 0;
    const sign = Math.sign((last[key] as number) ?? 0);
    for (let i = flow.length - 1; i >= 0 && sign !== 0 && Math.sign((flow[i][key] as number) ?? 0) === sign; i--) n++;
    return sign === 0 ? "" : `${n} day${n > 1 ? "s" : ""} of ${sign > 0 ? "buying" : "selling"}`;
  };
  const T = ({ label, v, sub }: { label: string; v: number; sub?: string }) => (
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="text-xs text-slate-500">{label} <span className="text-slate-400">₹ Cr</span></div>
      <div className={`text-2xl font-semibold tabular-nums ${v >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtSigned(v, 0)}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
  return (
    <>
      <SectionHead title="🏦 FII & DII flows" note={`cash segment, net buying (+) or selling (−) · latest ${last.date} · NSE + BSE provisional`} />
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
        <T label="FII today" v={last.fii ?? 0} sub={streak("fii")} />
        <T label="DII today" v={last.dii ?? 0} sub={streak("dii")} />
        <T label="FII last 5 days" v={sum(w5.map((r) => r.fii))} />
        <T label="DII last 5 days" v={sum(w5.map((r) => r.dii))} />
        <T label={`FII ${monLabel(last.date)} so far`} v={sum(mtd.map((r) => r.fii))} sub={`${mtd.length} sessions`} />
        <T label={`DII ${monLabel(last.date)} so far`} v={sum(mtd.map((r) => r.dii))} sub={`${mtd.length} sessions`} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-2">
        <div className="border border-slate-200 rounded-lg p-3">
          <div className="text-sm font-semibold mb-1">Daily net flow <span className="text-xs font-normal text-slate-400">₹ Cr · {win.length} sessions in range</span></div>
          <FlowBars dates={win.map((r) => r.date)} fii={win.map((r) => r.fii ?? null)} dii={win.map((r) => r.dii ?? null)} label={dayLabel} />
        </div>
        <div className="border border-slate-200 rounded-lg p-3">
          <div className="text-sm font-semibold mb-1">Cumulative net flow <span className="text-xs font-normal text-slate-400">₹ Cr since the start of the range</span></div>
          <div className="flex gap-3 text-xs tabular-nums justify-end mb-1">
            {(["fii", "dii"] as const).map((k) => (
              <span key={k}><span style={{ color: k === "fii" ? "#6366f1" : "#d97706" }}>●</span> <span className="text-slate-500">{k.toUpperCase()}</span> <b>{cum.length ? fmtSigned(cum[hoverC ?? cum.length - 1][k], 0) : "—"}</b></span>
            ))}
            <span className="text-slate-400">{cum[hoverC ?? cum.length - 1]?.date}</span>
          </div>
          <LineChart dates={cum.map((c) => c.date)} digits={0} onHover={setHoverC} series={[{ name: "FII", color: "#6366f1", data: cum.map((c) => c.fii) }, { name: "DII", color: "#d97706", data: cum.map((c) => c.dii) }]} />
        </div>
      </div>
      {mrows.length > 1 && (
        <div className="border border-slate-200 rounded-lg p-3 mb-2">
          <div className="flex items-baseline gap-3 mb-1 flex-wrap">
            <div className="text-sm font-semibold">Monthly net flow <span className="text-xs font-normal text-slate-400">₹ Cr · the latest bar is the month so far</span></div>
            <span className="ml-auto inline-flex rounded-md border border-slate-200 overflow-hidden">
              {[12, 24, 36].map((m) => (
                <Chip key={m} on={mView === m} onClick={() => setMView(m)}>{m / 12}Y</Chip>
              ))}
            </span>
          </div>
          <FlowBars dates={mrows.map((r) => r.date)} fii={mrows.map((r) => r.fii ?? null)} dii={mrows.map((r) => r.dii ?? null)} label={monLabel} />
        </div>
      )}
      <div className="text-[11px] text-slate-400 mb-2">
        FII = foreign institutional / portfolio investors, DII = domestic institutions (mutual funds, insurers, banks). Source: Trendlyne's FII / DII table (NSE + BSE cash segment, provisional until the exchanges finalise). Daily history
        starts from the first run and grows every day; the monthly view goes back years. Both lines up together is rare: usually FIIs sell into rallies that DIIs absorb, and the gap between them is what to watch.
      </div>
    </>
  );
}
