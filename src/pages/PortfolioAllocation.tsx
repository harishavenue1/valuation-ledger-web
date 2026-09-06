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
  sector: string; // display label — "Other (6)" for the overflow slice, not a real sector name
  pct: number;
  color: string;
  sectors: string[]; // the REAL sector name(s) this slice represents — >1 only for the Other slice
}

// Why "Other" ends up as big as it does (2026-09-06, "why others 19%")
// — this app's categorical palette caps at 8 colors (validated
// adjacent-pair set, see the dataviz skill's own reference palette);
// a real portfolio easily spans more sectors than that (14, in the
// screenshot that prompted the question), so the smallest ones past
// the top 8 get folded into one slice rather than adding a 9th+ color
// past what the palette actually validates. Clicking it (like any
// slice, see onSelect below) filters the tables to exactly those
// folded-in sectors — the real answer to "why" is "click it and look",
// not a number this component can explain on its own.
function buildSectorSlices(rows: any[]): SectorSlice[] {
  const bySector = new Map<string, number>();
  for (const r of rows) {
    const sec = r.sector || "Unknown";
    bySector.set(sec, (bySector.get(sec) ?? 0) + (r.pct_of_portfolio ?? 0));
  }
  const sorted = Array.from(bySector.entries()).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, SECTOR_COLORS.length).map(([sector, pct], i) => ({ sector, pct, color: SECTOR_COLORS[i], sectors: [sector] }));
  const rest = sorted.slice(SECTOR_COLORS.length);
  if (rest.length) {
    const restPct = rest.reduce((s, [, pct]) => s + pct, 0);
    top.push({ sector: `Other (${rest.length})`, pct: restPct, color: OTHER_COLOR, sectors: rest.map(([sec]) => sec) });
  }
  return top;
}

