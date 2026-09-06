import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import RunButton from "../components/RunButton";
import { Col, fmtNum, GenericTable, MethodologyNote, PriceLink, Signed } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";

// Added 2026-09-06 — "a technical summary page, similar to our
// fundamental summary [Summary.tsx]... just a summary of technical
// returns and performance only". Reads a screener key
// (technicalSummary) computed server-side by
// api/momentum_screeners.py's _run_technical_summary — a sector-
// leaders-only digest of the Stocks vs Sector tab (one row per sector/
// theme, whichever stock has the highest alpha there), refreshed
// weekly rather than daily. A standalone page rather than a 16th
// Momentum Screeners tab — that page's tab strip was flagged as too
// cluttered the same day this was requested.
const COLS: Col[] = [
  { key: "rank", label: "Rank" },
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "name", label: "Name", align: "left" },
  { key: "sector", label: "Sector", align: "left" },
  { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
  { key: "r_1m", label: "1M %", render: (r) => <Signed v={r.r_1m} digits={1} /> },
  { key: "r_3m", label: "3M %", render: (r) => <Signed v={r.r_3m} digits={1} /> },
  { key: "r_6m", label: "6M %", render: (r) => <Signed v={r.r_6m} digits={1} /> },
  { key: "r_1y", label: "1Y %", render: (r) => <Signed v={r.r_1y} digits={1} /> },
  { key: "alpha_1w", label: "Alpha 1W %", render: (r) => <Signed v={r.alpha_1w} digits={1} /> },
  { key: "alpha_1m", label: "Alpha 1M %", render: (r) => <Signed v={r.alpha_1m} digits={1} /> },
  { key: "alpha_3m", label: "Alpha 3M %", render: (r) => <Signed v={r.alpha_3m} digits={1} /> },
  { key: "alpha_6m", label: "Alpha 6M %", render: (r) => <Signed v={r.alpha_6m} digits={1} /> },
  { key: "alpha_1y", label: "Alpha 1Y %", render: (r) => <Signed v={r.alpha_1y} digits={1} /> },
  { key: "alpha_score", label: "Alpha Score", render: (r) => <span className="font-semibold">{fmtNum(r.alpha_score, 1)}</span> },
];

export default function TechnicalSummary() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const entry = bundle.momentum_screeners["technicalSummary"];
  const rows = entry?.rows ?? [];

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">🏆 Technical Summary</h1>
        <span className="text-slate-500 text-sm">Sector leaders — NSE 750</span>
        <div className="ml-auto">
          <RunButton screener="technicalSummary" />
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        One stock per sector — whichever currently has the highest alpha vs. its own sector — refreshed weekly (Saturday), not daily.
        {entry?.as_of && <> As of {entry.as_of}.</>}
      </p>

      <MethodologyNote>
        The sector-leaders-only view of the <b>Stocks vs Sector</b> tab on Momentum Screeners (see that tab's own methodology note for the
        exact alpha calculation) — same numbers, same "Sector" definition (NSE's own industry classification, plus Defence/Manufacturing as
        cross-industry themes), just filtered down to <b>one row per sector</b>: whichever stock has the highest <b>Alpha Score</b> in that
        group right now. Everything shown is, by definition, currently the #1 performer in its own sector — there's no separate rank column
        within a sector because every row already is rank 1. The <b>Rank</b> column instead orders these sector leaders against each other, by
        Alpha Score. Unlike every other tab on this app, this doesn't refresh daily — it's a weekly snapshot (Saturday), since a sector's
        leader doesn't typically change day to day and a lighter cadence keeps this page a quick weekly check rather than another daily grind.
      </MethodologyNote>

      <GenericTable
        rows={rows}
        cols={COLS}
        navigate={(t) => navigate(`/company/${t}`)}
        watchlist={watchlist}
        emptyMessage="No Technical Summary data yet — click Run now above, or wait for Saturday's scheduled run."
      />
    </div>
  );
}
