import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData, useScreeners } from "../App";
import RunButton from "../components/RunButton";
import { rsTone } from "../lib/rsRating";
import { Col, fmtNum, GenericTable, MethodologyNote, PriceLink, ScreenerLoading, Signed } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";

// F&O Flow (2026-11-07, "what can we build from github.com/MrChartist/order-flow" -> "pick useful things and create a page").
// Idea from that repo (build-up from futures price + open interest, option-chain levels, conviction checks); data and code are ours:
// NSE's end-of-day F&O bhavcopy via api/_fno.py (runner foFlow, after the equity bhavcopy chain), joined here to the Chartist scan and
// your Portfolio Allocation. End-of-day only: nothing intraday.

const BUILDUPS = ["Long build-up", "Short covering", "Short build-up", "Long unwinding"] as const;
const BU_STYLE: Record<string, string> = {
  "Long build-up": "bg-emerald-50 text-emerald-700 border-emerald-300",
  "Short covering": "bg-sky-50 text-sky-700 border-sky-300",
  "Short build-up": "bg-red-50 text-red-600 border-red-300",
  "Long unwinding": "bg-orange-50 text-orange-700 border-orange-300",
  Neutral: "bg-slate-100 text-slate-500 border-slate-300",
};
const BU_HINT: Record<string, string> = {
  "Long build-up": "price up, open interest up: fresh longs",
  "Short covering": "price up, open interest down: shorts closing",
  "Short build-up": "price down, open interest up: fresh shorts",
  "Long unwinding": "price down, open interest down: longs closing",
};

// distance of a level from the future's last price, e.g. support 1,200 on a spot of 1,320 = -9.1%
const away = (lvl: any, ref: any) => (lvl && ref ? (lvl / ref - 1) * 100 : null);

