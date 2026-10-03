import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useData, useScreeners } from "../App";
import { api, ApiError, ChartResponse } from "../lib/api";
import CandlestickChart, { DEFAULT_LINE_VISIBILITY, LineVisibility } from "../components/CandlestickChart";
import { MethodologyNote, Signed, fmtNum } from "../components/ScreenerTable";
import { ChartSource, loadChartList, loadChartSource, saveChartSource } from "../lib/chartList";

// 2026-09-27 ("give controls to modify the lines, as I did on trading
// view") — persisted the same way AllTechnicals' own column picker is
// (localStorage, loaded once at mount) so a toggle sticks across
// visits instead of resetting to the Pine script's own defaults every
// time.
const LINES_STORAGE_KEY = "portfolioChartsLines";
const LINE_TOGGLES: { key: keyof LineVisibility; label: string }[] = [
  { key: "logScale", label: "Log Scale (price axis)" },
  { key: "ema1", label: "EMA1 (12W)" },
  { key: "ema2", label: "EMA2 (21W)" },
  { key: "slowEma", label: "Slow EMA (33W)" },
  { key: "qbUpper", label: "QB Upper Band" },
  { key: "qbTrail", label: "QB Trail (34W)" },
  { key: "smLines", label: "SmartMoney Lines (EMA10/EMA20/Trend)" },
  { key: "smChannel", label: "SmartMoney Channel" },
  { key: "volume", label: "Volume" },
];

function loadLineVisibility(): LineVisibility {
  try {
    const raw = localStorage.getItem(LINES_STORAGE_KEY);
    if (raw) return { ...DEFAULT_LINE_VISIBILITY, ...JSON.parse(raw) };
  } catch {
    // localStorage unavailable/corrupt — fall through to default
  }
  return DEFAULT_LINE_VISIBILITY;
}

// 2026-09-27 ("lets have dedicated page for charts with all my
// holdings on the list, with just a up and down the stocks chart
// should load the company chart and default to our indicator and
// weekly timeframe, also make chart full screen") — replaces the
// plain single-stock /chart/:symbol page (folded in here, that route
// is gone) with a proper workspace: every holding in a side list,
// ArrowUp/ArrowDown to move through them, the chart itself using the
// page's full width instead of a narrow centered column. Weekly
// timeframe + this account's own 3 signal systems (quantBollinger/
// myLongTermInvestingStrategy/SmartMoney) is the ONLY mode this chart
// has — see CandlestickChart.tsx and api/momentum_screeners.py's
// chartData module comment — so "default to" is automatic, not a
// toggle.
const RANGES: { key: "6mo" | "1y" | "2y" | "5y"; label: string }[] = [
  { key: "6mo", label: "6M" },
  { key: "1y", label: "1Y" },
  { key: "2y", label: "2Y" },
  { key: "5y", label: "5Y" },
];

