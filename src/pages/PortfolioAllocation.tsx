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
//
// 2026-09-11: originally had a "Sector Leader"/"Outperformance" pair of
// columns here (a live join against technicalSummary/sectorStockAlpha —
// briefly also fixed the same day for comparing a held sector leader
// against a stale copy of itself). Replaced outright per "instead of
// leader and outperf, can we add company's latest qtr sales growth and
// eps growth" — those two columns are now pushed directly by the
// PortfolioAllocation skill (qtr_sales_growth_pct/qtr_eps_growth_pct,
// read off Screener.in's own Quarterly Results table), not computed
// here, so this page no longer joins against either of those other
// screeners at all.

// 8-slot categorical palette, dataviz skill's validated reference
// instance (adjacent-pairlist: worst CVD ΔE 9.1, worst normal-vision
// ΔE 19.6 — both clear the floors). Used for the biggest 8 sectors;
// see extraColor() below for what a 9th+ sector gets.
const SECTOR_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

interface SectorSlice {
  sector: string; // the real sector name — every slice is a real sector, there is no "Other" bucket
  pct: number;
  color: string;
  sectors: string[]; // kept as an array (always length 1) so the click-to-filter code below stays generic
}

// 2026-09-06 — "display all the allocation dont combine like others":
// a real portfolio easily spans more sectors than the validated
// 8-color palette (14, in the screenshot that first prompted the
// "why is Other 19%" question), and folding the smaller ones into one
// gray slice was hiding exactly the breakdown this chart exists to
// show. Every sector now gets its own slice and its own color — for
// the 9th sector onward, generated with the golden-angle hue step
// (137.508°), which is the standard way to keep an open-ended series
// of colors visually spread apart without picking each one by hand.
// These extra hues aren't run through the dataviz skill's CVD
// validator (that check is for a fixed, shippable palette; this is an
// unbounded, portfolio-dependent tail) — the legend text/swatch pairing
// still carries identity even where two extra hues land close together.
function extraColor(i: number): string {
  const hue = (i * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 60%, 48%)`;
}

function buildSectorSlices(rows: any[]): SectorSlice[] {
  const bySector = new Map<string, number>();
  for (const r of rows) {
    const sec = r.sector || "Unknown";
    bySector.set(sec, (bySector.get(sec) ?? 0) + (r.pct_of_portfolio ?? 0));
  }
  const sorted = Array.from(bySector.entries()).sort((a, b) => b[1] - a[1]);
  return sorted.map(([sector, pct], i) => ({
    sector,
    pct,
    color: i < SECTOR_COLORS.length ? SECTOR_COLORS[i] : extraColor(i - SECTOR_COLORS.length),
    sectors: [sector],
  }));
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
          color alone. Two columns (2026-09-06, "enough space on right
          side... utilize to show side by side, instead of increasing
          row height") — with every sector now shown individually
          (no "Other" fold, see buildSectorSlices above) a single
          column ran long enough to blow out the card's height well
          past the donut's own, wasting the width beside it instead. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs flex-1 min-w-0">
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
    <div className="p-4 border border-slate-200 rounded-lg overflow-x-auto">
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
        // 2026-09-11 ("instead of leader and outperf, can we add
        // company's latest qtr sales growth and eps growth") — replaces
        // the old Sector Leader column. Gold/Silver still show their
        // MCX-proxy 1Y context here (no stock "leads" a commodity, and
        // they have no quarterly results either) rather than leaving
        // this cell blank for them.
        key: "qtr_sales_growth_pct",
        label: "Qtr Sales Growth %",
        width: 13,
        render: (r) => {
          if (r.commodity_benchmark_1y !== null && r.commodity_benchmark_1y !== undefined) {
            return (
              <span
                className="text-xs text-slate-500"
                title="1-year COMEX gold/silver futures return (USD), converted to its INR-equivalent using USDINR's own 1Y move — MCX itself has no fetchable price history, this is the closest honest proxy"
              >
                MCX-proxy 1Y <Signed v={r.commodity_benchmark_1y} digits={1} />
              </span>
            );
          }
          if (r.qtr_sales_growth_pct === null || r.qtr_sales_growth_pct === undefined) return <span className="text-slate-300">—</span>;
          return <Signed v={r.qtr_sales_growth_pct} digits={1} />;
        },
      },
      {
        // Same source/request as Qtr Sales Growth % above (one
        // Screener.in fetch per holding, see the PortfolioAllocation
        // skill). "T" means the year-ago quarter was a loss — no % is
        // honest against a negative base, same convention
        // momentumPersonal already uses for this.
        key: "qtr_eps_growth_pct",
        label: "Qtr EPS Growth %",
        width: 12,
        render: (r) => {
          if (r.qtr_eps_growth_pct === null || r.qtr_eps_growth_pct === undefined) return <span className="text-slate-300">—</span>;
          if (r.qtr_eps_growth_pct === "T")
            return (
              <span className="text-xs font-medium text-emerald-700" title="Year-ago quarter was a loss — turned profitable">
                Turned profitable
              </span>
            );
          return <Signed v={r.qtr_eps_growth_pct} digits={1} />;
        },
      },
    ],
    []
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
        <b>Qtr Sales Growth %</b>/<b>Qtr EPS Growth %</b> are the latest reported quarter's YoY growth, read straight off Screener.in's
        Quarterly Results table (same technique momentumPersonal already uses) — pushed by the PortfolioAllocation skill itself, not a live
        join against another tab. "Turned profitable" means the year-ago quarter was a loss, so no percentage would be honest against a
        negative base. Shows "—" for a fund/ETF/commodity (no quarterly results to speak of) or a stock Screener.in has no numbers for yet
        (e.g. a very recent IPO). Sector comes from the same Screener.in peer-comparison breadcrumb Technical Summary/Stocks vs Sector use,
        so it lines up with what those tabs mean by the same word — except known sector-tracking ETFs (BANKBEES, PHARMABEES, METALIETF,
        MOREALTY, MODEFENCE, MOCAPITAL...), which Screener.in has no sector data for at all and are mapped directly to a real sector instead.{" "}
        <b>Gold/Silver/Liquid</b> funds get their own pseudo-sector label the same way — for Gold/Silver, the <b>Qtr Sales Growth %</b>{" "}
        column instead shows that commodity's own 1-year COMEX return, converted to its INR-equivalent using USDINR's own 1-year move (MCX
        itself has no fetchable price history — this is the closest honest proxy, not literal MCX pricing). Pushed by the{" "}
        <b>PortfolioAllocation</b> skill — see its own methodology for exactly what's fetched and how.
      </MethodologyNote>

      {/* Side by side 2026-09-06 ("enough space wasted in summary and
          allocations, lets combine") — both are compact (a small table,
          a donut+legend) and were each taking a full-width row on
          their own; a 2-column grid on wide screens uses the same
          horizontal space the Stocks/Funds tables below already fill,
          stacking back to one column on narrow viewports. */}
      {rows.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <SegmentSummary rows={rows} />
          <div className="p-4 border border-slate-200 rounded-lg">
            <h2 className="text-sm font-medium text-slate-700 mb-3">Sector Allocation</h2>
            <SectorDonut slices={sectorSlices} selected={selectedSector} onSelect={setSelectedSector} />
          </div>
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
