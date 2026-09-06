import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import RunButton from "../components/RunButton";
import { Col, GenericTable, MethodologyNote, Signed, fmtNum } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";

// Added 2026-09-06 — "current holding in terms of percentages of
// holdings than actual numbers... weekly refresh based on my kite mcp
// input", then "make this tab more intuitive with holdings table,
// include the current out performing stocks from our technical
// summary page as column side by side + holding with sector overview
// in pie chart". Reads a screener key (portfolioAllocation) that only
// Claude can push — Kite holdings come from the mcp__kite__get_holdings
// MCP tool, callable only in an interactive session, never from an
// unattended Vercel cron (see RunButton.tsx's LOCAL_ONLY_SCREENERS).
// The "sector leader" columns are a client-side join against
// technicalSummary's own stored rows (bundle.momentum_screeners
// .technicalSummary) — done here, not baked into the pushed
// portfolioAllocation data, so it always reflects whatever's currently
// stored for both instead of going stale between the two screeners'
// independent refresh cadences.

// 8-slot categorical palette, dataviz skill's validated reference
// instance (adjacent-pairlist: worst CVD ΔE 9.1, worst normal-vision
// ΔE 19.6 — both clear the floors). Capped at 8 sectors + "Other" for
// the rest, matching the palette's own documented series cap.
const SECTOR_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const OTHER_COLOR = "#94a3a8"; // slate-400-ish — deliberately outside the categorical set, reads as "everything else"

interface SectorSlice {
  sector: string;
  pct: number;
  color: string;
}

function buildSectorSlices(rows: any[]): SectorSlice[] {
  const bySector = new Map<string, number>();
  for (const r of rows) {
    const sec = r.sector || "Unknown";
    bySector.set(sec, (bySector.get(sec) ?? 0) + (r.pct_of_portfolio ?? 0));
  }
  const sorted = Array.from(bySector.entries()).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, SECTOR_COLORS.length).map(([sector, pct], i) => ({ sector, pct, color: SECTOR_COLORS[i] }));
  const rest = sorted.slice(SECTOR_COLORS.length);
  if (rest.length) {
    const restPct = rest.reduce((s, [, pct]) => s + pct, 0);
    top.push({ sector: `Other (${rest.length})`, pct: restPct, color: OTHER_COLOR });
  }
  return top;
}