const COLS: Col[] = ((): Col[] => {
  const W: (Col & { w: number })[] = [
    { w: 8, key: "symbol", label: "Symbol", align: "left" },
    { w: 11, key: "name", label: "Name", align: "left" },
    { w: 8, key: "sector", label: "Sector", align: "left" },
    { w: 5.5, key: "fut_close", label: "Fut ₹", title: "Near-month future's close", render: (r) => <PriceLink symbol={r.symbol} value={r.fut_close} /> },
    { w: 4.4, key: "fut_chg_pct", label: "Fut %", title: "Near-month future's close against its previous close", render: (r) => <Signed v={r.fut_chg_pct} digits={2} /> },
    { w: 4.6, key: "oi_chg_pct", label: "OI %", title: "Change in open interest today, all listed months added together (so a roll to the next month is not read as unwinding)", render: (r) => <Signed v={r.oi_chg_pct} digits={1} /> },
    { w: 5, key: "oi_value_cr", label: "OI ₹Cr", title: "Open interest value: shares open x future's close, all months", render: (r) => fmtNum(r.oi_value_cr, 0) },
    {
      w: 7.4,
      key: "buildup",
      label: "Build-up",
      align: "left",
      title: "Futures price direction x open-interest direction. Neutral = the future moved under 0.1% or open interest under 0.5%",
      render: (r) => (
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${BU_STYLE[r.buildup] ?? BU_STYLE.Neutral}`} title={BU_HINT[r.buildup] ?? "no clear build-up"}>
          {r.buildup}
        </span>
      ),
    },
    { w: 3.6, key: "streak", label: "Days", title: "Sessions in a row with this same build-up (from the history we hold, up to 8 sessions)", render: (r) => (r.streak ? r.streak : "—") },
    { w: 4.4, key: "spot_5d_pct", label: "5D %", title: "Spot price change over the last 5 sessions", render: (r) => <Signed v={r.spot_5d_pct} digits={1} /> },
    { w: 4.4, key: "oi_5d_pct", label: "5D OI %", title: "Open interest change over the last 5 sessions", render: (r) => <Signed v={r.oi_5d_pct} digits={1} /> },
    { w: 3.8, key: "pcr", label: "PCR", title: "Put open interest ÷ call open interest of the nearest options expiry. Above about 1 = more puts written (support), below about 0.7 = more calls (a lid)", render: (r) => (r.pcr == null ? "—" : <span className={r.pcr >= 1.1 ? "text-emerald-700" : r.pcr <= 0.7 ? "text-red-600" : ""}>{fmtNum(r.pcr, 2)}</span>) },
    {
      w: 6.4,
      key: "support",
      label: "Support",
      title: "Strike with the most put open interest at or below spot (where put writers defend), and how far it is below the future",
      render: (r) => (r.support ? <span>{fmtNum(r.support, 0)} <span className="text-slate-400 text-[10px]">{fmtNum(away(r.support, r.spot ?? r.fut_close), 1)}%</span></span> : "—"),
    },
    {
      w: 6.4,
      key: "resistance",
      label: "Resist.",
      title: "Strike with the most call open interest at or above spot (where call writers cap it), and how far it is above the future",
      render: (r) => (r.resistance ? <span>{fmtNum(r.resistance, 0)} <span className="text-slate-400 text-[10px]">{(away(r.resistance, r.spot ?? r.fut_close) ?? 0) >= 0 ? "+" : ""}{fmtNum(away(r.resistance, r.spot ?? r.fut_close), 1)}%</span></span> : "—"),
    },
    { w: 4.6, key: "max_pain", label: "Max pain", title: "Strike where option buyers lose the most at expiry", render: (r) => (r.max_pain ? fmtNum(r.max_pain, 0) : "—") },
    {
      w: 5.4,
      key: "add_strike",
      label: "OI added",
      title: "Strike where the most open interest was added today (CE = calls written above, a lid; PE = puts written below, support)",
      render: (r) => (r.add_strike ? <span className={r.add_type === "PE" ? "text-emerald-700" : "text-red-600"}>{fmtNum(r.add_strike, 0)} {r.add_type}</span> : "—"),
    },
    {
      w: 4.4,
      key: "writers_lean",
      label: "Writers",
      title: "Option writers' lean today: (put OI added - call OI added) ÷ both, -1 to +1. Positive = puts being written (bullish), negative = calls (bearish)",
      render: (r) => (r.writers_lean == null ? "—" : <Signed v={r.writers_lean} digits={2} />),
    },
    {
      w: 5,
      key: "conviction",
      label: "Conviction",
      title: "How many of 5 checks agree with the move: new positions opened, spot agrees, option writers lean the same way, sector agrees, 5 sessions agree (price and OI)",
      render: (r) =>
        r.conviction == null ? (
          "—"
        ) : (
          <span title={r.why?.length ? r.why.join(" · ") : "no checks agree"} className={r.conviction >= 4 ? "text-emerald-700 font-semibold" : r.conviction >= 3 ? "text-slate-700" : "text-slate-400"}>
            {"●".repeat(r.conviction)}
            <span className="text-slate-300">{"●".repeat(5 - r.conviction)}</span>
          </span>
        ),
    },
    { w: 3.8, key: "rs_3m", label: "RS 3M", title: "Percentile (1-99) of the 3-month return among the NSE 750", render: (r) => (r.rs_3m == null ? "—" : <span className={`font-semibold ${rsTone(r.rs_3m)}`}>{r.rs_3m}</span>) },
    {
      w: 6.4,
      key: "chartist",
      label: "Chartist",
      align: "left",
      title: "Setup status from Chartist_RS_Scanner when this stock is an RS 3M 80+ name (partial = misses one of its filters)",
      render: (r) => (r.chartist ? <span className={r.chartist_partial ? "text-orange-700" : r.chartist === "Breakout" || r.chartist === "Ready" ? "text-emerald-700 font-medium" : ""}>{r.chartist}{r.chartist_partial ? " (partial)" : ""}</span> : "—"),
    },
    { w: 4, key: "pf_pct", label: "PF %", title: "Share of your portfolio", render: (r) => (r.pf_pct == null ? "—" : fmtNum(r.pf_pct, 1)) },
    { w: 4.8, key: "pct_52wh", label: "vs 52WH %", title: "Distance from the 52-week high", render: (r) => <Signed v={r.pct_52wh} digits={1} /> },
    { w: 4, key: "basis_pct", label: "Basis %", title: "Near-month future over spot", render: (r) => <Signed v={r.basis_pct} digits={2} /> },
  ];
  const total = W.reduce((a, c) => a + c.w, 0);
  return W.map(({ w, ...c }) => ({ ...c, width: +((w / total) * 100).toFixed(3) }));
})();

const METHOD = (
  <>
    <p className="mb-2">
      <b>What this is.</b> The whole F&amp;O market in one table, read from NSE&rsquo;s own end-of-day F&amp;O bhavcopy (about 218 stock underlyings and the major indexes). The idea is borrowed from the open-source{" "}
      <a className="underline" href="https://github.com/MrChartist/order-flow" target="_blank" rel="noreferrer">
        Order Flow
      </a>{" "}
      board; the data, the arithmetic and the page are ours. It is <b>end of day</b>: nothing here is intraday.
    </p>
    <p className="mb-2">
      <b>Build-up</b> = the near-month future&rsquo;s move against its previous close, read with the change in open interest (OI summed over every listed month, so a roll to the next month does not look like unwinding). Price up with OI up is a <b>long build-up</b> (fresh longs); price up with OI down is <b>short covering</b>; price down with OI up is a <b>short build-up</b>; price down with OI down is <b>long unwinding</b>. A future that moved under 0.1%, or OI under 0.5%, is Neutral. <b>Days</b> counts how many sessions in a row the same build-up has held.
    </p>
    <p className="mb-2">
      <b>Levels from the option chain</b> (nearest expiry): <b>Support</b> = the strike with the most put OI at or below spot, <b>Resist.</b> = the strike with the most call OI at or above spot, <b>Max pain</b> = the strike where option buyers lose most at expiry, <b>OI added</b> = the strike (and CE/PE) where the most OI was added today, <b>PCR</b> = put OI ÷ call OI, <b>Writers</b> = (put OI added − call OI added) ÷ both. A lot of OI at a round strike is a level the market respects, not a prediction.
    </p>
    <p className="mb-2">
      <b>Conviction</b> (0 to 5 dots) counts the checks that agree with the future&rsquo;s direction: (1) new positions opened with the move, (2) spot moved the same way, (3) option writers lean the same way (≥ 0.15), (4) the sector&rsquo;s median F&amp;O move is the same way, (5) price and OI over 5 sessions agree. Hover the dots for which ones held. Order Flow&rsquo;s own list has a &ldquo;last hour agrees&rdquo; check that needs minute data; the 5-session check stands in for it.
    </p>
    <p>
      <b>How it ties to the rest of the app.</b> RS 3M is the same percentile as Chartist_RS_Scanner and All Technicals. <b>Chartist</b> shows the scanner&rsquo;s setup status for the names that are RS 3M 80+, and <b>PF %</b> your Portfolio Allocation weight, so a holding or a setup that has F&amp;O shows its derivatives picture beside it. Only about 8 of your holdings and 44 of the Chartist full matches have F&amp;O, so most rows here are the wider market, which doubles as the market-health read.
    </p>
  </>
);

export default function FnoFlow() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const { ready } = useScreeners(["foFlow", "chartistRs", "portfolioAllocation"]);
  const entry = bundle.momentum_screeners.foFlow;
  const [bu, setBu] = useState<string>("all");
  const [conv, setConv] = useState(0);
  const [onlyHeld, setOnlyHeld] = useState(false);
  const [onlySetups, setOnlySetups] = useState(false);
  const [rs80, setRs80] = useState(false);
  const [streak2, setStreak2] = useState(false);
  const [showIdx, setShowIdx] = useState(false);

  // join: the Chartist scan (setup status) and the PF weights, by symbol
  const chartist = useMemo(() => new Map<string, any>((bundle.momentum_screeners.chartistRs?.rows ?? []).map((r: any) => [r.symbol, r])), [bundle.momentum_screeners.chartistRs]);
  const pf = useMemo(() => new Map<string, number>((bundle.momentum_screeners.portfolioAllocation?.rows ?? []).map((r: any) => [r.symbol, r.pct_of_portfolio ?? 0])), [bundle.momentum_screeners.portfolioAllocation]);
  const all = useMemo(
    () =>
      (entry?.rows ?? []).map((r: any) => {
        const c = chartist.get(r.symbol);
        return { ...r, chartist: c?.status ?? null, chartist_partial: !!c?.misses?.length, pf_pct: pf.has(r.symbol) ? pf.get(r.symbol) : null };
      }),
    [entry, chartist, pf],
  );
  const rows = useMemo(
    () =>
      all.filter((r: any) => {
        if (r.kind === "index" && !showIdx) return false;
        if (bu !== "all" && r.buildup !== bu) return false;
        if (conv && !((r.conviction ?? 0) >= conv)) return false;
        if (onlyHeld && !(r.pf_pct != null || watchlist.held?.has(r.symbol))) return false;
        if (onlySetups && !(r.chartist && !r.chartist_partial && ["Breakout", "Ready", "In base"].includes(r.chartist))) return false;
        if (rs80 && !((r.rs_3m ?? 0) >= 80)) return false;
        if (streak2 && !((r.streak ?? 0) >= 2)) return false;
        return true;
      }),
    [all, bu, conv, onlyHeld, onlySetups, rs80, streak2, showIdx, watchlist.held],
  );
  const s = entry?.summary as any;
  const chip = (on: boolean) => `px-2 py-0.5 rounded-full border ${on ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"}`;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">📊 F&amp;O Flow</h1>
        <span className="text-slate-500 text-sm">where the money is moving across F&amp;O · NSE end-of-day futures and options</span>
      </div>
      <div className="flex items-center gap-2 mb-3">
        {entry?.session && <span className="text-xs text-slate-400">session {entry.session}{s?.history_sessions ? ` · ${s.history_sessions} sessions of history` : ""}</span>}
        <RunButton screener="foFlow" />
      </div>
      <MethodologyNote>{METHOD}</MethodologyNote>

      {s && (
        <div className="mb-3 space-y-2">
          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-slate-700">Market ({s.stocks} F&amp;O stocks):</span>
            <span>
              <b className="text-emerald-600">{s.up}</b> up · <b className="text-slate-700">{s.flat}</b> flat · <b className="text-red-600">{s.down}</b> down
            </span>
            <span>median future move <Signed v={s.median_move_pct} digits={2} />%</span>
            {BUILDUPS.map((k) => (
              <span key={k} className={`px-2 py-0.5 rounded-full border ${BU_STYLE[k]}`} title={BU_HINT[k]}>
                {k} <b>{s.buildup_counts?.[k] ?? 0}</b>
              </span>
            ))}
            <span className="text-slate-400">Neutral {s.buildup_counts?.Neutral ?? 0}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"].filter((k) => s.indexes?.[k]).map((k) => {
              const x = s.indexes[k];
              return (
                <div key={k} className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <b className="text-slate-800">{k}</b>
                    <span>{fmtNum(x.fut_close, 0)}</span>
                    <Signed v={x.fut_chg_pct} digits={2} />
                    <span className={`px-1.5 rounded-full border text-[10px] ${BU_STYLE[x.buildup] ?? BU_STYLE.Neutral}`}>{x.buildup}</span>
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    OI <Signed v={x.oi_chg_pct} digits={1} />% · PCR {fmtNum(x.pcr, 2)} · support {fmtNum(x.support, 0)} · resistance {fmtNum(x.resistance, 0)} · max pain {fmtNum(x.max_pain, 0)}
                  </div>
                </div>
              );
            })}
          </div>
          {s.sectors?.length ? (
            <div className="text-xs text-slate-600 flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-slate-700">Sector median move:</span>
              {[...s.sectors.slice(0, 5), ...(s.sectors.length > 10 ? [null] : []), ...s.sectors.slice(-5)].map((x: any, i: number) =>
                x ? (
                  <span key={x.sector} title={`${x.n} F&O names: ${x.up} up, ${x.down} down`} className={`px-2 py-0.5 rounded-full border ${x.median_pct >= 0 ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-600"}`}>
                    {x.sector} {x.median_pct >= 0 ? "+" : ""}{x.median_pct.toFixed(2)}%
                  </span>
                ) : (
                  <span key={`gap${i}`} className="text-slate-300">…</span>
                ),
              )}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500">Build-up:</span>
            {["all", ...BUILDUPS, "Neutral"].map((k) => (
              <button key={k} onClick={() => setBu(k)} className={chip(bu === k)}>
                {k === "all" ? "All" : k}
              </button>
            ))}
            <span className="text-slate-300 mx-1">|</span>
            <span className="text-slate-500">Conviction:</span>
            {([[0, "Any"], [3, "3+"], [4, "4+"]] as const).map(([k, lab]) => (
              <button key={k} onClick={() => setConv(k)} className={chip(conv === k)}>
                {lab}
              </button>
            ))}
            <span className="text-slate-300 mx-1">|</span>
            <button onClick={() => setOnlyHeld((v) => !v)} className={chip(onlyHeld)} title="Only stocks you hold (from Portfolio Allocation)">In my PF</button>
            <button onClick={() => setOnlySetups((v) => !v)} className={chip(onlySetups)} title="Chartist_RS_Scanner full matches that are Breakout, Ready or In base">Chartist setups</button>
            <button onClick={() => setRs80((v) => !v)} className={chip(rs80)}>RS 3M ≥ 80</button>
            <button onClick={() => setStreak2((v) => !v)} className={chip(streak2)} title="The same build-up for 2 or more sessions in a row">2+ days</button>
            <button onClick={() => setShowIdx((v) => !v)} className={chip(showIdx)}>Indexes</button>
            <span className="text-slate-400 ml-1">{rows.length} shown</span>
          </div>
        </div>
      )}

      {ready && entry ? (
        <GenericTable rows={rows} cols={COLS} navigate={(t) => navigate(`/company/${t}`)} watchlist={watchlist} minWidth={2400} emptyMessage="No F&O rows match these chips." />
      ) : ready ? (
        <div className="text-sm text-slate-500">F&amp;O Flow has not run yet. Press Run now (it reads NSE&rsquo;s F&amp;O bhavcopy, about 30 seconds the first time).</div>
      ) : (
        <ScreenerLoading label="F&O Flow" />
      )}
    </div>
  );
}
