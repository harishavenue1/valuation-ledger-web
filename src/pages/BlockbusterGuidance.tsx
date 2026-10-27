import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { guidedGrowth } from "../lib/guidanceGrowth";
import { useWatchlist } from "../lib/useWatchlist";
import type { Metric } from "../lib/guidanceGrowth";
import { Col, GenericTable, MethodologyNote, PriceLink, ScreenerLoading, fmtNum } from "../components/ScreenerTable";

// Blockbuster Guidances — added 2026-10-26 ("just like blockbuster results, can we have blockbuster guidances, mention source, only look
// for management given guidances only"). No new API: reads the concall guidance feed (api/_concall.py — forward-looking sentences pulled
// from the transcript PDFs of each company's earnings calls, analyst questions and boilerplate already filtered out) and works out the
// growth number management put on the table (src/lib/guidanceGrowth.ts). Every row carries the exact sentence and the transcript link.

const MON: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const callKey = (d: string) => {
  const [m, y] = (d || "").split(" ");
  return parseInt(y, 10) * 12 + (MON[m] ?? 0);
};
const HORIZON = /\b(FY\s?'?\d{2}|(?:next|coming|over the next) (?:\d|two|three|four|five) years?|by (?:the end of )?(?:20\d{2}|FY\s?'?\d{2})|current (?:fiscal|year)|this year)\b/i;
const METRICS: Metric[] = ["Revenue", "Profit", "Orders", "Volume"];

function Num({ label, value, onChange, suffix }: { label: string; value: number; onChange: (v: number) => void; suffix: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      <span>{label}</span>
      <div className="flex items-center gap-1">
        <input type="number" step="any" value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-24 px-2 py-1.5 border border-slate-300 rounded text-sm tabular-nums" />
        <span className="text-slate-400 text-xs">{suffix}</span>
      </div>
    </label>
  );
}

