import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import type { VirajRow } from "../lib/api";
import RunButton from "../components/RunButton";
import { MethodologyNote, WatchlistStar } from "../components/ScreenerTable";
import { useWatchlist } from "../lib/useWatchlist";

// F1-F3/C1-C3/score/verdict/sales_g/ebit_g/eps_g/dol/dfl/dcl all
// arrive pre-formatted as strings straight from viraj_screen.py's own
// build_rows() ("✅"/"❌"/"—", "+90%", "5/6") — rendered as-is, not
// re-parsed, except where sorting needs a numeric read.
// Symbol/Name widened 90/190 -> 130/260 (2026-08-23, "we have enough
// space on viraj screen page... increase width of symbol and name, as
// it overlaps" — long tickers like GRWRHITECH/ATHERENERG were butting
// up against the Name column with no breathing room).
const COL_WIDTHS = [90, 130, 260, 90, 90, 80, 80, 80, 60, 60, 60, 55, 55, 55, 55, 55, 55, 60, 170];
const TABLE_WIDTH = COL_WIDTHS.reduce((a, b) => a + b, 0);

function priceNum(v: number | string): number {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isNaN(n) ? -1 : n;
}
// Price -> TradingView weekly chart for that symbol, new tab. Same
// pattern as MomentumScreeners.tsx's PriceLink.
function PriceLink({ symbol, value }: { symbol: string; value: number | string }) {
  const n = priceNum(value);
  return (
    <a
      href={`https://www.tradingview.com/chart/?symbol=NSE:${encodeURIComponent(symbol)}&interval=W`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="hover:underline hover:text-indigo-600"
      title={`Open ${symbol} chart on TradingView`}
    >
      {n < 0 ? (value === null || value === undefined || value === "" ? "—" : String(value)) : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
    </a>
  );
}

function verdictRank(v: string): number {
  if (v.includes("ENTRY READY")) return 0;
  if (v.includes("WATCHLIST")) return 1;
  return 2; // SKIP, NO DATA
}
function verdictBucket(v: string): "entry" | "watch" | "skip" {
  if (v.includes("ENTRY READY")) return "entry";
  if (v.includes("WATCHLIST")) return "watch";
  return "skip";
}
const VERDICT_CLASS: Record<ReturnType<typeof verdictBucket>, string> = {
  entry: "bg-emerald-50 text-emerald-700 border-emerald-300",
  watch: "bg-amber-50 text-amber-700 border-amber-300",
  skip: "bg-slate-100 text-slate-500 border-slate-300",
};
function scoreNum(s: string): number {
  // "5/6" -> 5. Missing/"—" sorts last (via -1).
  const m = /^(\d+)\/(\d+)$/.exec(s);
  return m ? parseInt(m[1], 10) : -1;
}
function mktCapNum(v: number | string): number {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isNaN(n) ? -1 : n;
}
function fmtMktCap(v: number | string): string {
  const n = mktCapNum(v);
  return n < 0 ? String(v) : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
}

type SortKey = "symbol" | "marketcap" | "price" | "sales_g" | "dol" | "score" | "verdict";
const CATEGORY_CHIPS = ["All", "EQ", "T2T", "Sharpe"] as const;
const VERDICT_CHIPS: { label: string; value: "All" | "entry" | "watch" | "skip" }[] = [
  { label: "All", value: "All" },
  { label: "⭐ Entry Ready", value: "entry" },
  { label: "👀 Watchlist", value: "watch" },
  { label: "Skip", value: "skip" },
];

function Tick({ v }: { v: string }) {
  const cls = v === "✅" ? "bg-emerald-50 text-emerald-700" : v === "❌" ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-400";
  return <span className={`inline-flex items-center justify-center w-6 h-6 rounded ${cls}`}>{v}</span>;
}

function Th({ label, w, sortKey, active, dir, onClick }: { label: string; w: number; sortKey?: SortKey; active?: boolean; dir?: "asc" | "desc"; onClick?: () => void }) {
  return (
    <th className="text-center px-1.5 py-2 whitespace-nowrap" style={{ width: w }}>
      {sortKey ? (
        <button onClick={onClick} className={`hover:text-slate-800 ${active ? "text-slate-800" : ""}`}>
          {label} {active ? (dir === "desc" ? "▼" : "▲") : ""}
        </button>
      ) : (
        label
      )}
    </th>
  );
}

export default function VirajScreen() {
  const { bundle, reload } = useData();
  const navigate = useNavigate();
  const { as_of, rows } = bundle.viraj_screen;
  const [q, setQ] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const watchlist = useWatchlist();

  async function doRefresh() {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }

  const [category, setCategory] = useState<(typeof CATEGORY_CHIPS)[number]>("All");
  const [verdict, setVerdict] = useState<(typeof VERDICT_CHIPS)[number]["value"]>("All");
  const [sortKey, setSortKey] = useState<SortKey>("verdict");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function clickHeader(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "verdict" ? "asc" : "desc");
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (needle && !r.symbol.toLowerCase().includes(needle) && !r.name.toLowerCase().includes(needle)) return false;
      if (category !== "All" && !r.category.includes(category)) return false;
      if (verdict !== "All" && verdictBucket(r.verdict) !== verdict) return false;
      return true;
    });
  }, [rows, q, category, verdict]);

  const sorted = useMemo(() => {
    const withVal = filtered.map((r) => {
      let v: number | string;
      switch (sortKey) {
        case "marketcap":
          v = mktCapNum(r.marketcap);
          break;
        case "price":
          v = priceNum(r.price);
          break;
        case "sales_g":
          v = parseFloat(r.sales_g) || -Infinity;
          break;
        case "dol":
          v = parseFloat(r.dol) || -Infinity;
          break;
        case "score":
          v = scoreNum(r.score);
          break;
        case "verdict":
          v = verdictRank(r.verdict);
          break;
        default:
          v = r.symbol;
      }
      return { r, v };
    });
    withVal.sort((a, b) => {
      const cmp = a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
      return sortDir === "desc" ? -cmp : cmp;
    });
    return withVal.map((x) => x.r);
  }, [filtered, sortKey, sortDir]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">🎯 Viraj Screen</h1>
        <span className="text-slate-500 text-sm">
          {rows.length} stocks{as_of ? ` · as of ${as_of}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <RunButton screener="viraj_screen" />
          <button
            onClick={doRefresh}
            disabled={refreshing}
            className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400 disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "🔄 Refresh"}
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Weekly momentum filter — Viraj's Momentum / T2T Segments / Sharpe Based Momentum, 6-rule validation. Pushed by{" "}
        <code className="bg-slate-100 px-1 rounded">viraj_screen.py</code> after each run.
      </p>

      <MethodologyNote>
        <p className="mb-2">
          Universe = top 45 stocks each from 3 momoindiascreener.in lists (EQ / T2T / Sharpe), deduped by symbol. Every unique stock gets 3
          fundamental checks (<b>F1-F3</b>, from Screener.in) and 3 chart checks (<b>C1-C3</b>, from Chartink), scored <b>X/6</b>:
        </p>
        <ul className="list-disc list-inside mb-2 space-y-0.5">
          <li>
            <b>F1</b>: DOL (Degree of Operating Leverage = EBIT growth% ÷ Sales growth%) &gt; 1.5
          </li>
          <li>
            <b>F2</b>: DFL (Degree of Financial Leverage = EPS growth% ÷ EBIT growth%) &lt; 1.2
          </li>
          <li>
            <b>F3</b>: latest quarter's Operating Profit &gt; the same quarter last year
          </li>
          <li>
            <b>C1</b>: weekly RSI(14) &gt; 66
          </li>
          <li>
            <b>C2</b>: price above the 200-day EMA
          </li>
          <li>
            <b>C3</b>: 10-day/20-day EMA gap has been narrowing for the last 3 days (contraction, i.e. a base forming)
          </li>
        </ul>
        <p>
          <b>Verdict</b>: "SKIP — sales declining" if latest-quarter Sales growth% isn't positive; "SKIP" if 2 or more of F1/F2/F3 fail;{" "}
          <b>⭐ ENTRY READY</b> if every rule that has data passes (score = max score, and at least 5 rules were scoreable); "WATCHLIST — await
          EMA contraction" if only C3 is missing and everything else is one rule off the max; "WATCHLIST" if the score is one rule off the max
          for any other reason; otherwise "SKIP". <b>DOL/DFL/DCL</b> (DCL = DOL × DFL) are shown as raw numbers alongside the F1/F2 pass/fail
          ticks so you can see how close a borderline case actually is.
        </p>
      </MethodologyNote>

      {rows.length === 0 ? (
        <div className="text-slate-500 text-sm py-10 text-center border border-slate-200 rounded">
          No Viraj Screen data yet — run <code className="bg-slate-100 px-1 rounded">viraj_screen.py</code> to push results here.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="🔍 Filter by name/ticker"
              className="border border-slate-300 rounded px-3 py-1.5 text-sm w-56"
            />
            <div className="flex gap-1">
              {CATEGORY_CHIPS.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                    category === c ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-300 text-slate-600 hover:border-indigo-400"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {VERDICT_CHIPS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setVerdict(c.value)}
                  className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                    verdict === c.value ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-300 text-slate-600 hover:border-indigo-400"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-400 ml-auto">{sorted.length} shown</span>
          </div>

          {/* max-h + overflow-y-auto makes this its own scroll pane
              (verified live in an isolated test before landing this —
              overflow-x-auto ALONE still forces the browser to treat
              this div as the sticky-positioning containing block
              regardless of whether it has a height cap, so an
              unbounded wrapper with thead sticky top-[57px] silently
              overlapped/hid the first row instead of sticking to the
              page; top:0 relative to this pane's OWN scroll is what
              actually works). 2026-08-23, "let the header be seen...
              on scroll down". */}
          <div className="overflow-x-auto overflow-y-auto max-h-[75vh] rounded-lg border border-slate-200">
            <table className="text-sm border-collapse" style={{ tableLayout: "fixed", width: TABLE_WIDTH }}>
              <thead className="bg-slate-50 text-slate-500 text-xs sticky top-0 z-10">
                <tr>
                  <Th label="Segment" w={COL_WIDTHS[0]} />
                  <Th label="Symbol" w={COL_WIDTHS[1]} sortKey="symbol" active={sortKey === "symbol"} dir={sortDir} onClick={() => clickHeader("symbol")} />
                  <Th label="Name" w={COL_WIDTHS[2]} />
                  <Th label="Mkt Cap" w={COL_WIDTHS[3]} sortKey="marketcap" active={sortKey === "marketcap"} dir={sortDir} onClick={() => clickHeader("marketcap")} />
                  <Th label="Price" w={COL_WIDTHS[4]} sortKey="price" active={sortKey === "price"} dir={sortDir} onClick={() => clickHeader("price")} />
                  <Th label="Sales G%" w={COL_WIDTHS[5]} sortKey="sales_g" active={sortKey === "sales_g"} dir={sortDir} onClick={() => clickHeader("sales_g")} />
                  <Th label="EBIT G%" w={COL_WIDTHS[6]} />
                  <Th label="EPS G%" w={COL_WIDTHS[7]} />
                  <Th label="DOL" w={COL_WIDTHS[8]} sortKey="dol" active={sortKey === "dol"} dir={sortDir} onClick={() => clickHeader("dol")} />
                  <Th label="DFL" w={COL_WIDTHS[9]} />
                  <Th label="DCL" w={COL_WIDTHS[10]} />
                  <Th label="F1" w={COL_WIDTHS[11]} />
                  <Th label="F2" w={COL_WIDTHS[12]} />
                  <Th label="F3" w={COL_WIDTHS[13]} />
                  <Th label="C1" w={COL_WIDTHS[14]} />
                  <Th label="C2" w={COL_WIDTHS[15]} />
                  <Th label="C3" w={COL_WIDTHS[16]} />
                  <Th label="Score" w={COL_WIDTHS[17]} sortKey="score" active={sortKey === "score"} dir={sortDir} onClick={() => clickHeader("score")} />
                  <Th label="Verdict" w={COL_WIDTHS[18]} sortKey="verdict" active={sortKey === "verdict"} dir={sortDir} onClick={() => clickHeader("verdict")} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.symbol} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-1.5 py-2 text-center text-[11px] text-slate-500">{r.category}</td>
                    <td className="px-1.5 py-2 text-center whitespace-nowrap">
                      <WatchlistStar active={watchlist.set.has(r.symbol)} onToggle={watchlist.toggle} symbol={r.symbol} />
                      <button onClick={() => navigate(`/company/${r.symbol}`)} className="font-semibold text-indigo-600 hover:underline">
                        {r.symbol}
                      </button>
                    </td>
                    <td className="px-1.5 py-2 truncate" title={r.name}>
                      {r.name}
                    </td>
                    <td className="px-1.5 py-2 text-center tabular-nums">{fmtMktCap(r.marketcap)}</td>
                    <td className="px-1.5 py-2 text-center tabular-nums">
                      <PriceLink symbol={r.symbol} value={r.price} />
                    </td>
                    <td className="px-1.5 py-2 text-center tabular-nums">{r.sales_g}</td>
                    <td className="px-1.5 py-2 text-center tabular-nums">{r.ebit_g}</td>
                    <td className="px-1.5 py-2 text-center tabular-nums">{r.eps_g}</td>
                    <td className="px-1.5 py-2 text-center tabular-nums">{r.dol}</td>
                    <td className="px-1.5 py-2 text-center tabular-nums">{r.dfl}</td>
                    <td className="px-1.5 py-2 text-center tabular-nums">{r.dcl}</td>
                    <td className="px-1.5 py-2 text-center">
                      <Tick v={r.F1} />
                    </td>
                    <td className="px-1.5 py-2 text-center">
                      <Tick v={r.F2} />
                    </td>
                    <td className="px-1.5 py-2 text-center">
                      <Tick v={r.F3} />
                    </td>
                    <td className="px-1.5 py-2 text-center">
                      <Tick v={r.C1} />
                    </td>
                    <td className="px-1.5 py-2 text-center">
                      <Tick v={r.C2} />
                    </td>
                    <td className="px-1.5 py-2 text-center">
                      <Tick v={r.C3} />
                    </td>
                    <td className="px-1.5 py-2 text-center font-semibold tabular-nums">{r.score}</td>
                    <td className="px-1.5 py-2 text-center">
                      <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${VERDICT_CLASS[verdictBucket(r.verdict)]}`}>
                        {r.verdict}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
