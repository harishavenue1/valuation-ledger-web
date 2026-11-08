import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData, useScreeners } from "../App";
import RunButton from "../components/RunButton";
import { PlayerBar, PlayerControls, useConcallSpeech } from "../components/ConcallPlayer";
import { MethodologyNote, ScreenerLoading, Signed } from "../components/ScreenerTable";

// Concall Summary (2026-11-08, "can we build concall summary page? more on highlights, reading between lines, +ve and -ve impacts" -> "start with only holdings").
// Written by Claude reading each transcript in a Claude Code session (the ConcallSummary skill; no API key, nothing runs on a schedule). CODE then checks that every evidence
// quote really appears in the transcript, finds its page and call, and pushes the result (key concallSummary). The wording of the points and of "between the lines" is
// interpretation; the quotes are what management said.

type Ev = { evidence?: string; page?: number | null; call?: string; verified?: boolean };
type Pt = Ev & { tag?: string; point?: string; impact?: string; signal?: string; reading?: string; change?: string };
interface Row {
  symbol: string; name?: string; weight?: number | null; sector?: string; as_of: string; call_date: string; prev_call_date?: string | null;
  transcript: string; ppt?: string | null; prev_transcript?: string | null;
  tone: "Positive" | "Cautious" | "Mixed" | "Negative"; tone_note?: string; headline: string;
  highlights: Pt[]; positives: Pt[]; negatives: Pt[]; between_the_lines?: Pt[]; vs_last_call?: Pt[];
  guidance?: { item: string; number: string; horizon?: string; evidence?: string }[]; watch_next?: string[]; data_gaps?: string[];
  numbers?: Record<string, number | null>;
}

const TONE: Record<string, string> = {
  Positive: "bg-emerald-50 text-emerald-700 border-emerald-300",
  Cautious: "bg-amber-50 text-amber-700 border-amber-300",
  Mixed: "bg-sky-50 text-sky-700 border-sky-300",
  Negative: "bg-red-50 text-red-600 border-red-300",
};

function Quote({ p, row }: { p: Ev; row: Row }) {
  if (!p.evidence) return null;
  const url = p.call && p.call === row.prev_call_date ? row.prev_transcript : row.transcript;
  return (
    <div className="mt-1.5 border-l-2 border-slate-300 bg-slate-50 pl-2.5 pr-2 py-1 text-[12.5px] leading-snug text-slate-600 rounded-r">
      “{p.evidence}”
      <span className="ml-2 text-[11px] text-slate-400 whitespace-nowrap">
        {p.verified ? <span title="Found word for word in the transcript" className="text-emerald-600">✓ </span> : <span title="Not found in the transcript" className="text-red-500">? </span>}
        {url ? (
          <a className="underline hover:text-slate-600" href={p.page ? `${url}#page=${p.page}` : url} target="_blank" rel="noreferrer">
            {p.call ?? row.call_date}
            {p.page ? ` · p.${p.page}` : ""}
          </a>
        ) : (
          <>{p.call ?? row.call_date}</>
        )}
      </span>
    </div>
  );
}