// Plain SVG donut — no charting library in this app's dependency tree,
// and one pie/donut for one page doesn't justify adding one. Segments
// as <path> arcs computed from cumulative percentages; hover swaps a
// centered label instead of a floating tooltip (simpler to keep inside
// the circle, no positioning math against page scroll).
function SectorDonut({ slices }: { slices: SectorSlice[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const size = 220;
  const r = 90;
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = 34;

  let cumulative = 0;
  const total = slices.reduce((s, sl) => s + sl.pct, 0) || 1;
  const arcs = slices.map((sl, i) => {
    const startAngle = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
    cumulative += sl.pct;
    const endAngle = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    return { ...sl, i, d: `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}` };
  });

  const active = hover !== null ? slices[hover] : null;

  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size} className="flex-shrink-0">
        {arcs.map((a) => (
          <path
            key={a.sector}
            d={a.d}
            fill="none"
            stroke={a.color}
            strokeWidth={hover === a.i ? strokeWidth + 6 : strokeWidth}
            onMouseEnter={() => setHover(a.i)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: "pointer", transition: "stroke-width 120ms" }}
          />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" className="fill-slate-700 text-sm font-semibold">
          {active ? `${fmtNum(active.pct, 1)}%` : "Sectors"}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="fill-slate-400 text-[10px]">
          {active ? active.sector : `${slices.length} sectors`}
        </text>
      </svg>
      {/* Legend — always present for ≥2 series per the dataviz skill's
          own accessibility rule, so sector identity never rides on
          color alone. */}
      <div className="flex flex-col gap-1 text-xs">
        {slices.map((sl, i) => (
          <div
            key={sl.sector}
            className={`flex items-center gap-2 px-1 py-0.5 rounded cursor-pointer ${hover === i ? "bg-slate-100" : ""}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: sl.color }} />
            <span className="text-slate-600">{sl.sector}</span>
            <span className="ml-auto font-semibold tabular-nums text-slate-700">{fmtNum(sl.pct, 1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PortfolioAllocation() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const entry = bundle.momentum_screeners["portfolioAllocation"];
  const rows = entry?.rows ?? [];
  const leaderRows = bundle.momentum_screeners["technicalSummary"]?.rows ?? [];
  // sectorStockAlpha carries the FULL NSE-750 (+ theme) list, every
  // stock's own alpha_score vs its sector — not just the leader
  // technicalSummary keeps. Joined by symbol (not sector) to read a
  // held stock's own alpha, so Outperformance below can be computed as
  // "how far behind the leader is this specific holding", not just
  // "who currently leads this sector".
  const myAlphaRows = bundle.momentum_screeners["sectorStockAlpha"]?.rows ?? [];

  const leaderBySector = useMemo(() => {
    const m = new Map<string, any>();
    for (const l of leaderRows) if (l.sector) m.set(l.sector, l);
    return m;
  }, [leaderRows]);

  const myAlphaBySymbol = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of myAlphaRows) if (r.symbol && r.alpha_score !== null && r.alpha_score !== undefined) m.set(r.symbol, r.alpha_score);
    return m;
  }, [myAlphaRows]);

  const sectorSlices = useMemo(() => buildSectorSlices(rows), [rows]);

  const COLS: Col[] = useMemo(
    () => [
      { key: "rank", label: "Rank" },
      { key: "symbol", label: "Symbol", align: "left" },
      { key: "name", label: "Name", align: "left" },
      { key: "sector", label: "Sector", align: "left" },
      {
        key: "pct_of_portfolio",
        label: "% of Portfolio",
        render: (r) => <span className="font-semibold tabular-nums">{fmtNum(r.pct_of_portfolio, 1)}%</span>,
      },
      { key: "pnl_pct", label: "P&L %", render: (r) => <Signed v={r.pnl_pct} digits={1} /> },
      {
        key: "sector_leader",
        label: "Sector Leader",
        render: (r) => {
          // Gold/Silver have no equity leader (no stock "leads" a
          // commodity) — the pushed row instead carries a 1Y COMEX
          // gold/silver return as context (see the PortfolioAllocation
          // skill's own reasoning for why it's shown here, not forced
          // into Outperformance, which needs a same-window comparison
          // this fund's unknown purchase date can't honestly give).
          if (r.commodity_benchmark_1y !== null && r.commodity_benchmark_1y !== undefined) {
            return (
              <span className="text-xs text-slate-500" title="1-year COMEX gold/silver futures return — a proxy for MCX, not literal MCX pricing">
                MCX-proxy 1Y <Signed v={r.commodity_benchmark_1y} digits={1} />
              </span>
            );
          }
          const leader = leaderBySector.get(r.sector);
          if (!leader) return <span className="text-slate-300">—</span>;
          const isLeader = leader.symbol === r.symbol;
          return (
            <span className="font-semibold text-slate-700">
              {leader.symbol}
              {isLeader && <span className="ml-1" title="You hold the current sector leader">🏆</span>}
            </span>
          );
        },
      },
      {
        key: "outperformance",
        label: "Outperformance",
        render: (r) => {
          const leader = leaderBySector.get(r.sector);
          const myAlpha = myAlphaBySymbol.get(r.symbol);
          if (!leader || myAlpha === undefined) return <span className="text-slate-300">—</span>;
          const gap = leader.alpha_score - myAlpha;
          return <Signed v={gap} digits={1} />;
        },
      },
    ],
    [leaderBySector, myAlphaBySymbol]
  );

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">💼 Portfolio Allocation</h1>
        <span className="text-slate-500 text-sm">Kite holdings, by % — not raw quantities/value</span>
        <div className="ml-auto">
          <RunButton screener="portfolioAllocation" />
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Refreshed on request only (Kite needs an interactive Claude session — see the button above).
        {entry?.as_of && <> As of {entry.as_of}.</>}
      </p>

      <MethodologyNote>
        <b>% of Portfolio</b> = each holding's current value (quantity × last price) ÷ total portfolio value — the whole point of this page
        is the allocation weight, not the underlying rupee amounts. <b>P&amp;L %</b> = unrealized gain/loss vs. Kite's own average buy price.{" "}
        <b>Sector Leader</b> is a live join against the <b>Technical Summary</b> page's own stored data (not recomputed here) — whichever
        stock currently has the highest alpha vs. its sector, for the same sector this holding is tagged with. A 🏆 means you already hold
        that sector's current leader. <b>Outperformance</b> = the leader's Alpha Score minus this specific holding's own Alpha Score — a
        second live join, this time against the <b>Stocks vs Sector</b> tab's full stored list (not just its own sector's leader, every
        scored NSE-750 stock), matched by symbol. Reads as "how far behind the leader is this exact holding, in alpha terms" — 0 (or blank,
        for the leader itself) means you're not leaving anything on the table in that sector; a large positive number means the leader is
        pulling well ahead of what you're holding. Shows "—" when either side of the join has nothing to match (a holding outside the
        NSE-750 universe Stocks vs Sector scores, most often — funds/ETFs, or a small-cap Stocks vs Sector doesn't cover). Sector here comes
        from Screener.in's own peer-comparison breadcrumb, same source and same "Sector" granularity both of those tabs use, so all three
        line up — except known sector-tracking ETFs (BANKBEES, PHARMABEES, METALIETF, MOREALTY, MODEFENCE, MOCAPITAL...), which Screener.in
        has no sector data for at all and are mapped directly to a real sector instead. <b>Gold/Silver</b> funds get their own "Gold"/"Silver"
        label and no equity Sector Leader (no stock leads a commodity) — instead, <b>Sector Leader</b> shows that commodity's own 1-year
        COMEX gold/silver return as a rough MCX proxy (not literal MCX pricing), and <b>Outperformance</b> stays "—" for these two on purpose:
        it needs both sides measured over the same window, and a fund's P&amp;L% is since its own unknown purchase date, not a clean 1-year
        figure. Pushed by the <b>PortfolioAllocation</b> skill — see its own methodology for exactly what's fetched and how.
      </MethodologyNote>

      {rows.length > 0 && (
        <div className="mb-6 p-4 border border-slate-200 rounded-lg">
          <h2 className="text-sm font-medium text-slate-700 mb-3">Sector Allocation</h2>
          <SectorDonut slices={sectorSlices} />
        </div>
      )}

      <GenericTable
        rows={rows}
        cols={COLS}
        navigate={(t) => navigate(`/company/${t}`)}
        watchlist={watchlist}
        emptyMessage="No holdings data yet — ask Claude to run the PortfolioAllocation skill."
      />
    </div>
  );
}