export default function PortfolioCharts() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const { symbol = "" } = useParams();
  const { ready: holdingsReady } = useScreeners(["portfolioAllocation"]);

  // One shape for both lists: the portfolio (metric = allocation %) and the
  // list saved from All Technicals (metric = 3M %).
  interface Holding {
    symbol: string;
    metric: number | null;
    day_change_pct: number | null;
    pct_from_ath: number | null;
    pct_from_52w_high: number | null;
  }

  const [source, setSourceState] = useState<ChartSource>(() => loadChartSource());
  const techList = useMemo(() => loadChartList(), []);
  function setSource(s: ChartSource) {
    setSourceState(s);
    saveChartSource(s);
  }

  const pfHoldings = useMemo(() => {
    const rows = bundle.momentum_screeners.portfolioAllocation?.rows ?? [];
    const seen = new Set<string>();
    // 2026-09-27 ("add a column for ATH% and 52WH% from the pf page
    // which is already calculated" / "add a col for recent day
    // change%") — portfolioAllocation's own rows already carry
    // pct_from_ath/pct_from_52w_high/day_change_pct (same fields
    // PortfolioAllocation.tsx's own table shows) — no new fetch,
    // reused straight off the same screener this page already loads.
    const out: Holding[] = [];
    for (const r of rows) {
      if (!r.symbol || seen.has(r.symbol)) continue;
      seen.add(r.symbol);
      out.push({
        symbol: r.symbol,
        metric: r.pct_of_portfolio ?? 0,
        day_change_pct: r.day_change_pct ?? null,
        pct_from_ath: r.pct_from_ath ?? null,
        pct_from_52w_high: r.pct_from_52w_high ?? null,
      });
    }
    out.sort((a, b) => (b.metric ?? 0) - (a.metric ?? 0));
    return out;
  }, [bundle.momentum_screeners.portfolioAllocation]);

  const techHoldings = useMemo<Holding[]>(
    () =>
      (techList?.items ?? []).map((i) => ({
        symbol: i.symbol,
        metric: i.metric,
        day_change_pct: i.day,
        pct_from_ath: i.ath,
        pct_from_52w_high: i.wh52,
      })),
    [techList],
  );

  const useTech = source === "technicals" && techHoldings.length > 0;
  const holdings = useTech ? techHoldings : pfHoldings;

  // 2026-09-28 ("add sort option on columns") — click a header to sort
  // by it, click again to flip direction; nulls always sort last
  // regardless of direction (same convention GenericTable's own
  // compareVals uses elsewhere in this app). Arrow-key browsing
  // follows whatever order is currently ON SCREEN, not always the
  // underlying allocation-weight order — see sortedHoldings below,
  // used for both the list and the up/down navigation.
  type SortKey = "symbol" | "metric" | "day_change_pct" | "pct_from_ath" | "pct_from_52w_high";
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // switching list resets to that list's own natural order
  useEffect(() => {
    setSortKey(null);
  }, [useTech]);

  function clickSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "symbol" ? "asc" : "desc");
    }
  }

  const sortedHoldings = useMemo(() => {
    const copy = [...holdings];
    if (!sortKey) return copy; // portfolio: allocation order (pre-sorted); technicals: the table's own order
    copy.sort((a, b) => {
      let cmp: number;
      if (sortKey === "symbol") {
        cmp = a.symbol.localeCompare(b.symbol);
      } else {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (av == null && bv == null) cmp = 0;
        else if (av == null) cmp = 1; // nulls last regardless of direction
        else if (bv == null) cmp = -1;
        else cmp = av - bv;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return copy;
  }, [holdings, sortKey, sortDir]);

  const currentIndex = sortedHoldings.findIndex((h) => h.symbol === symbol);

  // No symbol in the URL yet (first visit to /portfolio-charts), or an
  // unrecognized one — land on the top holding by allocation weight.
  // `replace: true` so this doesn't spam browser history.
  useEffect(() => {
    if (sortedHoldings.length === 0 || currentIndex !== -1) return;
    if (!useTech && !holdingsReady) return;
    // arrived with a symbol that is in the OTHER list (e.g. a link from the
    // Portfolio page while the technicals list is active) — switch lists
    // instead of bouncing to the top of this one
    if (symbol && useTech && pfHoldings.some((h) => h.symbol === symbol)) {
      setSource("portfolio");
      return;
    }
    if (symbol && !useTech && source === "portfolio" && techHoldings.some((h) => h.symbol === symbol) && !pfHoldings.some((h) => h.symbol === symbol)) {
      setSource("technicals");
      return;
    }
    navigate(`/portfolio-charts/${encodeURIComponent(sortedHoldings[0].symbol)}`, { replace: true });
  }, [holdingsReady, sortedHoldings, currentIndex, navigate, useTech, symbol, pfHoldings, techHoldings, source]);

  // ArrowUp/ArrowDown move to the previous/next holding IN THE CURRENT
  // ON-SCREEN ORDER (sortedHoldings, not the raw allocation order) —
  // clamped, not wrapping, at the list's ends. Ignored while typing in
  // an input (the range buttons and sidebar are plain buttons/links,
  // not inputs, but this guard is a cheap, standard precaution).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (sortedHoldings.length === 0 || currentIndex === -1) return;
      if (e.key === "ArrowUp" && currentIndex > 0) {
        e.preventDefault();
        navigate(`/portfolio-charts/${encodeURIComponent(sortedHoldings[currentIndex - 1].symbol)}`);
      } else if (e.key === "ArrowDown" && currentIndex < sortedHoldings.length - 1) {
        e.preventDefault();
        navigate(`/portfolio-charts/${encodeURIComponent(sortedHoldings[currentIndex + 1].symbol)}`);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sortedHoldings, currentIndex, navigate]);

  const [range, setRange] = useState<"6mo" | "1y" | "2y" | "5y">("2y");
  const [data, setData] = useState<ChartResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lineVisibility, setLineVisibility] = useState<LineVisibility>(() => loadLineVisibility());
  const [linesOpen, setLinesOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(LINES_STORAGE_KEY, JSON.stringify(lineVisibility));
    } catch {
      // best-effort persistence only
    }
  }, [lineVisibility]);

  function toggleLine(key: keyof LineVisibility) {
    setLineVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .getChartData(symbol, range)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, range]);

  const bars = data?.bars ?? [];
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const weekChangePct = last && prev ? ((last.close - prev.close) / prev.close) * 100 : null;

  if (!useTech && !holdingsReady) return <div className="text-sm text-slate-400 text-center py-16">Loading holdings…</div>;
  if (holdings.length === 0) {
    return (
      <div className="text-sm text-slate-500 text-center py-16 border border-slate-200 rounded-lg">
        No portfolio holdings yet — run the PortfolioAllocation skill first.
      </div>
    );
  }

  return (
    <div className="flex gap-4" style={{ height: "calc(100vh - 130px)" }}>
      <div className="w-80 shrink-0 overflow-y-auto border border-slate-200 rounded-lg">
        <div className="sticky top-0 bg-slate-50 text-[10px] text-slate-400 border-b border-slate-200">
          <div className="flex gap-1 px-2 pt-2 pb-1">
            {(
              [
                ["portfolio", "My Portfolio"],
                ["technicals", "All Technicals"],
              ] as [ChartSource, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setSource(k)}
                className={`flex-1 text-xs py-1 rounded border ${
                  (k === "technicals") === useTech ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {source === "technicals" && !techList && (
            <div className="px-2 py-1 text-slate-500">
              Nothing saved yet — set your filters on <Link to="/all-technicals" className="text-indigo-600 underline">All Technicals</Link> and press “Open in Charts”.
            </div>
          )}
          <div className="px-2 py-1">
            {useTech ? (
              <>
                {holdings.length} stocks · {techList?.label} · <Link to="/all-technicals" className="text-indigo-600 underline">edit filters</Link> · ↑↓ to browse
              </>
            ) : (
              <>{holdings.length} holdings · ↑↓ to browse</>
            )}
          </div>
          <div className="grid grid-cols-[1fr_38px_38px_38px_42px] gap-1 px-2 pb-1 font-medium">
            {(
              [
                ["symbol", "Symbol"],
                ["metric", useTech ? "3M%" : "Alloc"],
                ["day_change_pct", "Day%"],
                ["pct_from_ath", "ATH%"],
                ["pct_from_52w_high", "52WH%"],
              ] as [SortKey, string][]
            ).map(([key, label]) => (
              <button key={key} onClick={() => clickSort(key)} className={`text-right first:text-left hover:text-slate-700 ${sortKey === key ? "text-slate-700 font-semibold" : ""}`}>
                {label} {sortKey === key ? (sortDir === "desc" ? "▼" : "▲") : ""}
              </button>
            ))}
          </div>
        </div>
        {sortedHoldings.map((h) => (
          <button
            key={h.symbol}
            onClick={() => navigate(`/portfolio-charts/${encodeURIComponent(h.symbol)}`)}
            className={`w-full grid grid-cols-[1fr_38px_38px_38px_42px] gap-1 items-center px-2 py-1.5 text-xs text-left border-b border-slate-100 ${
              h.symbol === symbol ? "bg-indigo-50 text-indigo-700 font-semibold" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span className="truncate">{h.symbol}</span>
            <span className="tabular-nums text-slate-400 text-right shrink-0">{useTech ? <Signed v={h.metric} digits={0} /> : <>{fmtNum(h.metric, 1)}%</>}</span>
            <span className="text-right">
              <Signed v={h.day_change_pct} digits={1} />
            </span>
            <span className="text-right">
              <Signed v={h.pct_from_ath} digits={0} />
            </span>
            <span className="text-right">
              <Signed v={h.pct_from_52w_high} digits={0} />
            </span>
          </button>
        ))}
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-3 mb-1 shrink-0">
          <h1 className="text-xl font-semibold">📈 {symbol}</h1>
          {last && (
            <>
              <span className="text-lg font-semibold tabular-nums">₹{fmtNum(last.close, 2)}</span>
              <Signed v={weekChangePct} digits={2} />
              <span className="text-[10px] text-slate-400">this week</span>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setLinesOpen((v) => !v)}
                className="text-xs px-2.5 py-1 rounded border border-slate-300 text-slate-600 hover:border-slate-400"
              >
                ⚙️ Chart Settings {linesOpen ? "▲" : "▼"}
              </button>
              {linesOpen && (
                <div className="absolute right-0 top-full mt-1 z-20 w-64 p-2 border border-slate-200 rounded-lg bg-white shadow-lg">
                  {LINE_TOGGLES.map((t) => (
                    <label key={t.key} className="flex items-center gap-2 text-xs py-1 px-1 cursor-pointer hover:bg-slate-50 rounded">
                      <input type="checkbox" checked={lineVisibility[t.key]} onChange={() => toggleLine(t.key)} />
                      {t.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-1">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  className={`text-xs px-2.5 py-1 rounded border ${
                    range === r.key ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {last && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mb-2 shrink-0">
            <span>
              <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "#d4aa00" }} />
              EMA1 (12W) {fmtNum(last.ema1, 2)}
            </span>
            <span>
              <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "#94a3b8" }} />
              EMA2 (21W) {fmtNum(last.ema2, 2)}
            </span>
            <span>
              <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "#47b027" }} />
              Slow EMA (33W) {fmtNum(last.slow_ema, 2)}
            </span>
            <span>
              <span className="inline-block w-2 h-2 rounded-full bg-sky-500 mr-1" />
              QB Upper {fmtNum(last.qb_upper, 2)}
            </span>
            <span>
              <span className="inline-block w-2 h-2 rounded-full bg-orange-500 mr-1" />
              QB Trail (34W) {fmtNum(last.qb_trail, 2)}
            </span>
            <span>
              <span className="inline-block w-2 h-2 rounded-full bg-violet-600 mr-1" />
              RSI14 {fmtNum(last.rsi14, 1)}
            </span>
            <span className="ml-auto text-slate-400">week ending {last.date}</span>
          </div>
        )}

        {loading && <div className="text-sm text-slate-400 text-center py-16 shrink-0">Loading {symbol}…</div>}
        {!loading && error && <div className="text-sm text-red-600 text-center py-16 border border-red-200 rounded-lg bg-red-50 shrink-0">{error}</div>}
        {!loading && !error && bars.length === 0 && <div className="text-sm text-slate-500 text-center py-16 border border-slate-200 rounded-lg shrink-0">No chart data for {symbol}.</div>}
        {!loading && !error && bars.length > 0 && (
          <div className="flex-1 min-h-0 border border-slate-200 rounded-lg p-3">
            <CandlestickChart bars={bars} lines={lineVisibility} />
          </div>
        )}

        {/* 2026-09-27 ("expand the chart to full screen to utilize free
            space") — collapsed into the same MethodologyNote pattern
            every other screener page uses, instead of an always-visible
            paragraph competing with the chart for vertical space. */}
        <div className="shrink-0 mt-2">
          <MethodologyNote>
            Weekly bars, ported line-for-line from this account's own "EMAs+Buy+Sell+SmartMoney" Pine Script — 3 systems, not generic
            indicators. <b>EMA1/EMA2/Slow EMA</b> (12W/21W/33W on OHLC4) are myLongTermInvestingStrategy's own ribbon — 🔽 aqua "RSI&gt;66"
            marker when close is above all three AND weekly RSI &gt; 66 (fresh cross only), ✕ orange when close crosses below the slow EMA.
            {" "}
            <b>QB Upper/QB Trail</b> are quantBollinger's 55W-SMA+3.7σ band and 34W EMA trail — 🔼 lime "QB" marker on a weekly close breaking
            above the band, 🔽 red "QB" on a weekly close breaking below the trail. <b>SM Entry/SM Sell/SM Close</b> are SmartMoney (Vivek
            Equity Tool) — an EMA(10)/EMA(20) vs SMA(40) trend inside a Wilder-ATR(40)×0.618 neutral channel, driving a state machine carried
            bar-to-bar. There's no separate RSI sub-panel — the RSI&gt;66 marker above already surfaces it; RSI14's own current value is
            still in the legend. Fetched fresh from Yahoo Finance on each visit — not cached.
          </MethodologyNote>
        </div>
      </div>
    </div>
  );
}
