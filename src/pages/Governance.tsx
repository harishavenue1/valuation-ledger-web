import { useMemo, useState } from "react";
import { useData, useScreeners } from "../App";
import { MethodologyNote, ScreenerLoading } from "../components/ScreenerTable";

// Governance Check (2026-11-08, "build a page for company as input, pull all previous corporate governance issues ... shares pledged ... not cooperating on questions ... TV interviews").
// A report is researched by Claude on the web for ONE company in a Claude Code session (the GovernanceCheck skill; no API key, no model call from this site). Code adds the hard
// facts (pledge history, promoter holding, governance-keyword NSE filings, concall tone), checks that every quote appears on its linked page, and pushes (key governanceCheck).
// The page cannot research a new name by itself: typing a company that has no report shows the sentence to send to Claude.

type Item = { effect?: "Friendly" | "Neutral" | "Unfriendly"; category: string; date?: string; status: string; severity: 1 | 2 | 3; title: string; detail: string; source_title?: string; source_url: string; quote: string; verified?: boolean | null };
interface Rep {
  symbol: string; name: string; as_of: string; verdict: "Clean" | "Watch" | "Concerns" | "Serious"; verdict_note?: string; summary: string; items: Item[]; tv_note?: string; searched?: string[]; gaps?: string[];
  pledge_now?: number | null; pledge_hist?: { label?: string; of_promoter?: number | null; of_company?: number | null }[]; promoter_series?: { q?: string; promoters?: number | null }[] | null;
  nse_matches?: { date: string; subject: string; text: string; file?: string }[]; nse_scanned?: number;
  borrowing_note?: string;
  borrowing?: { basis: string; years: { fy: string; interest: number | null; borrowings: number | null; rate_pct: number | null; interest_cover: number | null; reliable?: boolean }[] } | null;
  rpt_filings?: { date: string; file: string; scanned_pdf?: boolean; loan_rate_lines?: string[]; error?: string }[] | null;
  annual_report?: { year: string; url: string; scanned_pdf?: boolean; error?: string; rate_lines?: { p: number; t: string }[]; related_loan_lines?: { p: number; t: string }[] }[] | null;
  concall?: { call_date: string; tone: string; tone_note?: string; negatives?: string[]; between_the_lines?: string[] } | null;
}

const V: Record<string, string> = {
  Clean: "bg-emerald-50 text-emerald-700 border-emerald-300", Watch: "bg-amber-50 text-amber-700 border-amber-300",
  Concerns: "bg-orange-50 text-orange-700 border-orange-300", Serious: "bg-red-50 text-red-600 border-red-300",
};
const SEV = ["", "bg-slate-100 text-slate-600 border-slate-300", "bg-amber-50 text-amber-700 border-amber-300", "bg-red-50 text-red-600 border-red-300"];
const SEVL = ["", "minor", "notable", "serious"];
const STATUS_HELP: Record<string, string> = {
  Alleged: "claimed by someone (media, short seller, whistleblower, investor); not established",
  Reported: "reported by a news source; not confirmed by a regulator or the company",
  "Order or finding": "stated in a regulator, court or exchange order or filing",
  Resolved: "the matter was closed, settled or cleared according to the source",
  "Company says": "management's own statement",
};

function ItemCard({ it }: { it: Item }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${SEV[it.severity] ?? SEV[1]}`}>{SEVL[it.severity] ?? "minor"}</span>
        {it.effect && <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${it.effect === "Friendly" ? "bg-emerald-50 text-emerald-700 border-emerald-300" : it.effect === "Unfriendly" ? "bg-red-50 text-red-600 border-red-300" : "bg-slate-50 text-slate-600 border-slate-300"}`}>{it.effect === "Friendly" ? "friendly to minorities" : it.effect === "Unfriendly" ? "not minority-friendly" : "neutral"}</span>}
        <span title={STATUS_HELP[it.status]} className="text-[11px] px-2 py-0.5 rounded-full border border-slate-300 bg-slate-50 text-slate-600">{it.status}</span>
        {it.date && <span className="text-xs text-slate-400">{it.date}</span>}
        <span className="text-xs text-slate-400">{it.category}</span>
      </div>
      <div className="text-sm font-medium text-slate-800">{it.title}</div>
      <div className="text-sm text-slate-700 mt-0.5">{it.detail}</div>
      <div className="mt-1.5 border-l-2 border-slate-300 bg-slate-50 pl-2.5 pr-2 py-1 text-[12.5px] leading-snug text-slate-600 rounded-r">
        “{it.quote}”
        <span className="ml-2 text-[11px] text-slate-400">
          {it.verified ? <span className="text-emerald-600" title="Found word for word on the linked page">✓ </span> : <span title="The page could not be read by code (paywall, script-rendered or PDF); open the link to check" className="text-amber-600">link not checked </span>}
          <a className="underline hover:text-slate-600" href={it.source_url} target="_blank" rel="noreferrer">{it.source_title || new URL(it.source_url).hostname}</a>
        </span>
      </div>
    </div>
  );
}