function Box({ title, tone, children }: { title: string; tone: "pos" | "neg" | "mid" | "plain"; children: React.ReactNode }) {
  const c = { pos: "border-emerald-200 bg-emerald-50/40", neg: "border-red-200 bg-red-50/40", mid: "border-amber-200 bg-amber-50/50", plain: "border-slate-200 bg-white" }[tone];
  const h = { pos: "text-emerald-800", neg: "text-red-700", mid: "text-amber-800", plain: "text-slate-700" }[tone];
  return (
    <div className={`rounded-lg border p-3 ${c}`}>
      <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${h}`}>{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Detail({ r }: { r: Row }) {
  const n = r.numbers ?? {};
  return (
    <div className="px-4 pb-4 pt-1 space-y-3 bg-slate-50/60 border-t border-slate-100">
      {r.tone_note && <p className="text-sm text-slate-600">{r.tone_note}</p>}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
        <span>Qtr sales YoY <Signed v={n.qtr_sales_growth_pct} digits={1} />%</span>
        <span>Qtr profit YoY <Signed v={n.qtr_profit_growth_pct} digits={1} />%</span>
        <span>OPM QoQ <Signed v={n.opm_qoq} digits={1} /></span>
        <span>OPM YoY <Signed v={n.opm_yoy} digits={1} /></span>
        <span>3M price <Signed v={n.pct_3m} digits={1} />%</span>
        <span>vs 52W high <Signed v={n.pct_from_52w_high} digits={1} />%</span>
        <a className="underline" href={r.transcript} target="_blank" rel="noreferrer">Transcript ({r.call_date})</a>
        {r.ppt && <a className="underline" href={r.ppt} target="_blank" rel="noreferrer">Presentation</a>}
      </div>
      <Box title="Highlights" tone="plain">
        {r.highlights.map((h, i) => (
          <div key={i}>
            <div className="text-sm text-slate-800">{h.point}</div>
            <Quote p={h} row={r} />
          </div>
        ))}
      </Box>
      <div className="grid md:grid-cols-2 gap-3">
        <Box title={`Positives (${r.positives.length})`} tone="pos">
          {r.positives.map((p, i) => (
            <div key={i}>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-emerald-300 bg-white text-emerald-700">{p.tag}</span>
              <div className="text-sm text-slate-800 mt-1">{p.point}</div>
              {p.impact && <div className="text-[13px] text-emerald-800 mt-0.5">→ {p.impact}</div>}
              <Quote p={p} row={r} />
            </div>
          ))}
        </Box>
        <Box title={`Negatives and risks (${r.negatives.length})`} tone="neg">
          {r.negatives.map((p, i) => (
            <div key={i}>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-red-300 bg-white text-red-600">{p.tag}</span>
              <div className="text-sm text-slate-800 mt-1">{p.point}</div>
              {p.impact && <div className="text-[13px] text-red-700 mt-0.5">→ {p.impact}</div>}
              <Quote p={p} row={r} />
            </div>
          ))}
        </Box>
      </div>
      {!!r.between_the_lines?.length && (
        <Box title="Reading between the lines (my interpretation; the quote is what was said)" tone="mid">
          {r.between_the_lines.map((p, i) => (
            <div key={i}>
              <div className="text-sm font-medium text-amber-900">{p.signal}</div>
              <div className="text-sm text-slate-800 mt-0.5">{p.reading}</div>
              <Quote p={p} row={r} />
            </div>
          ))}
        </Box>
      )}
      {!!r.vs_last_call?.length && (
        <Box title={`What changed since the last call${r.prev_call_date ? ` (${r.prev_call_date})` : ""}`} tone="plain">
          {r.vs_last_call.map((p, i) => (
            <div key={i}>
              <div className="text-sm text-slate-800">{p.change}</div>
              <Quote p={p} row={r} />
            </div>
          ))}
        </Box>
      )}
      <div className="grid md:grid-cols-2 gap-3">
        {!!r.guidance?.length && (
          <Box title="Numbers management put out" tone="plain">
            <table className="w-full text-sm">
              <tbody>
                {r.guidance.map((g, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td className="py-1 pr-2 text-slate-600">{g.item}</td>
                    <td className="py-1 pr-2 font-medium text-slate-800">{g.number}</td>
                    <td className="py-1 text-slate-400 text-xs">{g.horizon}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        )}
        <Box title="Watch next" tone="plain">
          <ul className="list-disc pl-4 text-sm text-slate-700 space-y-1">
            {(r.watch_next ?? []).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          {!!r.data_gaps?.length && <div className="text-xs text-slate-400">Not covered: {r.data_gaps.join(" ")}</div>}
        </Box>
      </div>
    </div>
  );
}

export default function ConcallSummary() {
  const { bundle } = useData();
  const { ready } = useScreeners(["concallSummary", "portfolioAllocation"]);
  const entry = bundle.momentum_screeners.concallSummary;
  const rows = (entry?.rows ?? []) as Row[];
  const [tone, setTone] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showPending, setShowPending] = useState(false);
  const held = useMemo(() => (bundle.momentum_screeners.portfolioAllocation?.rows ?? []).filter((r: any) => !r.is_fund).sort((a: any, b: any) => (b.pct_of_portfolio ?? 0) - (a.pct_of_portfolio ?? 0)), [bundle.momentum_screeners.portfolioAllocation]);
  const done = useMemo(() => new Set(rows.map((r) => r.symbol)), [rows]);
  const pending = held.filter((r: any) => !done.has(r.symbol));
  const shown = rows.filter((r) => (tone === "all" || r.tone === tone) && (!q || `${r.symbol} ${r.name ?? ""} ${r.headline}`.toLowerCase().includes(q.toLowerCase())));
  const chip = (on: boolean) => `px-2 py-0.5 rounded-full border text-xs ${on ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`;
  const toggle = (s: string) => setOpen((o) => { const n = new Set(o); n.has(s) ? n.delete(s) : n.add(s); return n; });
  const speech = useConcallSpeech();
  const playing = speech.cur?.symbol;
  useEffect(() => { if (playing) document.getElementById(`cc-${playing}`)?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [playing]);

  return (
    <div className={speech.cur ? "pb-24" : ""}>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">📞 Concall Summary</h1>
        <span className="text-slate-500 text-sm">your holdings · highlights, positives and negatives, and what sits between the lines</span>
      </div>
      <div className="flex items-center gap-2 mb-3">
        {entry?.as_of && <span className="text-xs text-slate-400">updated {entry.as_of}</span>}
        <RunButton screener="concallSummary" />
      </div>
      <MethodologyNote>
        <p className="mb-2">
          <b>How it is made.</b> For each holding the latest concall transcript (and the one before it, for what changed) is read by Claude in a Claude Code session; nothing runs on a schedule and no model is called from this site. Ask for more holdings and they are added, largest weight first.
        </p>
        <p className="mb-2">
          <b>Every point carries a quote.</b> After writing, code checks that each evidence quote appears word for word in the transcript, finds its page and call, and refuses to publish a point whose quote is not found. A green ✓ means found; click the date to open the PDF at that page.
        </p>
        <p>
          <b>Interpretation is labelled.</b> Highlights, positives and negatives restate what was said and say what it may mean for earnings. <b>Reading between the lines</b> is judgement: hedges, questions that were not answered, a number that was left out, a changed stance since the last call. It can be wrong, so read the quote beneath it. This is a reading aid, not a recommendation.
        </p>
      </MethodologyNote>

      {ready && rows.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <span className="text-xs text-slate-500">Tone:</span>
            {["all", "Positive", "Mixed", "Cautious", "Negative"].map((t) => (
              <button key={t} onClick={() => setTone(t)} className={chip(tone === t)}>{t === "all" ? "All" : t}</button>
            ))}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symbol or text" className="ml-2 border border-slate-300 rounded px-2 py-0.5 text-xs w-48" />
            <button onClick={() => setOpen(open.size ? new Set() : new Set(shown.map((r) => r.symbol)))} className={`${chip(false)} ml-1`}>{open.size ? "Collapse all" : "Expand all"}</button>
            <span className="text-xs text-slate-400 ml-1">{shown.length} of {held.length} holdings summarised</span>
          </div>
          <PlayerControls s={speech} count={shown.length} onAll={() => speech.play(shown)} />
          <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
            {shown.map((r) => (
              <div key={r.symbol} id={`cc-${r.symbol}`} className={playing === r.symbol ? "bg-indigo-50/70 ring-1 ring-indigo-300" : ""}>
                <button onClick={() => toggle(r.symbol)} className="w-full text-left px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-slate-50">
                  <span className="text-slate-400 text-xs w-3">{open.has(r.symbol) ? "▾" : "▸"}</span>
                  {speech.supported && (
                    <span role="button" tabIndex={0} title="Read this one aloud" onClick={(e) => { e.stopPropagation(); speech.play([r]); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); speech.play([r]); } }}
                      className="text-sm leading-none px-1 py-0.5 rounded hover:bg-indigo-100 cursor-pointer">{playing === r.symbol ? "🔊" : "🔈"}</span>
                  )}
                  <Link to={`/company/${r.symbol}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-slate-800 hover:underline w-28">{r.symbol}</Link>
                  <span className="text-xs text-slate-500 w-14 text-right">{r.weight != null ? `${r.weight.toFixed(2)}%` : ""}</span>
                  <span className="text-xs text-slate-400 w-16">{r.call_date}</span>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${TONE[r.tone] ?? TONE.Mixed}`}>{r.tone}</span>
                  <span className="text-sm text-slate-700 flex-1 min-w-[16rem]">{r.headline}</span>
                  <span className="text-xs whitespace-nowrap">
                    <span className="text-emerald-600">+{r.positives.length}</span> <span className="text-red-600">−{r.negatives.length}</span> <span className="text-amber-600">⚠{r.between_the_lines?.length ?? 0}</span>
                  </span>
                </button>
                {open.has(r.symbol) && <Detail r={r} />}
              </div>
            ))}
          </div>
        </>
      ) : ready ? (
        <div className="text-sm text-slate-500">No concall summaries yet. Ask Claude to run the ConcallSummary skill for your largest holdings.</div>
      ) : (
        <ScreenerLoading label="Concall Summary" />
      )}

      {ready && pending.length > 0 && (
        <div className="mt-4 text-xs text-slate-500">
          <button onClick={() => setShowPending((v) => !v)} className="underline">{showPending ? "Hide" : "Show"} {pending.length} holdings not summarised yet</button>
          {showPending && <div className="mt-2 flex flex-wrap gap-1.5">{pending.map((r: any) => <span key={r.symbol} className="px-2 py-0.5 rounded-full border border-slate-200 bg-white">{r.symbol} <span className="text-slate-400">{(r.pct_of_portfolio ?? 0).toFixed(1)}%</span></span>)}</div>}
        </div>
      )}
      <PlayerBar s={speech} label={playing ? (rows.find((r) => r.symbol === playing)?.name ?? playing) : ""} />
    </div>
  );
}
