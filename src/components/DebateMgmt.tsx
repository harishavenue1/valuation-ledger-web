import type { ReactNode } from "react";
import { DeltaBars, ShareCountBars, fmtSigned, type Num } from "./DebateViz";

// The "Management" tab of the Research Debate page (2026-11-01, "track management track record").
// Built by CODE (StockDebate scripts/mgmt_block.py) from the Guide page's own numbers and the Fund Raising page's events; no model writes any of it.
// A mechanical count of how management treated shareholders' money, not a verdict on character.

export type MgmtCheck = { n: number; label: string; pass: boolean | null; detail?: string };
export type MgmtRaise = { type: string; date?: string | null; stage?: string | null; amount_cr?: number | null; issue_price?: number | null; market_price?: number | null; disc?: number | null; since_rel?: number | null; m6_rel?: number | null; url?: string | null; reason?: string | null };
export interface Mgmt {
  as_of?: string;
  shares?: { years?: string[] | null; cr?: Num[] | null; "1Y"?: number | null; "3Y"?: number | null; "5Y"?: number | null; ex_bonus?: Record<string, number> | null; bonus_flags?: boolean[] | null };
  checks?: MgmtCheck[];
  passed?: number;
  scored?: number;
  roce_pts?: Record<string, number | null>;
  roe_pts?: Record<string, number | null>;
  raises?: MgmtRaise[];
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const kept = (m?: Mgmt) => (m && isNum(m.passed) && isNum(m.scored) && m.scored > 0 ? { passed: m.passed, scored: m.scored } : null);
/** colour of a kept ratio: the same three steps everywhere it appears */
export const keptColor = (passed: number, scored: number) => (passed / scored >= 0.7 ? "var(--good-text)" : passed / scored >= 0.4 ? "var(--ink)" : "var(--crit)");

const RAISE_NAME: Record<string, string> = { QIP: "QIP", "Preferential / warrants": "Preferential", "Rights issue": "Rights issue" };
const RAISE_SHORT: Record<string, string> = { QIP: "QIP", "Preferential / warrants": "Pref.", "Rights issue": "Rights" };
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) : "");
const big = (v: number) => (Math.abs(v) >= 1000 ? `${v > 0 ? ">+" : "<−"}999%` : `${fmtSigned(v)}%`);
const rupee = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const crore = (v: number) => (v >= 1000 ? `₹${(v / 1000).toFixed(1)}k Cr` : `₹${Math.round(v)} Cr`);

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="dbv-panel">
      <div className="dbv-panel-h"><h3>{title}</h3>{hint && <span>{hint}</span>}</div>
      {children}
    </section>
  );
}

/** one segment per check, in the order of the list below: kept / missed / the data cannot say */
function ScoreStrip({ checks }: { checks: MgmtCheck[] }) {
  return (
    <div role="img" aria-label={checks.map((c) => `${c.label}: ${c.pass === true ? "kept" : c.pass === false ? "missed" : "no data"}`).join(", ")} style={{ display: "flex", gap: 3, flex: "1 1 220px", maxWidth: 360 }}>
      {checks.map((c) => (
        <span key={c.n} title={`${c.label}: ${c.pass === true ? "kept" : c.pass === false ? "missed" : "no data"}`}
          style={{ flex: 1, height: 8, borderRadius: 2, background: c.pass === true ? "var(--good)" : c.pass === false ? "var(--crit)" : "var(--wash)", outline: c.pass === null ? "1px solid var(--grid)" : undefined, outlineOffset: -1 }} />
      ))}
    </div>
  );
}

const STATUS = {
  true: { word: "Kept", mark: "✓", color: "var(--good-text)" },
  false: { word: "Missed", mark: "✗", color: "var(--crit)" },
  null: { word: "No data", mark: "?", color: "var(--muted)" },
} as const;