// Plain SVG donut — no charting library in this app's dependency tree,
// and one pie/donut for one page doesn't justify adding one. Segments
// as <path> arcs computed from cumulative percentages; hover swaps a
// centered label instead of a floating tooltip (simpler to keep inside
// the circle, no positioning math against page scroll). Click-to-filter
// added 2026-09-06 ("on clicking sector on pie chart or the list...
// only show those records from table") — clicking a slice or its
// legend row selects it (click again, or the center label, to clear);
// `selected` is controlled by the parent so both tables below filter
// off the same click.
function SectorDonut({ slices, selected, onSelect }: { slices: SectorSlice[]; selected: string | null; onSelect: (sector: string | null) => void }) {
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

  const selectedSlice = selected !== null ? slices.find((sl) => sl.sector === selected) ?? null : null;
  const active = (hover !== null ? slices[hover] : null) ?? selectedSlice;

  function toggle(sector: string) {
    onSelect(selected === sector ? null : sector);
  }

  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size} className="flex-shrink-0">
        {arcs.map((a) => {
          const isSelected = selected === a.sector;
          const dimmed = selected !== null && !isSelected;
          return (
            <path
              key={a.sector}
              d={a.d}
              fill="none"
              stroke={a.color}
              strokeWidth={hover === a.i || isSelected ? strokeWidth + 6 : strokeWidth}
              opacity={dimmed ? 0.35 : 1}
              onMouseEnter={() => setHover(a.i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => toggle(a.sector)}
              style={{ cursor: "pointer", transition: "stroke-width 120ms, opacity 120ms" }}
            />
          );
        })}
        <g onClick={() => onSelect(null)} style={{ cursor: selected ? "pointer" : "default" }}>
          <text x={cx} y={cy - 6} textAnchor="middle" className="fill-slate-700 text-sm font-semibold">
            {active ? `${fmtNum(active.pct, 1)}%` : "Sectors"}
          </text>
          <text x={cx} y={cy + 12} textAnchor="middle" className="fill-slate-400 text-[10px]">
            {active ? active.sector : `${slices.length} sectors`}
          </text>
          {selected && (
            <text x={cx} y={cy + 26} textAnchor="middle" className="fill-indigo-500 text-[9px] underline">
              clear
            </text>
          )}
        </g>
      </svg>
      {/* Legend — always present for ≥2 series per the dataviz skill's
          own accessibility rule, so sector identity never rides on
          color alone. */}
      <div className="flex flex-col gap-1 text-xs">
        {slices.map((sl, i) => {
          const isSelected = selected === sl.sector;
          return (
            <div
              key={sl.sector}
              className={`flex items-center gap-2 px-1 py-0.5 rounded cursor-pointer ${isSelected ? "bg-indigo-50 ring-1 ring-indigo-200" : hover === i ? "bg-slate-100" : ""}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => toggle(sl.sector)}
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: sl.color }} />
              <span className={isSelected ? "text-indigo-700 font-medium" : "text-slate-600"}>{sl.sector}</span>
              <span className="ml-auto font-semibold tabular-nums text-slate-700">{fmtNum(sl.pct, 1)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Added 2026-09-06 — "add a table summary showing allocation to ETF &
// Stocks, Profit % from each segment, how much profit / 100 from which
// segment". Three different numbers per segment, deliberately not
// conflated into one:
//   - Allocation % — simple sum of pct_of_portfolio within the segment.
//   - Segment P&L % — the WEIGHTED average P&L% within that segment
//     only (weighted by each holding's own pct_of_portfolio, i.e. by
//     position size, not a naive average of the P&L% numbers — a 0.9%
//     holding up 40% shouldn't count the same as an 11.6% holding down
//     0.2%). Reads as "how is the Stocks sleeve doing on its own", not
//     relative to the whole portfolio.
//   - Contribution (pp) — Segment P&L weighted down again by the
//     segment's OWN share of the total portfolio (pct_of_portfolio_i ×
//     pnl_pct_i ÷ 100, summed): the literal "per ₹100 of portfolio, how
//     much of that is stocks vs ETFs' actual gain/loss" figure — the
//     two segments' contributions sum to the whole portfolio's own
//     weighted P&L%, which Allocation %/Segment P&L% alone don't show
//     (a segment can have a great P&L% and still contribute little if
//     it's a small slice, or vice versa).
interface SegmentStat {
  label: string;
  allocationPct: number;
  weightedPnlPct: number | null;
  contributionPct: number | null;
}

function statsForSegment(segRows: any[], label: string): SegmentStat {
  const allocationPct = segRows.reduce((s, r) => s + (r.pct_of_portfolio ?? 0), 0);
  const withPnl = segRows.filter((r) => r.pnl_pct !== null && r.pnl_pct !== undefined);
  const weightSum = withPnl.reduce((s, r) => s + (r.pct_of_portfolio ?? 0), 0);
  const weightedPnlPct = weightSum > 0 ? withPnl.reduce((s, r) => s + r.pct_of_portfolio * r.pnl_pct, 0) / weightSum : null;
  const contributionPct = withPnl.length > 0 ? withPnl.reduce((s, r) => s + (r.pct_of_portfolio * r.pnl_pct) / 100, 0) : null;
  return { label, allocationPct, weightedPnlPct, contributionPct };
}

function SegmentSummary({ rows }: { rows: any[] }) {
  const stocks = statsForSegment(
    rows.filter((r) => !r.is_fund),
    "📈 Stocks"
  );
  const funds = statsForSegment(
    rows.filter((r) => r.is_fund),
    "🧺 Funds & ETFs"
  );
  const total: SegmentStat = {
    label: "Total Portfolio",
    allocationPct: stocks.allocationPct + funds.allocationPct,
    weightedPnlPct: (stocks.contributionPct ?? 0) + (funds.contributionPct ?? 0),
    contributionPct: null, // not meaningful for the total row itself — it IS the sum of the two segments' contributions, shown as weightedPnlPct instead
  };

  return (
    <div className="mb-6 p-4 border border-slate-200 rounded-lg overflow-x-auto">
      <h2 className="text-sm font-medium text-slate-700 mb-3">Segment Summary</h2>
      <table className="text-sm border-collapse" style={{ minWidth: 480 }}>
        <thead className="text-slate-500 text-xs">
          <tr>
            <th className="text-left px-2 py-1.5">Segment</th>
            <th className="text-right px-2 py-1.5">Allocation %</th>
            <th className="text-right px-2 py-1.5">Segment P&amp;L %</th>
            <th className="text-right px-2 py-1.5" title="Per ₹100 of the whole portfolio, how much of that is this segment's own gain/loss">
              Contribution (pp)
            </th>
          </tr>
        </thead>
        <tbody>
          {[stocks, funds].map((s) => (
            <tr key={s.label} className="border-t border-slate-100">
              <td className="px-2 py-1.5 font-medium text-slate-700">{s.label}</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmtNum(s.allocationPct, 1)}%</td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                <Signed v={s.weightedPnlPct} digits={1} />
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                <Signed v={s.contributionPct} digits={2} />
              </td>
            </tr>
          ))}
          <tr className="border-t border-slate-300 font-semibold">
            <td className="px-2 py-1.5 text-slate-800">{total.label}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(total.allocationPct, 1)}%</td>
            <td className="px-2 py-1.5 text-right tabular-nums">
              <Signed v={total.weightedPnlPct} digits={1} />
            </td>
            <td className="px-2 py-1.5 text-right text-slate-300">—</td>
          </tr>
        </tbody>
      </table>
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

  // Selecting a donut slice/legend row filters both tables below to
  // just that slice's real sector(s) — `selectedSector` holds the
  // slice's DISPLAY label ("Other (6)" included), resolved back to the
  // real sector name(s) it represents via sectorSlices itself (the
  // Other slice maps to several real sectors, every other slice to
  // exactly one).
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const selectedRealSectors = useMemo(() => {
    if (selectedSector === null) return null;
    return sectorSlices.find((sl) => sl.sector === selectedSector)?.sectors ?? null;
  }, [selectedSector, sectorSlices]);

  // Re-ranked 1..N per section — rows arrive already sorted by
  // % of portfolio (the push's own order), so re-numbering in place is
  // enough; no re-sort needed.
  const stockRows = useMemo(() => {
    const filtered = selectedRealSectors ? rows.filter((r) => !r.is_fund && selectedRealSectors.includes(r.sector || "Unknown")) : rows.filter((r) => !r.is_fund);
    return filtered.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [rows, selectedRealSectors]);
  const fundRows = useMemo(() => {
    const filtered = selectedRealSectors ? rows.filter((r) => r.is_fund && selectedRealSectors.includes(r.sector || "Unknown")) : rows.filter((r) => r.is_fund);
    return filtered.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [rows, selectedRealSectors]);

  const COLS: Col[] = useMemo(
    () => [
      { key: "rank", label: "Rank", width: 6 },
      { key: "symbol", label: "Symbol", align: "left", width: 13 },
      { key: "name", label: "Name", align: "left", width: 13 },
      { key: "sector", label: "Sector", align: "left", width: 21 },
      {
        key: "pct_of_portfolio",
        label: "% of Portfolio",
        width: 13,
        render: (r) => <span className="font-semibold tabular-nums">{fmtNum(r.pct_of_portfolio, 1)}%</span>,
      },
      { key: "pnl_pct", label: "P&L %", width: 9, render: (r) => <Signed v={r.pnl_pct} digits={1} /> },
      {
        key: "sector_leader",
        label: "Sector Leader",
        width: 13,
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
        width: 12,
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

      {rows.length > 0 && <SegmentSummary rows={rows} />}

      {rows.length > 0 && (
        <div className="mb-6 p-4 border border-slate-200 rounded-lg">
          <h2 className="text-sm font-medium text-slate-700 mb-3">Sector Allocation</h2>
          <SectorDonut slices={sectorSlices} selected={selectedSector} onSelect={setSelectedSector} />
        </div>
      )}

      {/* Split into Stocks / Funds & ETFs 2026-09-06 ("also split the
          segment to stocks vs ETFs") — is_fund comes pre-computed from
          the push (same fund-detection signal HoldingsTracker's own
          fetch_holdings_metrics.py validated: no parseable sector/P&L
          fundamentals on Screener.in), not re-derived here. Rank is
          recomputed per section (1..N within Stocks, 1..N within
          Funds & ETFs) rather than keeping the whole-portfolio rank
          from the push, which would otherwise show gaps like 1, 3, 7
          in a filtered table. */}
      {selectedSector && (
        <div className="flex items-center gap-2 mb-3 text-xs">
          <span className="text-slate-500">Filtered to:</span>
          <span className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 px-2 py-1 rounded-full font-medium">
            {selectedSector}
            <button onClick={() => setSelectedSector(null)} className="hover:text-indigo-900" title="Clear filter">
              ✕
            </button>
          </span>
        </div>
      )}
      <h2 className="text-sm font-medium text-slate-700 mb-2">📈 Stocks ({stockRows.length})</h2>
      <div className="mb-6">
        <GenericTable
          rows={stockRows}
          cols={COLS}
          navigate={(t) => navigate(`/company/${t}`)}
          watchlist={watchlist}
          emptyMessage="No individual stock holdings."
        />
      </div>

      <h2 className="text-sm font-medium text-slate-700 mb-2">🧺 Funds &amp; ETFs ({fundRows.length})</h2>
      <GenericTable
        rows={fundRows}
        cols={COLS}
        navigate={(t) => navigate(`/company/${t}`)}
        watchlist={watchlist}
        emptyMessage="No fund/ETF holdings."
      />
    </div>
  );
}
