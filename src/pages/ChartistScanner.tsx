import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData, useScreeners } from "../App";
import RunButton from "../components/RunButton";
import { rsTone } from "../lib/rsRating";
import { Col, fmtNum, GenericTable, MethodologyNote, PriceLink, ScreenerLoading, Signed } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";

// Chartist_RS_Scanner as its own page (2026-11-07, "move chartist scanner to main page" -> own top-nav page). It was a tab on Momentum Screeners;
// the scan itself (api/_bhav.py compute_chartist_scan, key chartistRs) is unchanged. Also loads the PF rows for the "In my PF" chip.

    // 25 columns: short headers (full name on hover) and a weight per column, normalised to 100% below; the table has a minimum width (see minWidth on the GenericTable) so it scrolls sideways instead of overlapping headers
const COLS: Col[] = ((): Col[] => {
      const W: (Col & { w: number })[] = [
        { w: 9.5, key: "symbol", label: "Symbol", align: "left" },
        { w: 10.5, key: "name", label: "Name", align: "left" },
        { w: 7.5, key: "sector", label: "Sector", align: "left" },
        { w: 4.6, key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
        {
          w: 6.6,
          key: "status",
          label: "Setup",
          align: "left",
          title: "Breakout = closed above the tight zone's high (within 5%); Ready = within 3% below it; In base = inside the zone; Extended = already more than 5% above it; Below base = closed under its low; No base = no 1-month base with a tight right side",
          render: (r) => (
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${
                r.status === "Breakout"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                  : r.status === "Ready"
                    ? "bg-sky-50 text-sky-700 border-sky-300"
                    : r.status === "In base"
                      ? "bg-amber-50 text-amber-700 border-amber-300"
                      : r.status === "Extended"
                        ? "bg-orange-50 text-orange-700 border-orange-300"
                        : r.status === "Below base"
                          ? "bg-red-50 text-red-600 border-red-300"
                          : "bg-slate-100 text-slate-500 border-slate-300"
              }`}
            >
              {r.status}
              {r.status === "Breakout" && r.breakout_age ? ` (${r.breakout_age}d)` : ""}
            </span>
          ),
        },
        { w: 3.8, key: "phase", label: "Leg", align: "left", title: "Move since the 3M RS last crossed 80: Early up to 50%, Mid up to 100%, Late beyond", render: (r) => (r.phase ? <span className={r.phase === "Late" ? "text-orange-600" : "text-emerald-700 font-medium"}>{r.phase}</span> : "—") },
        {
          w: 13,
          key: "misses",
          label: "Misses",
          align: "left",
          title: "Filters of the scan this RS 80+ stock does not meet (empty = full match): 200 DMA, 30-day turnover ₹10 Cr, market cap ₹500 Cr, price ₹10",
          render: (r) => (r.misses?.length ? <span className="text-orange-700" title={r.misses.join(" · ")}>{r.misses.join(" · ")}</span> : <span className="text-emerald-600">full match</span>),
        },
        { w: 4, key: "rs_3m", label: "RS 3M", title: "His RS: percentile (1-99) of the 3-month return among the NSE 750", render: (r) => <span className={`font-semibold ${rsTone(r.rs_3m)}`}>{r.rs_3m}</span> },
        { w: 4.8, key: "rs_4w_ago", label: "RS 4W ago", title: "The 3M RS four weeks ago", render: (r) => (r.rs_4w_ago == null ? "—" : r.rs_4w_ago) },
        { w: 4.4, key: "rs_rating", label: "RS comp.", title: "Reference only: the composite RS Rating (0.4 x 3M + 0.3 x 6M + 0.3 x 1Y) shown on All Technicals and Portfolio Allocation", render: (r) => (r.rs_rating == null ? "—" : r.rs_rating) },
        { w: 4.4, key: "rs_weeks", label: "Wks ≥ 80", title: "Weeks the 3M RS has stayed at 80 or more (a + means it was already above 80 at the start of the history we hold)", render: (r) => (r.rs_weeks == null ? "—" : `${r.rs_weeks}${r.rs_weeks_capped ? "+" : ""}`) },
        { w: 5, key: "move_since_rs80_pct", label: "Since 80 %", title: "Price move since the 3M RS last went from below 80 to 80+", render: (r) => <Signed v={r.move_since_rs80_pct} digits={0} /> },
        { w: 5, key: "base_days", label: "Base/tight", title: "Sessions in the long base / sessions in the tight zone on its right side", render: (r) => (r.base_days ? `${r.base_days} / ${r.tight_days || 0}` : "—") },
        { w: 4.4, key: "base_depth_pct", label: "Depth %", title: "Depth of the long base (high to low, % of high)", render: (r) => fmtNum(r.base_depth_pct, 1) },
        { w: 5, key: "trigger", label: "Trigger ₹", title: "High of the tight zone: the entry", render: (r) => fmtNum(r.trigger, 2) },
        { w: 4.8, key: "stop", label: "Stop ₹", title: "Low of the tight zone: the stop", render: (r) => fmtNum(r.stop, 2) },
        { w: 4, key: "risk_pct", label: "Risk %", title: "Entry (the higher of price and trigger) down to the stop", render: (r) => fmtNum(r.risk_pct, 1) },
        { w: 4, key: "size_pct", label: "Size %", title: "Position size for 1% capital risk = 100 ÷ risk % (the video's shortcut)", render: (r) => fmtNum(r.size_pct, 1) },
        { w: 4.6, key: "above_trigger_pct", label: "vs Trig %", title: "Price against the trigger", render: (r) => <Signed v={r.above_trigger_pct} digits={1} /> },
        { w: 4.8, key: "to_base_high_pct", label: "vs Base %", title: "Price against the high of the long base (overhead resistance)", render: (r) => <Signed v={r.to_base_high_pct} digits={1} /> },
        { w: 4.6, key: "vol_dry_x", label: "Dry-up ×", title: "Average volume of the last 10 sessions ÷ the 50 before; under 1 means volume is drying up", render: (r) => fmtNum(r.vol_dry_x, 2) },
        { w: 4, key: "theme_rank", label: "Theme", title: "Rank by 3M RS among this scan's names in the same sector, e.g. 1/9 = leader of nine (NSE-750 members only)", render: (r) => (r.theme_n ? `${r.theme_rank}/${r.theme_n}` : "—") },
        { w: 4.4, key: "pct_50d_ema", label: "vs 50D %", title: "Close against the 50-day EMA (his trailing exit)", render: (r) => <Signed v={r.pct_50d_ema} digits={1} /> },
        { w: 5.6, key: "pct_from_52w_high", label: "vs 52WH %", title: "Distance from the 52-week high", render: (r) => <Signed v={r.pct_from_52w_high} digits={1} /> },
        { w: 5, key: "market_cap_cr", label: "Mcap ₹Cr", render: (r) => fmtNum(r.market_cap_cr, 0) },
        { w: 5.8, key: "turnover_30d_cr", label: "Turnover ₹Cr", title: "Average daily traded value over the last 30 sessions", render: (r) => fmtNum(r.turnover_30d_cr, 1) },
      ];
      const total = W.reduce((a, c) => a + c.w, 0);
      return W.map(({ w, ...c }) => ({ ...c, width: +((w / total) * 100).toFixed(3) }));
    })();

const METHOD = (
  <>
        <b>Chartist_RS_Scanner</b> — from Himanshu Sharma's (@thechartist26) Konversation with Kushal #403, "His Exact 5-Step Strategy". Runs every
        evening over <b>every NSE stock</b> in our daily store. <b>Step 1, his "RS 80" scan:</b> price above the <b>200 DMA</b> (simple average of
        closes), <b>RS 80–100</b>, average daily turnover over the last 30 sessions ≥ <b>₹10 Cr</b>, market cap above <b>₹500 Cr</b>, price above
        ₹10 (he got 265 stocks on 5 Nov 2026 — the funnel above shows today's count). <b>RS</b> is his 3-month RS — he says 3 months is "the apt number", neither late nor early: the <b>percentile (1–99) of the
        3-month return</b> (13 weekly bars) ranked among the <b>NSE 750</b>, ties counting half, so 99 = top 1%. He ranks all ~2,500 NSE stocks, so a
        small stock outside the 750 can read high — the market-cap and turnover filters limit that. The composite <b>RS Rating (All Tech.)</b>
        column (0.4 × 3M + 0.3 × 6M + 0.3 × 1Y, the number on All Technicals and Portfolio Allocation) is shown for reference only and is not
        used to select. <b>Step 2, his chart template, computed for
        each name:</b> a <b>long base</b> of at least <b>21 sessions</b> inside a range no deeper than <b>25%</b>, with a <b>tight right side</b> of at least{" "}
        <b>8 sessions</b> inside <b>8%</b> ("if the base is wider than 8% it is not a proper base"). <b>Trigger</b> = the tight zone's high (his entry),{" "}
        <b>Stop</b> = its low, <b>Risk %</b> = entry to stop, <b>Size %</b> = <b>100 ÷ risk %</b> (his shortcut for risking 1% of capital; he runs 10–30%
        positions). Setup: <b>Breakout</b> = closed above the trigger within 5% (age in days if it happened in the last 5 sessions), <b>Ready</b> = within
        3% below it, <b>In base</b> = inside the zone, <b>Extended</b> = already more than 5% above it (chasing widens the stop), <b>Below base</b> =
        closed under the stop. <b>Leg</b>: "first or second leg after RS crosses 80" is read as the price move since the 3M RS last went from below
        80 to 80+ (<b>Early</b> up to 50%, <b>Mid</b> up to 100%, <b>Late</b> beyond); <b>Weeks RS ≥ 80</b> counts the unbroken streak of 3M RS ≥ 80 (a + means
        it was already above 80 at the start of the history we hold). <b>Theme rank</b>: his "first and second name of a strong theme" — rank by 3M RS
        among this scan's names in the same sector, so 1/9 is the leader of nine; sectors are only known for NSE-750 members. <b>Vol dry-up ×</b>
        under 1 = volume drying up in the last 10 sessions. <b>Exit</b> (not computed): he trails the <b>50 EMA</b> — see <b>% vs 50D EMA</b>.
        The base lengths/depths, 5%/3% bands and leg limits are my readings where the video gives no number (constants in api/_bhav.py, CHARTIST).
        The top strip shows his <b>market health</b> gauge (share of liquid stocks above their 50/200 DMA, advancers vs decliners, new 52-week
        highs vs lows). <b>Partial matches</b>: every stock with 3M RS of 80+ is listed, and one that fails another filter (below its 200 DMA, 30-day turnover under ₹10 Cr, market cap under ₹500 Cr, price ₹10 or less, or under 200 stored sessions so no 200 DMA) is tagged <b>Partial</b> with the filters it misses in the <b>Misses</b> column; <b>Full</b> means it meets every filter. Theme rank counts full matches only. Default view shows full matches, setups only; use the chips for the rest. Educational — not advice.
  </>
);

export default function ChartistScanner() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const { ready } = useScreeners(["chartistRs", "portfolioAllocation"]);
  const entry = bundle.momentum_screeners.chartistRs;
  // chips (filter the rows in the browser; the scan itself is the same for everyone)
  const [cStatus, setCStatus] = useState<"all" | "setups" | "Breakout" | "Ready">("setups");
  const [cLeg, setCLeg] = useState<"all" | "early" | "earlymid">("all");
  const [cLeaders, setCLeaders] = useState(false);
  const [cDry, setCDry] = useState(false);
  const [cMatch, setCMatch] = useState<"full" | "partial" | "all">("full"); // RS 80+ stocks that miss another filter are listed too, tagged with what they miss
  const [cHeld, setCHeld] = useState(false); // your own holdings, whatever their setup status
  const rows = useMemo(() => {
    return (entry?.rows ?? []).filter((r: any) => {
      if (cStatus === "setups" && !["Breakout", "Ready", "In base"].includes(r.status)) return false;
      if ((cStatus === "Breakout" || cStatus === "Ready") && r.status !== cStatus) return false;
      if (cLeg === "early" && r.phase !== "Early") return false;
      if (cLeg === "earlymid" && r.phase !== "Early" && r.phase !== "Mid") return false;
      if (cLeaders && !(r.theme_rank != null && r.theme_rank <= 2)) return false;
      if (cDry && !(r.vol_dry_x != null && r.vol_dry_x < 1)) return false;
      if (cMatch === "full" && r.misses?.length) return false;
      if (cMatch === "partial" && !r.misses?.length) return false;
      if (cHeld && !watchlist.held?.has(r.symbol)) return false;
      return true;
    });
  }, [entry, cStatus, cLeg, cLeaders, cDry, cHeld, cMatch, watchlist.held]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">🔭 Chartist_RS_Scanner</h1>
        <span className="text-slate-500 text-sm">Himanshu Sharma (@thechartist26) · every NSE stock, 3-month RS</span>
      </div>
      <div className="flex items-center gap-2 mb-3">
        {entry?.as_of && <span className="text-xs text-slate-400">as of {entry.as_of}</span>}
        <RunButton screener="chartistRs" />
      </div>
      <MethodologyNote>{METHOD}</MethodologyNote>
      {entry?.funnel && (
        <div className="mb-3 space-y-2">
          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="font-medium text-slate-700">Scan funnel{entry.session ? ` (session ${entry.session})` : ""}:</span>
            {[
              ["Traded", entry.funnel.universe],
              ["above 200 DMA", entry.funnel.above_200dma],
              ["3M RS ≥ 80", entry.funnel.rs_80],
              ["turnover ≥ ₹10 Cr", entry.funnel.turnover],
              ["mcap > ₹500 Cr", entry.funnel.mcap],
              ["price > ₹10", entry.funnel.price],
            ].map(([lab, n], i) => (
              <span key={String(lab)}>
                {i > 0 && <span className="text-slate-300 mr-1.5">→</span>}
                {lab} <b className="text-slate-800">{n ?? "—"}</b>
              </span>
            ))}
            <span className="ml-2 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">
              setups <b>{entry.funnel.setups ?? 0}</b> (breakout {entry.funnel.breakouts ?? 0}, ready {entry.funnel.ready ?? 0})
            </span>
            {entry.funnel.partial != null && <span className="px-2 py-0.5 rounded-full bg-orange-50 border border-orange-200 text-orange-700">+ <b>{entry.funnel.partial}</b> RS 80+ partial matches (miss a filter)</span>}
          </div>
          {entry.health && entry.health.liquid ? (
            <div className="text-xs text-slate-600">
              <span className="font-medium text-slate-700">Market health</span> (the {entry.health.liquid} liquid stocks): {entry.health.above_50dma}% above 50 DMA · {entry.health.above_200dma}% above 200 DMA ·{" "}
              {entry.health.advancers} advancing / {entry.health.decliners} declining today · {entry.health.new_highs} new 52-week highs vs {entry.health.new_lows} lows
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500">Match:</span>
            {([["full", "Full"], ["partial", "Partial (misses a filter)"], ["all", "Both"]] as const).map(([k, lab]) => (
              <button key={k} onClick={() => setCMatch(k)} className={`px-2 py-0.5 rounded-full border ${cMatch === k ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}>
                {lab}
              </button>
            ))}
            <span className="text-slate-300 mx-1">|</span>
            <span className="text-slate-500">Show:</span>
            {([["setups", "Setups"], ["Breakout", "Breakout"], ["Ready", "Ready"], ["all", "All RS 80+"]] as const).map(([k, lab]) => (
              <button key={k} onClick={() => setCStatus(k)} className={`px-2 py-0.5 rounded-full border ${cStatus === k ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}>
                {lab}
              </button>
            ))}
            <span className="text-slate-300 mx-1">|</span>
            <span className="text-slate-500">Leg:</span>
            {([["all", "Any"], ["early", "Early"], ["earlymid", "Early + Mid"]] as const).map(([k, lab]) => (
              <button key={k} onClick={() => setCLeg(k)} className={`px-2 py-0.5 rounded-full border ${cLeg === k ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}>
                {lab}
              </button>
            ))}
            <span className="text-slate-300 mx-1">|</span>
            <button onClick={() => setCLeaders((v) => !v)} className={`px-2 py-0.5 rounded-full border ${cLeaders ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}>
              Theme leaders (top 2)
            </button>
            <button onClick={() => { if (!cHeld) { setCStatus("all"); setCMatch("all"); } setCHeld((v) => !v); }} title="Only stocks you hold (from Portfolio Allocation), whatever their setup status" className={`px-2 py-0.5 rounded-full border ${cHeld ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}>
              In my PF
            </button>
            <button onClick={() => setCDry((v) => !v)} className={`px-2 py-0.5 rounded-full border ${cDry ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}>
              Volume drying up
            </button>
            <span className="text-slate-400 ml-1">{rows.length} shown</span>
          </div>
        </div>
      )}


      {ready ? (
        <GenericTable rows={rows} cols={COLS} navigate={(t) => navigate(`/company/${t}`)} watchlist={watchlist} minWidth={3300} />
      ) : (
        <ScreenerLoading label="Chartist_RS_Scanner" />
      )}
    </div>
  );
}
