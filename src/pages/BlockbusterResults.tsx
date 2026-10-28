import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData, useScreeners } from "../App";
import { Col, GenericTable, MethodologyNote, PriceLink, ScreenerLoading, Signed, fmtNum } from "../components/ScreenerTable";

// Blockbuster Results — added 2026-10-25 ("a new page for latest qtr results with block buster results ...
// Market Cap > 500Cr ... Sales % > 25%, Operating Profit > 25%, Net Profit > 25% and EPS % > 25% ... just
// company name (Screener link), marketCap, currentPrice (TV link) and the above params").
//
// No new API: reads the shared nse750Fundamentals cache (api/momentum_screeners.py, _rdcf_parse_quarterly),
// which keeps the last 6 quarters of YoY Sales / Operating Profit / Net Profit / EPS growth per stock — the
// LAST entry is each company's latest reported quarter, so companies that have already reported Sep 2026
// sit beside ones still on Jun 2026; the Quarter filter separates them (defaults to the newest quarter).
// "T" (turned profitable: year-ago quarter was a loss, so no honest %) counts as a pass unless switched off.
// Banks/NBFCs publish no Operating Profit row, so they can never pass this screen.

type G = number | "T" | null | undefined;
const last = <T,>(a: T[] | undefined | null): T | undefined => (a && a.length ? a[a.length - 1] : undefined);
const MON: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const qKey = (l: string) => {
  const [m, y] = l.split(" ");
  return parseInt(y, 10) * 12 + (MON[m] ?? 0);
};
const pass = (v: G, min: number, tOk: boolean) => (v === "T" ? tOk : typeof v === "number" && v > min);
const rank = (v: G) => (v === "T" ? 1e6 : typeof v === "number" ? v : -1e6);

function Gr({ v }: { v: G }) {
  if (v === "T") return <span className="text-emerald-600 font-semibold" title="Turned profitable — the year-ago quarter was a loss, so no % is meaningful">T</span>;
  return <Signed v={v} digits={1} />;
}

function Num({ label, value, onChange, suffix }: { label: string; value: number; onChange: (v: number) => void; suffix: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      <span>{label}</span>
      <div className="flex items-center gap-1">
        <input type="number" step="any" value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-24 px-2 py-1.5 border border-slate-300 rounded text-sm tabular-nums" />
        <span className="text-slate-400 text-xs">{suffix}</span>
      </div>
    </label>
  );
}