function BorrowCard({ r }: { r: Rep }) {
  const ys = r.borrowing?.years ?? [];
  const ar = r.annual_report?.[0];
  const rpts = (r.rpt_filings ?? []).filter((x) => x.loan_rate_lines?.length);
  if (!ys.length && !ar && !r.borrowing_note) return null;
  const rel = ar?.related_loan_lines ?? [];
  const rate = (ar?.rate_lines ?? []).filter((l) => /\d\s?%|@\s?\d/.test(l.t) && /loan|term|bank|debenture|ncd|facility|cash credit|working capital|borrow/i.test(l.t)).slice(0, 8);
  const link = (p: number) => (ar?.url ? `${ar.url}#page=${p}` : "#");
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1">Cost of borrowing, and loans with promoters and related parties</div>
      {r.borrowing_note && <p className="text-sm text-slate-800 mb-2">{r.borrowing_note}</p>}
      {ys.length > 0 && (
        <div className="overflow-x-auto mb-2">
          <table className="text-xs w-full min-w-[28rem]"><thead className="text-slate-400"><tr><th className="text-left font-normal">Year</th><th className="text-right font-normal">Borrowings ₹ Cr</th><th className="text-right font-normal">Interest ₹ Cr</th><th className="text-right font-normal" title="Interest divided by average borrowings. Screener rounds to whole crores, so small amounts are noisy (grey). Interest can include lease and other finance costs.">Interest ÷ avg borrowings</th><th className="text-right font-normal">Operating profit ÷ interest</th></tr></thead>
            <tbody>{ys.map((y) => <tr key={y.fy} className="border-t border-slate-100"><td className="py-0.5">{y.fy}</td><td className="text-right">{y.borrowings ?? "n/a"}</td><td className="text-right">{y.interest ?? "n/a"}</td>
              <td className={`text-right ${y.reliable ? (y.rate_pct != null && y.rate_pct > 12 ? "text-red-600 font-medium" : "") : "text-slate-400"}`}>{y.rate_pct != null ? `${y.rate_pct}%` : "n/a"}{!y.reliable && y.rate_pct != null ? " (rounded)" : ""}</td><td className="text-right">{y.interest_cover ?? "n/a"}</td></tr>)}</tbody></table>
          <div className="text-[11px] text-slate-400 mt-1">Computed from Screener ({r.borrowing?.basis}). It is an average cost, not a loan-by-loan rate; the rates below come from the annual report.</div>
        </div>
      )}
      {rate.length > 0 && <div className="mb-2"><div className="text-xs font-medium text-slate-600 mb-0.5">Interest rates the annual report states ({ar?.year})</div>
        <ul className="text-xs text-slate-600 space-y-0.5">{rate.map((l, i) => <li key={i}>{l.t} <a className="underline text-slate-400" href={link(l.p)} target="_blank" rel="noreferrer">p.{l.p}</a></li>)}</ul></div>}
      {rel.length > 0 && <div className="mb-2"><div className="text-xs font-medium text-amber-800 mb-0.5">Loans, deposits or advances that mention directors, promoters or related parties ({ar?.year}); read these for the rate and who lends to whom</div>
        <ul className="text-xs text-slate-600 space-y-0.5">{rel.slice(0, 10).map((l, i) => <li key={i}>{l.t} <a className="underline text-slate-400" href={link(l.p)} target="_blank" rel="noreferrer">p.{l.p}</a></li>)}</ul></div>}
      {rpts.length > 0 && <div><div className="text-xs font-medium text-slate-600 mb-0.5">Related-party loan lines in half-yearly exchange filings</div>
        <ul className="text-xs text-slate-600 space-y-0.5">{rpts.slice(0, 4).map((x, i) => <li key={i}><a className="underline" href={x.file} target="_blank" rel="noreferrer">{x.date}</a>: {x.loan_rate_lines?.slice(0, 3).join(" / ")}</li>)}</ul></div>}
      {!rate.length && !rel.length && !rpts.length && <div className="text-xs text-slate-400">The annual report text gave no interest-rate or related-party-loan lines{ar?.scanned_pdf ? " (it looks like a scanned PDF, so nothing could be read)" : ""}. Small companies are often exempt from the half-yearly related-party filing.</div>}
    </div>
  );
}

