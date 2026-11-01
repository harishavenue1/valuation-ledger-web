import { useMemo, useState } from "react";
import { useData, useScreeners } from "../App";
import { ScreenerLoading } from "../components/ScreenerTable";

// Research Debate — added 2026-11-01 ("lets build ai agents or agent workflows for our app").
//
// The StockDebate skill (~/.claude/skills/StockDebate) builds an evidence pack for a stock from this app's own data (growth, margins, technicals, concall
// guidance, news, profile, the user's position), has a bull agent and a bear agent argue from it independently, and has a fact-check / risk agent verify every
// cited number against the pack and the user's playbook. The result is pushed here as the `stockDebate` key; nothing is generated in the browser and no model
// key lives in this app. A second opinion on a shortlist, never an order ticket.

type Point = { point: string; evidence: string };
type Verdict = {
  symbol: string;
  name?: string;
  as_of: string;
  verdict: "Strong candidate" | "Watch" | "Avoid";
  conviction: number;
  summary: string;
  bull: Point[];
  bear: Point[];
  risks: string[];
  rule_check?: Record<string, boolean | null>;
  change_my_mind?: string;
  data_gaps?: string[];
  fact_check_dropped?: string[];
  held?: boolean;
};

const BADGE: Record<string, string> = {
  "Strong candidate": "bg-emerald-100 text-emerald-700",
  Watch: "bg-amber-100 text-amber-700",
  Avoid: "bg-red-100 text-red-700",
};
const RULE_LABEL: Record<string, string> = {
  weekly_rsi_gt_66: "Weekly RSI > 66",
  above_33w_ema: "Above 33W EMA",
  margins_held_qoq_yoy: "Margins held QoQ + YoY",
  stage2_uptrend: "Stage 2 uptrend",
};

function Points({ title, items, tone }: { title: string; items: Point[]; tone: string }) {
  return (
    <div className="flex-1 min-w-[260px]">
      <div className={`text-xs font-semibold mb-1 ${tone}`}>{title}</div>
      <ul className="space-y-2">
        {items.map((p, i) => (
          <li key={i} className="text-sm text-slate-700">
            {p.point}
            <div className="text-[11px] text-slate-400 mt-0.5">↳ {p.evidence}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Card({ v }: { v: Verdict }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{v.symbol}</span>
        {v.name && <span className="text-xs text-slate-500">{v.name}</span>}
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${BADGE[v.verdict] ?? "bg-slate-100 text-slate-600"}`}>{v.verdict}</span>
        <span className="text-xs text-slate-500" title="Conviction, 1 to 5">{"●".repeat(v.conviction)}<span className="text-slate-300">{"●".repeat(Math.max(0, 5 - v.conviction))}</span></span>
        {v.held && <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">held</span>}
        <span className="ml-auto text-[11px] text-slate-400">{v.as_of}</span>
      </div>
      <p className="text-sm text-slate-700 mt-2">{v.summary}</p>
      {v.rule_check && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {Object.entries(v.rule_check).map(([k, val]) => (
            <span key={k} className={`text-[11px] px-1.5 py-0.5 rounded border ${val === true ? "border-emerald-300 text-emerald-700" : val === false ? "border-red-300 text-red-700" : "border-slate-200 text-slate-400"}`} title={val === null ? "the evidence pack could not answer this" : undefined}>
              {val === true ? "✓" : val === false ? "✗" : "?"} {RULE_LABEL[k] ?? k}
            </span>
          ))}
        </div>
      )}
      <button onClick={() => setOpen(!open)} className="text-xs text-indigo-600 mt-2 hover:underline">
        {open ? "Hide the debate" : "Show the debate"}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-5">
            <Points title="🐂 Bull case" items={v.bull} tone="text-emerald-700" />
            <Points title="🐻 Bear case" items={v.bear} tone="text-red-700" />
          </div>
          {v.risks?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">⚠️ Risks</div>
              <ul className="list-disc ml-5 text-sm text-slate-700">{v.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}
          {v.change_my_mind && <div className="text-sm text-slate-700"><b className="text-xs text-slate-600">What would change this: </b>{v.change_my_mind}</div>}
          {v.data_gaps && v.data_gaps.length > 0 && <div className="text-xs text-slate-500"><b>Not covered by the data: </b>{v.data_gaps.join("; ")}</div>}
          {v.fact_check_dropped && v.fact_check_dropped.length > 0 && <div className="text-xs text-slate-500"><b>Removed by the fact-check: </b>{v.fact_check_dropped.join("; ")}</div>}
        </div>
      )}
    </div>
  );
}

export default function ResearchDebate() {
  const { bundle } = useData();
  const { ready } = useScreeners(["stockDebate"]);
  const [filter, setFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const rows: Verdict[] = (bundle.momentum_screeners as any)?.stockDebate?.rows ?? [];
  const shown = useMemo(
    () =>
      rows
        .filter((v) => (filter === "all" || v.verdict === filter) && (!q || v.symbol.includes(q.toUpperCase())))
        .sort((a, b) => (a.as_of < b.as_of ? 1 : a.as_of > b.as_of ? -1 : b.conviction - a.conviction)),
    [rows, filter, q],
  );
  if (!ready) return <ScreenerLoading label="research debates" />;
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-3 mb-1">
        <h1 className="text-lg font-semibold">🗣️ Research Debate</h1>
        <span className="text-xs text-slate-500">{rows.length} stock{rows.length === 1 ? "" : "s"} debated · a bull agent, a bear agent and a fact-checker, arguing only from this app's own data</span>
      </div>
      <div className="text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-2 my-3 bg-slate-50">
        A second opinion on stocks you already shortlisted — an AI reading of the app's stored numbers, not advice and never an order. Each point shows the data it rests on; a number that did not match the data was removed by the fact-check.
        To add one, ask Claude: <i>run StockDebate on SYMBOL</i>.
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {["all", "Strong candidate", "Watch", "Avoid"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`text-xs px-2.5 py-1 rounded border ${filter === f ? "bg-slate-800 text-white border-slate-800" : "border-slate-300 text-slate-600"}`}>
            {f === "all" ? "All" : f}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Symbol" className="ml-auto px-2 py-1 border border-slate-300 rounded text-sm w-32" />
      </div>
      {shown.length === 0 ? (
        <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg p-6 text-center">
          {rows.length === 0 ? "No debates yet. Ask Claude to run StockDebate on a stock and it will show up here." : "Nothing matches that filter."}
        </div>
      ) : (
        <div className="space-y-3">{shown.map((v) => <Card key={v.symbol} v={v} />)}</div>
      )}
    </div>
  );
}