export default function BlockbusterResults() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const { ready } = useScreeners(["nse750Fundamentals", "nseScreener"]);
  const ms = bundle.momentum_screeners;

  const [minCap, setMinCap] = useState(500);
  const [minSales, setMinSales] = useState(25);
  const [minOp, setMinOp] = useState(25);
  const [minNp, setMinNp] = useState(25);
  const [minEps, setMinEps] = useState(25);
  const [tOk, setTOk] = useState(true);
  const [qtr, setQtr] = useState<string | null>(null); // null = newest quarter once the data is in

  const base = useMemo(() => {
    const names = new Map<string, string>((ms?.nseScreener?.rows ?? []).map((r: any) => [r.symbol, r.name]));
    return (ms?.nse750Fundamentals?.rows ?? [])
      .map((f: any) => {
        const q = last<string>(f.q_labels);
        if (!q) return null;
        return {
          symbol: f.symbol,
          name: names.get(f.symbol) || f.symbol,
          quarter: q,
          mcap: f.marketcap,
          price: f.current_price,
          sales: last<G>(f.q_sales_growth),
          op: last<G>(f.q_op_growth),
          np: last<G>(f.q_np_growth),
          eps: last<G>(f.q_eps_growth),
          // 2026-10-28 ("add a column marketCap/(latestOperatingProfit*4) name as Mcap/OpProfit & PEG Ratio")
          opProfit: last<number | null>(f.q_op) ?? null, // latest quarter's Operating Profit, Rs Cr
          pe: f.marketcap && f.net_profit_hist?.length && f.net_profit_hist[f.net_profit_hist.length - 1] > 0 ? f.marketcap / f.net_profit_hist[f.net_profit_hist.length - 1] : null, // market cap / trailing-twelve-month net profit (Screener's last annual column is TTM)
        };
      })
      .filter(Boolean) as Record<string, any>[];
  }, [ms]);

  const quarters = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of base) c.set(r.quarter, (c.get(r.quarter) ?? 0) + 1);
    return Array.from(c.entries()).sort((a, b) => qKey(b[0]) - qKey(a[0]));
  }, [base]);
  const activeQ = qtr ?? quarters[0]?.[0] ?? "All";
  const hasNp = base.some((r) => r.np !== undefined);
  const hasOp = base.some((r) => r.opProfit != null);

  const rows = useMemo(
    () =>
      base
        .filter((r) => (activeQ === "All" || r.quarter === activeQ) && (r.mcap ?? 0) > minCap && pass(r.sales, minSales, false) && pass(r.op, minOp, tOk) && pass(r.np, minNp, tOk) && pass(r.eps, minEps, tOk))
        .map((r): Record<string, any> => ({
          ...r,
          mcapOp: r.opProfit != null && r.opProfit > 0 && r.mcap ? r.mcap / (r.opProfit * 4) : null,
          peg: r.pe != null && typeof r.eps === "number" && r.eps > 0 ? r.pe / r.eps : null,
        }))
        .sort((a, b) => Math.min(rank(b.sales), rank(b.op), rank(b.np), rank(b.eps)) - Math.min(rank(a.sales), rank(a.op), rank(a.np), rank(a.eps))),
    [base, activeQ, minCap, minSales, minOp, minNp, minEps, tOk],
  );

  const cols: Col[] = [
    {
      key: "name",
      label: "Company",
      align: "left",
      width: 30,
      render: (r) => (
        <a href={`https://www.screener.in/company/${encodeURIComponent(r.symbol)}/consolidated/`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="hover:underline hover:text-indigo-600" title={`Open ${r.symbol} on Screener.in`}>
          {r.name}
        </a>
      ),
    },
    { key: "mcap", label: "Market Cap (₹ Cr)", width: 14, render: (r) => fmtNum(r.mcap, 0) },
    { key: "price", label: "Price (₹)", width: 11, render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
    { key: "quarter", label: "Quarter", align: "center", width: 9 },
    { key: "sales", label: "Sales YoY %", width: 9, render: (r) => <Gr v={r.sales} /> },
    { key: "op", label: "Operating Profit YoY %", width: 9, render: (r) => <Gr v={r.op} /> },
    { key: "np", label: "Net Profit YoY %", width: 9, render: (r) => <Gr v={r.np} /> },
    { key: "eps", label: "EPS YoY %", width: 9, render: (r) => <Gr v={r.eps} /> },
    {
      key: "mcapOp",
      label: "Mcap / OpProfit",
      width: 9,
      render: (r) =>
        r.mcapOp == null ? (
          <span className="text-slate-300" title="needs the latest quarter's Operating Profit — banks and NBFCs have none, and the cache fills in as the refresh runs">—</span>
        ) : (
          <span title={`Market cap ₹${fmtNum(r.mcap, 0)} Cr ÷ (latest quarter Operating Profit ₹${fmtNum(r.opProfit, 0)} Cr × 4 = ₹${fmtNum(r.opProfit * 4, 0)} Cr)`}>{fmtNum(r.mcapOp, 1)}x</span>
        ),
    },
    {
      key: "peg",
      label: "PEG Ratio",
      width: 8,
      render: (r) =>
        r.peg == null ? (
          <span className="text-slate-300" title="needs a positive PE and a numeric EPS growth (a turnaround quarter has no honest %)">—</span>
        ) : (
          <span title={`PE ${fmtNum(r.pe, 1)} (market cap ÷ trailing-12-month net profit) ÷ latest-quarter EPS growth ${fmtNum(r.eps, 1)}%`}>{fmtNum(r.peg, 2)}</span>
        ),
    },
  ];

  if (!ready) return <ScreenerLoading label="quarterly results" />;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-3 mb-1">
        <h1 className="text-lg font-semibold">💥 Blockbuster Results</h1>
        <span className="text-xs text-slate-500">
          Latest quarter: Sales, Operating Profit, Net Profit and EPS all up more than {minSales}% year on year — {rows.length} stock{rows.length === 1 ? "" : "s"}
          {ms?.nse750Fundamentals?.as_of ? ` · fundamentals as of ${ms.nse750Fundamentals.as_of}` : ""}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-4 my-3 p-3 border border-slate-200 rounded-lg">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          <span>Quarter reported</span>
          <select value={activeQ} onChange={(e) => setQtr(e.target.value)} className="px-2 py-1.5 border border-slate-300 rounded text-sm">
            <option value="All">All (each stock's latest)</option>
            {quarters.map(([q, n]) => (
              <option key={q} value={q}>
                {q} ({n} stocks)
              </option>
            ))}
          </select>
        </label>
        <Num label="Market cap above" value={minCap} onChange={setMinCap} suffix="₹ Cr" />
        <Num label="Sales growth above" value={minSales} onChange={setMinSales} suffix="%" />
        <Num label="Operating profit above" value={minOp} onChange={setMinOp} suffix="%" />
        <Num label="Net profit above" value={minNp} onChange={setMinNp} suffix="%" />
        <Num label="EPS above" value={minEps} onChange={setMinEps} suffix="%" />
        <label className="flex items-center gap-1.5 text-xs text-slate-600 pb-2" title="A profit line that went from a loss to a profit has no meaningful %, so it shows T">
          <input type="checkbox" checked={tOk} onChange={(e) => setTOk(e.target.checked)} /> count turnarounds (T)
        </label>
      </div>

      {!hasNp && (
        <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Net Profit growth isn't in the fundamentals cache yet — it fills in as the refresh runs (Sun / Wed / Fri). Until then nothing can pass the Net Profit test.
        </div>
      )}

      {!hasOp && (
        <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Mcap / OpProfit needs each company's latest-quarter Operating Profit, which the fundamentals cache only started storing on 28 Oct — it fills in as the refresh runs (Sun / Wed / Fri, or Run now on the Fundamentals page).
        </div>
      )}

      <MethodologyNote>
        <p>
          One row per NSE 750 stock, using each company's <b>latest reported quarter</b> compared with the same quarter a year earlier (Screener.in's quarterly results). A stock shows only if Market Cap, Sales, Operating Profit,
          Net Profit and EPS growth <i>all</i> clear the thresholds above. Sorted by the weakest of the four growth rates, so the most all-round blockbusters come first. <b>T</b> means the year-ago quarter was a loss and the line
          turned profitable. <b>Mcap / OpProfit</b> = market cap ÷ (the latest quarter's Operating Profit × 4) — how many years of the latest quarter's run-rate operating profit the market cap is worth (lower = cheaper; it ignores debt, tax and
          seasonality). <b>PEG Ratio</b> = PE ÷ the latest quarter's EPS growth %, where PE = market cap ÷ trailing-12-month net profit; a quarter that jumped off a tiny base gives a very small PEG, so read it beside the growth columns, and it is blank
          for a loss-to-profit turnaround.
        </p>
        <p>
          Results arrive over several weeks, so the <b>Quarter reported</b> filter defaults to the newest quarter in the data — pick another or "All" to see everyone's latest. The cache refreshes Sundays, Wednesdays and
          Fridays, so a company that reported yesterday may take a few days to appear. Banks and NBFCs don't publish an Operating Profit line and so never pass. Universe is the NSE 750, not every listed company.
        </p>
      </MethodologyNote>

      <GenericTable rows={rows} cols={cols} navigate={navigate} fullHeight emptyMessage="No stock clears all four growth tests for this quarter yet." />
    </div>
  );
}