function Report({ r }: { r: Rep }) {
  const [cat, setCat] = useState("all");
  const cats = useMemo(() => Array.from(new Set(r.items.map((i) => i.category))), [r.items]);
  const items = useMemo(() => r.items.filter((i) => cat === "all" || i.category === cat).sort((a, b) => b.severity - a.severity || (b.date ?? "").localeCompare(a.date ?? "")), [r.items, cat]);
  const chip = (on: boolean) => `px-2 py-0.5 rounded-full border text-xs ${on ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`;
  const ph = (r.pledge_hist ?? []).filter((h) => h.label);
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{r.name}</h2>
          <span className="text-xs text-slate-400">{r.symbol} · researched {r.as_of}</span>
          <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${V[r.verdict]}`}>{r.verdict}</span>
        </div>
        {r.verdict_note && <div className="text-sm text-slate-700 mt-1">{r.verdict_note}</div>}
        <p className="text-sm text-slate-600 mt-2">{r.summary}</p>
        <div className="text-[11px] text-slate-400 mt-2">{r.items.length} sourced items · {r.items.filter((i) => i.severity === 3).length} serious · {r.items.filter((i) => i.status === "Alleged").length} only alleged. The verdict is a reading aid, not advice or a finding of fact.</div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">Promoter pledge and holding (from exchange filings)</div>
          <div className="text-sm text-slate-800 mb-1">Pledged now: <b>{r.pledge_now == null ? "none reported" : r.pledge_now === 0 ? "none (0% of promoter holding)" : `${r.pledge_now}% of promoter holding`}</b></div>
          {ph.length > 0 ? (
            <table className="w-full text-xs"><thead className="text-slate-400"><tr><th className="text-left font-normal">Quarter</th><th className="text-right font-normal">% of promoter holding</th><th className="text-right font-normal">% of company</th></tr></thead>
              <tbody>{ph.map((h, i) => <tr key={i} className="border-t border-slate-100"><td className="py-0.5">{h.label}</td><td className="text-right">{h.of_promoter ?? "n/a"}</td><td className="text-right">{h.of_company ?? "n/a"}</td></tr>)}</tbody></table>
          ) : <div className="text-xs text-slate-400">No pledge history found in the filings.</div>}
          {!!r.promoter_series?.length && <div className="text-xs text-slate-500 mt-2">Promoter holding %: {r.promoter_series.map((p) => `${p.q}: ${p.promoters ?? "n/a"}`).join(" · ")}</div>}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">How management behaves with questions</div>
          {r.concall ? (
            <div className="text-sm text-slate-700 space-y-1">
              <div>Latest concall ({r.concall.call_date}) tone on our Concall Summary page: <b>{r.concall.tone}</b></div>
              {r.concall.tone_note && <div className="text-xs text-slate-500">{r.concall.tone_note}</div>}
              {!!r.concall.between_the_lines?.length && <ul className="list-disc pl-4 text-xs text-slate-600">{r.concall.between_the_lines.slice(0, 4).map((x, i) => <li key={i}>{x}</li>)}</ul>}
            </div>
          ) : <div className="text-xs text-slate-400">No concall summary for this company on the Concall Summary page.</div>}
          <div className="text-sm text-slate-700 mt-2"><b>TV and media interviews:</b> {r.tv_note || "not checked"}</div>
        </div>
      </div>

      <BorrowCard r={r} />

      <div>
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <span className="text-xs text-slate-500">Show:</span>
          <button onClick={() => setCat("all")} className={chip(cat === "all")}>All ({r.items.length})</button>
          {cats.map((c) => <button key={c} onClick={() => setCat(c)} className={chip(cat === c)}>{c} ({r.items.filter((i) => i.category === c).length})</button>)}
        </div>
        {items.length ? <div className="space-y-2">{items.map((it, i) => <ItemCard key={i} it={it} />)}</div> : <div className="text-sm text-slate-500 rounded-lg border border-slate-200 bg-white p-3">No governance issues were found in the sources searched. That is not proof there are none; see what was not covered below.</div>}
      </div>

      {!!r.nse_matches?.length && (
        <details className="rounded-lg border border-slate-200 bg-white p-3">
          <summary className="text-xs font-semibold uppercase tracking-wide text-slate-600 cursor-pointer">NSE filings in the last 3 years that mention auditors, SEBI, defaults, pledges, litigation and similar ({r.nse_matches.length} of {r.nse_scanned} scanned)</summary>
          <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
            {r.nse_matches.map((m, i) => (
              <li key={i}><span className="text-slate-400">{m.date}</span> <b>{m.subject}</b> {m.text.slice(0, 220)}{m.text.length > 220 ? "…" : ""} {m.file && <a className="underline" href={m.file} target="_blank" rel="noreferrer">filing</a>}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="text-xs text-slate-400 space-y-0.5">
        {!!r.gaps?.length && <div><b>Not covered or not found:</b> {r.gaps.join(" · ")}</div>}
        {!!r.searched?.length && <div><b>Searches run:</b> {r.searched.join(" · ")}</div>}
      </div>
    </div>
  );
}

export default function Governance() {
  const { bundle } = useData();
  const { ready } = useScreeners(["governanceCheck"]);
  const entry = bundle.momentum_screeners.governanceCheck;
  const reps = (entry?.rows ?? []) as Rep[];
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const term = q.trim().toLowerCase();
  const match = useMemo(() => reps.find((r) => r.symbol.toLowerCase() === term || r.name.toLowerCase() === term), [reps, term]);
  const cur = reps.find((r) => r.symbol === (match?.symbol ?? sel)) ?? null;
  const prompt = q.trim() ? `Run a governance check on ${q.trim()}` : "Run a governance check on <company name>";

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">🛡️ Governance Check</h1>
        <span className="text-slate-500 text-sm">fund diversion, regulator action, auditor exits, pledges, investor treatment, concall and TV conduct, with sources</span>
      </div>
      <div className="flex items-center gap-2 mb-3">{entry?.as_of && <span className="text-xs text-slate-400">updated {entry.as_of}</span>}</div>
      <MethodologyNote>
        <p className="mb-2"><b>How it is made.</b> You name a company; Claude researches the web for it in a Claude Code session (news, SEBI and court orders, auditor and director exits, short-seller reports, TV interviews), and the skill adds exchange facts (pledge history, promoter holding, NSE filings that mention auditors, SEBI, defaults and the like) and the concall tone from the Concall Summary page. Nothing runs on a schedule and no model is called from this site, so a new company needs to be asked for in Claude Code.</p>
        <p className="mb-2"><b>Every item carries a source link and a quote.</b> Code looks for the quote on the linked page and shows a green ✓ when found; a page it cannot read (paywall, scripts, PDF) is marked "link not checked". Each item is labelled <i>Alleged</i>, <i>Reported</i>, <i>Order or finding</i>, <i>Resolved</i> or <i>Company says</i>, so a claim in a news story is never presented as an established fact.</p>
        <p><b>Limits.</b> Search finds what was published, not what is true; an empty list is not a clean bill of health. The verdict is a reading aid, not a recommendation.</p>
      </MethodologyNote>

      {!ready ? <ScreenerLoading label="Governance Check" /> : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input list="gov-names" value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} placeholder="Type a company or symbol" className="border border-slate-300 rounded px-2 py-1 text-sm w-72" />
            <datalist id="gov-names">{reps.map((r) => <option key={r.symbol} value={r.symbol}>{r.name}</option>)}</datalist>
            {reps.map((r) => (
              <button key={r.symbol} onClick={() => { setSel(r.symbol); setQ(""); }} className={`px-2 py-0.5 rounded-full border text-xs ${cur?.symbol === r.symbol ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}>
                {r.symbol} <span className={`ml-1 px-1 rounded ${cur?.symbol === r.symbol ? "bg-white/20" : V[r.verdict]}`}>{r.verdict}</span>
              </button>
            ))}
          </div>
          {cur ? <Report r={cur} /> : term ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-700">
              No report for “{q.trim()}” yet. Send this to Claude Code and it will research it and add it here:
              <div className="mt-2 flex items-center gap-2"><code className="bg-slate-100 rounded px-2 py-1 text-xs">{prompt}</code>
                <button className="text-xs underline" onClick={() => { try { void navigator.clipboard.writeText(prompt); } catch { /* clipboard unavailable */ } }}>Copy</button></div>
            </div>
          ) : reps.length === 0 ? <div className="text-sm text-slate-500">No governance reports yet. Ask Claude Code: “Run a governance check on &lt;company&gt;”.</div> : <div className="text-sm text-slate-500">Pick a company above or type one.</div>}
        </>
      )}
    </div>
  );
}
