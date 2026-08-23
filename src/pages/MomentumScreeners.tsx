import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../App";

// Each of these 4 screeners now scans NSE 750 (Nifty Total Market) and
// pushes independently from its own local skill script — see
// api/momentum_screeners.py. Row shape differs per screener (its own
// columns), so each tab defines its own small column list rather than
// sharing one generic table.
const TABS: { key: string; label: string; emoji: string }[] = [
  { key: "myLongTermInvestingStrategy", label: "myLongTermInvestingStrategy", emoji: "📐" },
  { key: "weekendInvesting", label: "weekendInvesting", emoji: "🏁" },
  { key: "quantBollinger", label: "quantBollinger", emoji: "📊" },
  { key: "Nifty500RelativeStrength", label: "RS (NSE750)", emoji: "💪" },
];

function fmtNum(v: any, digits = 2): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isNaN(n) ? String(v) : n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtSigned(v: any, digits = 2): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : parseFloat(v);
  if (Number.isNaN(n)) return String(v);
  return (n >= 0 ? "+" : "") + n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function Signed({ v, digits = 2 }: { v: any; digits?: number }) {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (v === null || v === undefined || v === "" || Number.isNaN(n)) return <span className="text-slate-300">—</span>;
  return <span className={n >= 0 ? "text-emerald-600" : "text-red-600"}>{fmtSigned(n, digits)}</span>;
}

interface Col {
  key: string;
  label: string;
  render?: (row: Record<string, any>) => React.ReactNode;
  align?: "left" | "right" | "center";
}

function GenericTable({ rows, cols, navigate }: { rows: Record<string, any>[]; cols: Col[]; navigate: (t: string) => void }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => String(r.symbol ?? "").toLowerCase().includes(needle) || String(r.name ?? "").toLowerCase().includes(needle));
  }, [rows, q]);

  if (rows.length === 0) {
    return <div className="text-slate-500 text-sm py-10 text-center border border-slate-200 rounded">No data yet for this screener — run its script to push results.</div>;
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 Filter by name/ticker"
          className="border border-slate-300 rounded px-3 py-1.5 text-sm w-56"
        />
        <span className="text-xs text-slate-400">{filtered.length} shown</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-50 text-slate-500 text-xs">
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={`px-2 py-2 whitespace-nowrap ${c.align === "left" ? "text-left" : "text-center"}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.symbol ?? i} className="border-t border-slate-100 hover:bg-slate-50">
                {cols.map((c) => (
                  <td key={c.key} className={`px-2 py-2 ${c.align === "left" ? "text-left" : "text-center"} ${c.key === "symbol" ? "font-semibold text-indigo-600" : "tabular-nums"}`}>
                    {c.key === "symbol" ? (
                      <button onClick={() => navigate(String(r.symbol))} className="hover:underline">
                        {r.symbol}
                      </button>
                    ) : c.render ? (
                      c.render(r)
                    ) : (
                      String(r[c.key] ?? "—")
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function MomentumScreeners() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const [tab, setTab] = useState(TABS[0].key);
  const entry = bundle.momentum_screeners[tab];
  const rows = entry?.rows ?? [];

  const COLS: Record<string, Col[]> = {
    myLongTermInvestingStrategy: [
      { key: "symbol", label: "Symbol", align: "left" },
      { key: "name", label: "Name", align: "left" },
      { key: "sector", label: "Sector", align: "left" },
      { key: "close", label: "Close", render: (r) => fmtNum(r.close) },
      { key: "rsi14", label: "RSI(14)", render: (r) => fmtNum(r.rsi14, 1) },
      { key: "ema12", label: "12W EMA", render: (r) => fmtNum(r.ema12) },
      { key: "ema21", label: "21W EMA", render: (r) => fmtNum(r.ema21) },
      { key: "ema33", label: "33W EMA", render: (r) => fmtNum(r.ema33) },
      { key: "pct_above_ema33", label: "% vs 33W EMA", render: (r) => <Signed v={r.pct_above_ema33} digits={1} /> },
    ],
    weekendInvesting: [
      { key: "rank", label: "Rank" },
      { key: "symbol", label: "Symbol", align: "left" },
      { key: "name", label: "Name", align: "left" },
      { key: "sector", label: "Sector", align: "left" },
      { key: "close", label: "Close", render: (r) => fmtNum(r.close) },
      { key: "close_52w_ago", label: "Close 52W Ago", render: (r) => fmtNum(r.close_52w_ago) },
      { key: "roc_1y_pct", label: "1Y Return %", render: (r) => <Signed v={r.roc_1y_pct} digits={1} /> },
    ],
    quantBollinger: [
      { key: "symbol", label: "Symbol", align: "left" },
      { key: "name", label: "Name", align: "left" },
      { key: "sector", label: "Sector", align: "left" },
      { key: "close", label: "Close", render: (r) => fmtNum(r.close) },
      { key: "upper_band", label: "Upper Band", render: (r) => fmtNum(r.upper_band) },
      { key: "pct_above_band", label: "% Above Band", render: (r) => <Signed v={r.pct_above_band} digits={1} /> },
      { key: "rs55_pct", label: "55W RS %", render: (r) => <Signed v={r.rs55_pct} digits={1} /> },
      { key: "pct_vs_sma34", label: "% vs 34W SMA", render: (r) => <Signed v={r.pct_vs_sma34} digits={1} /> },
      { key: "chandelier_stop", label: "Chandelier Stop", render: (r) => fmtNum(r.chandelier_stop) },
    ],
    Nifty500RelativeStrength: [
      { key: "rank", label: "Rank" },
      { key: "symbol", label: "Symbol", align: "left" },
      { key: "name", label: "Name", align: "left" },
      { key: "price", label: "Price", render: (r) => fmtNum(r.price) },
      { key: "r_1m", label: "1M %", render: (r) => <Signed v={r.r_1m} digits={1} /> },
      { key: "rs_1w", label: "RS 1W %", render: (r) => <Signed v={r.rs_1w} digits={1} /> },
      { key: "rs_1m", label: "RS 1M %", render: (r) => <Signed v={r.rs_1m} digits={1} /> },
      { key: "rs_3m", label: "RS 3M %", render: (r) => <Signed v={r.rs_3m} digits={1} /> },
      { key: "rs_6m", label: "RS 6M %", render: (r) => <Signed v={r.rs_6m} digits={1} /> },
      { key: "rs_score", label: "RS Score", render: (r) => <span className="font-semibold">{fmtNum(r.rs_score, 1)}</span> },
      { key: "rs_new_high", label: "New High?", render: (r) => (r.rs_new_high ? <span className="text-amber-600 font-semibold">Y</span> : "") },
    ],
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">📈 Momentum Screeners</h1>
        <span className="text-slate-500 text-sm">NSE 750 (Nifty Total Market)</span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Four independent momentum strategies, each pushed by its own local skill script after every run.
      </p>

      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {TABS.map((t) => {
          const e = bundle.momentum_screeners[t.key];
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`text-sm px-3 py-2 border-b-2 -mb-px font-medium ${
                active ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.emoji} {t.label}
              {e?.rows?.length ? <span className="ml-1.5 text-[11px] text-slate-400">({e.rows.length})</span> : null}
            </button>
          );
        })}
      </div>

      {entry?.as_of && <div className="text-xs text-slate-400 mb-3">as of {entry.as_of}</div>}

      <GenericTable rows={rows} cols={COLS[tab]} navigate={(t) => navigate(`/company/${t}`)} />
    </div>
  );
}