export default function BlockbusterGuidance() {
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const [feed, setFeed] = useState<Record<string, { date: string; url: string; ppt?: string; lines: any[] }[]> | null>(null);
  const [updated, setUpdated] = useState<string | undefined>();
  const [tech, setTech] = useState<Map<string, any>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const [minGrowth, setMinGrowth] = useState(25);
  const [minCap, setMinCap] = useState(500);
  const [metric, setMetric] = useState<"All" | Metric>("All");
  const [since, setSince] = useState(7); // months back from the newest call in the feed (0 = everything)
  const [best, setBest] = useState(true);

  useEffect(() => {
    api.getConcallGuidance().then((r) => { setFeed(r.companies ?? {}); setUpdated(r.updated); }).catch((e) => setErr(String(e?.message ?? e)));
    api.getBhavTechnicals().then((b) => setTech(new Map<string, any>((b.rows ?? []).map((x: any) => [x.symbol, x])))).catch(() => {});
  }, []);

  const all = useMemo(() => {
    if (!feed) return [];
    const out: Record<string, any>[] = [];
    for (const [sym, calls] of Object.entries(feed)) {
      for (const c of calls) {
        const seen = new Set<string>();
        for (const l of c.lines ?? []) {
          const g = guidedGrowth(l.text);
          if (!g) continue;
          const key = g.metric + g.label + l.text.slice(0, 60);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ symbol: sym, metric: g.metric, growth: g.growth, label: g.label, text: l.text, who: l.who, horizon: l.horizon || l.text.match(HORIZON)?.[0] || "", date: c.date, url: c.url, ppt: c.ppt });
        }
      }
    }
    return out;
  }, [feed]);

  const newest = useMemo(() => all.reduce((a, r) => Math.max(a, callKey(r.date)), 0), [all]);

  const rows = useMemo(() => {
    const filtered = all
      .map((r): Record<string, any> => {
        const t = tech.get(r.symbol);
        return { ...r, name: t?.name || r.symbol, mcap: t?.market_cap_cr, price: t?.price };
      })
      .filter((r) => r.growth >= minGrowth && (r.mcap ?? 0) > minCap && (metric === "All" || r.metric === metric) && (since === 0 || callKey(r.date) >= newest - since + 1));
    filtered.sort((a, b) => b.growth - a.growth || callKey(b.date) - callKey(a.date));
    if (!best) return filtered;
    const seen = new Set<string>();
    return filtered.filter((r) => (seen.has(r.symbol) ? false : (seen.add(r.symbol), true)));
  }, [all, tech, minGrowth, minCap, metric, since, best, newest]);

  const cols: Col[] = [
    {
      key: "name",
      label: "Company",
      align: "left",
      width: 14,
      render: (r) => (
        <a href={`https://www.screener.in/company/${encodeURIComponent(r.symbol)}/consolidated/`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="hover:underline hover:text-indigo-600" title={`Open ${r.symbol} on Screener.in`}>
          {r.name}
        </a>
      ),
    },
    { key: "mcap", label: "Market Cap (₹ Cr)", width: 8, render: (r) => fmtNum(r.mcap, 0) },
    { key: "price", label: "Price (₹)", width: 7, render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
    { key: "metric", label: "Guided on", align: "center", width: 7 },
    { key: "growth", label: "Guided growth", width: 8, render: (r) => <b className="text-emerald-600">{r.label.includes("x") || r.label === "doubling" ? r.label : `${r.label}`}</b> },
    { key: "horizon", label: "Period", align: "center", width: 7, render: (r) => r.horizon || "—" },
    {
      key: "text",
      label: "What management said",
      align: "left",
      width: 33,
      render: (r) => (
        <span className="text-xs leading-snug block" style={{ whiteSpace: "normal", overflow: "visible", textOverflow: "clip" }} title={r.text}>
          “{r.text.length > 260 ? r.text.slice(0, 257) + "…" : r.text}”
        </span>
      ),
    },
    { key: "who", label: "Said by", align: "left", width: 7, render: (r) => <span className="text-xs text-slate-600">{r.who || "—"}</span> },
    {
      key: "date",
      label: "Source",
      align: "left",
      width: 13,
      render: (r) => (
        <span className="text-xs whitespace-nowrap">
          <a href={r.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-indigo-600 hover:underline" title="Earnings-call transcript (PDF, filed on BSE)">
            Concall {r.date} ↗
          </a>
          {r.ppt && (
            <a href={r.ppt} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="ml-2 text-indigo-600 hover:underline" title="Investor presentation / filing for the same call">
              deck ↗
            </a>
          )}
        </span>
      ),
    },
  ];

  if (!feed && !err) return <ScreenerLoading label="concall guidance" />;
  if (err) return <div className="text-sm text-red-600">Could not load the concall guidance feed ({err}).</div>;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-3 mb-1">
        <h1 className="text-lg font-semibold">📣 Blockbuster Guidances</h1>
        <span className="text-xs text-slate-500">
          Management itself guiding growth of {minGrowth}% or more — {rows.length} {best ? "compan" + (rows.length === 1 ? "y" : "ies") : "statement" + (rows.length === 1 ? "" : "s")}
          {updated ? ` · transcripts read through ${updated.slice(0, 10)}` : ""}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-4 my-3 p-3 border border-slate-200 rounded-lg">
        <Num label="Guided growth at least" value={minGrowth} onChange={setMinGrowth} suffix="%" />
        <Num label="Market cap above" value={minCap} onChange={setMinCap} suffix="₹ Cr" />
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          <span>Guidance on</span>
          <select value={metric} onChange={(e) => setMetric(e.target.value as any)} className="px-2 py-1.5 border border-slate-300 rounded text-sm">
            <option value="All">All (revenue, profit, orders, volume)</option>
            {METRICS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          <span>Call date</span>
          <select value={since} onChange={(e) => setSince(parseInt(e.target.value, 10))} className="px-2 py-1.5 border border-slate-300 rounded text-sm">
            <option value={4}>Latest 4 months (this results season)</option>
            <option value={7}>Latest 7 months (includes the May full-year calls)</option>
            <option value={13}>Latest 13 months</option>
            <option value={0}>Everything stored</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 pb-2" title="Show only the strongest statement per company instead of every qualifying line">
          <input type="checkbox" checked={best} onChange={(e) => setBest(e.target.checked)} /> strongest line per company
        </label>
      </div>

      <MethodologyNote>
        <p>
          Built from what <b>management itself said</b> on earnings calls: forward-looking sentences taken from the call transcripts (the PDFs companies file on BSE), with analysts' questions, moderator talk and legal boilerplate filtered out, then
          kept only where a growth number sits next to a forward cue (<i>guide, expect, target, aim, will, confident, on track</i>) — statements of what already happened ("grew 46%") and margins, utilisation or share-of-revenue percentages are
          dropped. A range counts at its <b>low end</b> (“25–30%” = 25); “doubling” = 100, “3x” = 200. <b>Guided on</b> is read from the nearest wording (revenue / sales, EBITDA / PAT / profit, orders / order book, volumes).
        </p>
        <p>
          This is pattern matching, not comprehension — it can mislabel a multi-year ambition as a one-year guide or pick the wrong metric, which is why every row shows the <b>full sentence</b>, who said it and the <b>transcript link</b> for that
          call; open the PDF before relying on any number. Universe is companies whose transcripts have been read so far (largest companies, holdings and watchlist first), not every listed company. Sorted by guided growth.
        </p>
      </MethodologyNote>

      <GenericTable rows={rows} cols={cols} navigate={navigate} watchlist={watchlist} fullHeight emptyMessage="No management guidance clears these filters — lower the growth bar or widen the call dates." />
    </div>
  );
}
