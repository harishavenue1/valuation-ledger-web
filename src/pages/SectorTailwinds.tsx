import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Signed } from "../components/ScreenerTable";
import { TAG_CLASS, companyPath, fmtCr, storyStats, useBusinessData, Stats } from "../lib/businessData";

// Sectors tab — which sectors are collecting the most orders, capex and approvals this month
// compared with the month before, from the same accumulated headlines as the Radar.

type Key = "sector" | "companies" | "stories" | "raw" | "delta" | "valueCr" | "orders" | "capex" | "risk" | "m3";
interface Top {
  symbol: string;
  name: string;
  st: Stats;
}
interface SectorRow {
  sector: string;
  companies: number;
  stories: number;
  raw: number;
  prevRaw: number;
  delta: number | null; // % change of the weighted story count vs the previous 30 days
  valueCr: number;
  orders: number;
  capex: number;
  risk: number;
  m3: number | null;
  top: Top[];
}

export default function SectorTailwinds() {
  const { radar, tech, err } = useBusinessData();
  const [sortKey, setSortKey] = useState<Key>("raw");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [open, setOpen] = useState<string | null>(null);
  const [minCompanies, setMinCompanies] = useState(3);
  const [q, setQ] = useState("");

  const { rows, histFrom } = useMemo(() => {
    if (!radar) return { rows: [] as SectorRow[], histFrom: "" };
    const now = Date.now();
    const by = new Map<string, SectorRow>();
    let histFrom = "9999";
    for (const [sym, all] of Object.entries(radar.items)) {
      for (const i of all) if (i.d < histFrom) histFrom = i.d;
      const cur = storyStats(all, 0, 30, now);
      const prev = storyStats(all, 30, 60, now);
      if (!cur && !prev) continue;
      const sector = radar.sectors?.[sym] || "Unclassified";
      let r = by.get(sector);
      if (!r) {
        r = { sector, companies: 0, stories: 0, raw: 0, prevRaw: 0, delta: null, valueCr: 0, orders: 0, capex: 0, risk: 0, m3: null, top: [] };
        by.set(sector, r);
      }
      r.prevRaw += prev?.raw ?? 0;
      if (cur) {
        r.companies++;
        r.stories += cur.stories;
        r.raw += cur.raw;
        r.valueCr += cur.valueCr;
        r.orders += cur.tagCounts["Order"] ?? 0;
        r.capex += cur.tagCounts["Capex"] ?? 0;
        r.risk += cur.tagCounts["Risk"] ?? 0;
        r.top.push({ symbol: sym, name: radar.names[sym] ?? sym, st: cur });
      }
    }
    const out = Array.from(by.values()).filter((r) => r.companies > 0);
    for (const r of out) {
      r.delta = r.prevRaw > 0 ? ((r.raw - r.prevRaw) / r.prevRaw) * 100 : null;
      r.top.sort((a, b) => b.st.score - a.st.score);
      const m3 = r.top.map((t) => tech.get(t.symbol)?.three_month_pct).filter((v): v is number => typeof v === "number");
      r.m3 = m3.length ? m3.reduce((a, b) => a + b, 0) / m3.length : null;
      r.raw = Math.round(r.raw * 10) / 10;
    }
    return { rows: out, histFrom };
  }, [radar, tech]);

  const view = useMemo(() => {
    let r = rows.filter((x) => x.companies >= minCompanies);
    const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((x) => x.sector.toLowerCase().includes(needle));
    const val = (x: SectorRow): number | string | null => (sortKey === "sector" ? x.sector : (x as any)[sortKey === "m3" ? "m3" : sortKey === "delta" ? "delta" : sortKey] ?? null);
    return r.slice().sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return va < vb ? -dir : va > vb ? dir : 0;
    });
  }, [rows, minCompanies, q, sortKey, dir]);

  function click(k: Key) {
    if (k === sortKey) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setDir(k === "sector" ? 1 : -1);
    }
  }
  const H: { k: Key; label: string; right?: boolean; tip?: string }[] = [
    { k: "sector", label: "Sector" },
    { k: "companies", label: "Companies with news", right: true, tip: "Companies with at least one growth/risk story in the last 30 days" },
    { k: "stories", label: "Stories 30d", right: true, tip: "Distinct stories (the same order reported by many outlets counts once)" },
    { k: "raw", label: "Tailwind", right: true, tip: "Story weights summed over the last 30 days (Order/Capex 3, M&A/Approval 2, Partnership 1.5, Funding/Outlook 1, Concall 0.5, Risk −2)" },
    { k: "delta", label: "vs prior 30d", right: true, tip: "Change in that tailwind figure against the 30 days before" },
    { k: "valueCr", label: "Value ₹Cr", right: true, tip: "₹ amounts on distinct Order / Capex / M&A stories" },
    { k: "orders", label: "Orders", right: true },
    { k: "capex", label: "Capex", right: true },
    { k: "risk", label: "Risk", right: true },
    { k: "m3", label: "Avg 3M %", right: true, tip: "Average 3-month price change of the sector's companies with news" },
  ];

  return (
    <div>
      <p className="text-xs text-slate-500 mb-3 max-w-4xl">
        Which sectors are collecting orders, capex and approvals this month, against the month before. Built from the same daily headlines as the Radar
        {histFrom !== "9999" && <> (history starts {histFrom}; the "vs prior 30d" column needs 60 days of it)</>}. A sector's number is only as good as its coverage — companies outside the NSE index lists show as
        "Unclassified".
      </p>
      <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
        <label className="flex items-center gap-1.5 text-slate-600">
          Min companies
          <input
            type="number"
            min={1}
            value={minCompanies}
            onChange={(e) => setMinCompanies(parseInt(e.target.value) || 1)}
            className="w-14 px-1 py-0 text-right border border-slate-300 rounded bg-white text-slate-800"
          />
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter sector" className="px-2 py-1 text-sm border border-slate-300 rounded bg-white w-44" />
        <span className="text-xs text-slate-500">{view.length} sectors</span>
      </div>
      {err && <div className="text-sm text-red-600">Could not load: {err}</div>}
      {!radar && !err && <div className="text-sm text-slate-500">Loading…</div>}
      {radar && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                {H.map((h) => (
                  <th key={h.k} className={`py-2 px-2 cursor-pointer select-none hover:text-slate-700 ${h.right ? "text-right" : ""}`} title={h.tip} onClick={() => click(h.k)}>
                    {h.label}
                    {sortKey === h.k && <span className="ml-0.5">{dir === -1 ? "▼" : "▲"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.map((r) => (
                <Fragment key={r.sector}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50/60 cursor-pointer" onClick={() => setOpen(open === r.sector ? null : r.sector)}>
                    <td className="py-2 px-2 font-medium">
                      <span className="text-slate-400 mr-1">{open === r.sector ? "▾" : "▸"}</span>
                      {r.sector}
                    </td>
                    <td className="py-2 px-2 text-right">{r.companies}</td>
                    <td className="py-2 px-2 text-right">{r.stories}</td>
                    <td className="py-2 px-2 text-right font-medium">{r.raw.toFixed(1)}</td>
                    <td className="py-2 px-2 text-right">{r.delta != null ? <Signed v={r.delta} digits={0} /> : <span className="text-slate-400">–</span>}</td>
                    <td className="py-2 px-2 text-right">{fmtCr(r.valueCr)}</td>
                    <td className="py-2 px-2 text-right">{r.orders || ""}</td>
                    <td className="py-2 px-2 text-right">{r.capex || ""}</td>
                    <td className="py-2 px-2 text-right">{r.risk || ""}</td>
                    <td className="py-2 px-2 text-right">{r.m3 != null ? <Signed v={r.m3} digits={0} /> : ""}</td>
                  </tr>
                  {open === r.sector && (
                    <tr>
                      <td colSpan={10} className="pl-8 pr-2 pb-3 pt-1">
                        <div className="border-l-2 border-slate-300 pl-4">
                          <div className="text-xs text-slate-500 mb-1">Top companies by catalyst score (30 days)</div>
                          <ul className="space-y-1">
                            {r.top.slice(0, 10).map((t) => (
                              <li key={t.symbol} className="flex flex-wrap gap-2 items-baseline">
                                <Link to={companyPath(t.symbol)} className="font-medium text-indigo-600 hover:underline w-28 shrink-0">
                                  {t.symbol}
                                </Link>
                                <span className="w-10 text-right shrink-0">{t.st.score.toFixed(1)}</span>
                                <span className="flex flex-wrap gap-1">
                                  {Object.entries(t.st.tagCounts).map(([g, n]) => (
                                    <span key={g} className={`text-[10px] px-1 rounded border ${TAG_CLASS[g]}`}>
                                      {g} {n}
                                    </span>
                                  ))}
                                </span>
                                <span className="text-xs text-slate-500 truncate max-w-[34rem]">{t.st.items[0].t}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