export function MgmtTab({ mgmt }: { mgmt: Mgmt }) {
  const sh = mgmt.shares ?? {};
  const years = Array.isArray(sh.years) ? sh.years : [];
  const shareCr = Array.isArray(sh.cr) ? sh.cr : [];
  const checks = Array.isArray(mgmt.checks) ? mgmt.checks : [];
  const raises = Array.isArray(mgmt.raises) ? mgmt.raises : [];
  const k = kept(mgmt);
  const missed = checks.filter((c) => c.pass === false);
  const pts = (m: Record<string, number | null> | undefined, who: string) => [["y1", "1 yr"], ["y3", "3 yrs"], ["y5", "5 yrs"]].map(([key, l]) => ({ label: `${who} · ${l}`, value: m?.[key] }));
  const flagged = Array.isArray(sh.bonus_flags) && sh.bonus_flags.some(Boolean);
  const change = (label: string, key: "1Y" | "3Y" | "5Y") => {
    const raw = sh[key], adj = sh.ex_bonus?.[key];
    const eff = isNum(adj) ? adj : raw;
    return (
      <div key={key} style={{ minWidth: 92 }}>
        <div style={{ fontSize: 11, color: "var(--ink2)" }}>{label}</div>
        <div style={{ fontSize: 17, fontWeight: 600, color: isNum(eff) ? (eff < 5 ? "var(--good-text)" : "var(--crit)") : "var(--muted)" }}>{isNum(eff) ? big(eff) : "—"}</div>
        {isNum(adj) && isNum(raw) && <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{big(raw)} raw</div>}
      </div>
    );
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* the answer first: how many kept, which ones were missed */}
      <div className="dbv-panel" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 24px" }}>
        {k ? (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 30, fontWeight: 600, lineHeight: 1, color: keptColor(k.passed, k.scored) }}>{k.passed}</span>
              <span style={{ fontSize: 14, color: "var(--ink2)" }}>of {k.scored} checks kept</span>
            </div>
            <ScoreStrip checks={checks} />
            <div style={{ flex: "1 1 240px", fontSize: 12.5, color: "var(--ink)", lineHeight: 1.5 }}>
              {missed.length ? <><b style={{ color: "var(--crit)" }}>Missed: </b>{missed.map((c) => c.label).join(", ")}.</> : "Every check the data could score was kept."}
              {checks.some((c) => c.pass === null) && <span style={{ color: "var(--muted)" }}> {checks.filter((c) => c.pass === null).length} could not be scored (grey).</span>}
            </div>
          </>
        ) : <span style={{ fontSize: 13, color: "var(--ink2)" }}>Too little reporting history to score this company (a recent listing, or a financial company with no published ROCE).</span>}
      </div>

      <div className="dbv-grid">
        <Section title="New shares issued" hint="share count by year">
          <ShareCountBars years={years} cr={shareCr} bonus={Array.isArray(sh.bonus_flags) ? sh.bonus_flags : undefined} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "6px 12px", marginTop: 10 }}>{change("1 year", "1Y")}{change("3 years", "3Y")}{change("5 years", "5Y")}</div>
          {flagged && <p className="dbv-note">Grey bars are a clean ratio (1:1, 2:1 and the like), usually a bonus issue or split. Those take nothing from existing holders, so the check and the figures above leave them out. It is a guess from the numbers; the filing says for sure.</p>}
        </Section>
        <Section title="Did new capital earn more?" hint="change in points">
          <DeltaBars rows={[...pts(mgmt.roce_pts, "ROCE"), ...pts(mgmt.roe_pts, "ROE")]} unit=" pts" />
          <p className="dbv-note">Blue is improvement, red is decline, measured against 1, 3 and 5 years ago.</p>
        </Section>
      </div>

      <Section title="The checks, with the number behind each">
        {checks.length ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {checks.map((c, i) => {
              const st = STATUS[String(c.pass) as "true" | "false" | "null"];
              return (
                <li key={c.n} className="dbv-check" style={{ borderTop: i ? "1px solid var(--grid)" : undefined }}>
                  <span style={{ color: st.color, border: `1px solid ${st.color}` }} className="dbv-status"><b>{st.mark}</b> {st.word}</span>
                  <span style={{ fontWeight: 500, color: "var(--ink)" }}>{c.label}</span>
                  <span style={{ color: "var(--ink2)" }}>{c.detail}</span>
                </li>
              );
            })}
          </ul>
        ) : <p className="dbv-note">No checks available.</p>}
      </Section>

      <Section title="Raises in the last two years" hint="NSE filings: QIP, preferential and rights issues">
        {raises.length ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
            {raises.map((r, i) => (
              <li key={i} className="dbv-raise">
                <div>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px" }}>
                    <b style={{ fontSize: 13, color: "var(--ink)" }}>{RAISE_NAME[r.type] ?? r.type}</b>
                    <span style={{ fontSize: 12, color: "var(--ink2)" }}>{day(r.date)}{r.stage ? ` · ${r.stage}` : ""}{isNum(r.amount_cr) ? ` · ${crore(r.amount_cr)}` : ""}</span>
                    {r.url && <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--pos)" }}>filing ↗</a>}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink)", marginTop: 4 }}>
                    {isNum(r.issue_price)
                      ? <>Issued at <b>{rupee(r.issue_price)}</b>{isNum(r.market_price) && <> against a market close of {rupee(r.market_price)}{isNum(r.disc) && <> (<b style={{ color: r.disc <= 0 ? "var(--ink)" : "var(--crit)" }}>{fmtSigned(r.disc * 100)}%</b>)</>}</>}</>
                      : <span style={{ color: "var(--muted)" }}>The issue price was not found in the filings.</span>}
                  </div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "var(--ink2)", marginBottom: 2 }}>Move vs the Nifty Midcap 150 since the filing</div>
                  <DeltaBars rows={[{ label: `${RAISE_SHORT[r.type] ?? r.type} ${day(r.date)}`, value: isNum(r.since_rel) ? r.since_rel * 100 : null, note: "return relative to the index since the first close after the filing" }]} />
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="dbv-note" style={{ margin: 0 }}>No QIP, preferential or rights issue found in NSE filings over the last two years.</p>}
      </Section>
      <p className="dbv-note" style={{ margin: 0 }}>From filings and reported numbers. A mechanical count, not a verdict on character. The guidance management gave on calls against what it delivered is not covered yet.</p>
    </div>
  );
}
