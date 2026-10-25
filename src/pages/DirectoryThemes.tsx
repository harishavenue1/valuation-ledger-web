import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useData } from "../App";
import { Col, GenericTable, MethodologyNote, PriceLink, ScreenerLoading, Signed, fmtNum } from "../components/ScreenerTable";
import { api } from "../lib/api";
import { DEFAULT_THEMES } from "../lib/themes";
import { useWatchlist } from "../lib/useWatchlist";

// 2026-10-25 ("under directory we need to build themes, like transformers, pipes, datacenters, shipbuilding, etc") — a theme is a
// named list of NSE symbols, shown with the same columns as the index lists. The stock rows come from the all-stocks NSE technicals
// (the same payload All Technicals reads); membership lives in the watchlist meta (`themes`) so it is editable here and survives
// reloads. The overview ranks the themes against each other — the quick answer to "which theme is leading, which is breaking".

const num = (v: any): v is number => typeof v === "number" && Number.isFinite(v);

function median(vals: any[]): number | null {
  const v = vals.filter(num).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function rowStats(rows: Record<string, any>[]) {
  const share = (pred: (r: any) => boolean) => (rows.length ? Math.round((rows.filter(pred).length / rows.length) * 100) : null);
  return {
    n: rows.length,
    d1: median(rows.map((r) => r.change_pct)),
    m1: median(rows.map((r) => r.monthly_pct)),
    m3: median(rows.map((r) => r.three_month_pct)),
    m6: median(rows.map((r) => r.six_month_pct)),
    y1: median(rows.map((r) => r.yearly_pct)),
    above200: share((r) => num(r.pct_200d_ema) && r.pct_200d_ema > 0),
    nearAth: share((r) => num(r.pct_from_ath) && r.pct_from_ath >= -10),
  };
}

const dash = <span className="text-slate-300">—</span>;

const STOCK_COLS: Col[] = [
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "name", label: "Name", align: "left" },
  { key: "market_cap_cr", label: "Mkt Cap (₹ Cr)", render: (r) => (r.market_cap_cr == null ? dash : fmtNum(r.market_cap_cr, 0)) },
  { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
  { key: "change_pct", label: "Day %", groupStart: true, render: (r) => <Signed v={r.change_pct} digits={1} /> },
  { key: "weekly_pct", label: "1W %", render: (r) => <Signed v={r.weekly_pct} digits={1} /> },
  { key: "monthly_pct", label: "1M %", render: (r) => <Signed v={r.monthly_pct} digits={1} /> },
  { key: "three_month_pct", label: "3M %", render: (r) => <Signed v={r.three_month_pct} digits={1} /> },
  { key: "six_month_pct", label: "6M %", render: (r) => <Signed v={r.six_month_pct} digits={1} /> },
  { key: "yearly_pct", label: "1Y %", render: (r) => <Signed v={r.yearly_pct} digits={1} /> },
  { key: "pct_200d_ema", label: "vs 200D %", groupStart: true, render: (r) => <Signed v={r.pct_200d_ema} digits={1} /> },
  { key: "pct_33w_ema", label: "vs 33W %", render: (r) => <Signed v={r.pct_33w_ema} digits={1} /> },
  { key: "pct_from_ath", label: "ATH %", groupStart: true, render: (r) => <Signed v={r.pct_from_ath} digits={1} /> },
  { key: "pct_from_52w_high", label: "52WH %", render: (r) => <Signed v={r.pct_from_52w_high} digits={1} /> },
  { key: "rsi_w", label: "RSI (W)", render: (r) => fmtNum(r.rsi_w, 1) },
];

function Strip({ s }: { s: ReturnType<typeof rowStats> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-3 text-xs text-slate-500">
      <span>
        <b className="text-slate-700">{s.n}</b> stocks
      </span>
      <span>
        Median 1M <Signed v={s.m1} digits={1} />
      </span>
      <span>
        3M <Signed v={s.m3} digits={1} />
      </span>
      <span>
        6M <Signed v={s.m6} digits={1} />
      </span>
      <span>
        1Y <Signed v={s.y1} digits={1} />
      </span>
      <span>
        <b className="text-slate-700">{s.above200 ?? "—"}%</b> above 200D EMA
      </span>
      <span>
        <b className="text-slate-700">{s.nearAth ?? "—"}%</b> within 10% of ATH
      </span>
    </div>
  );
}

export default function DirectoryThemes() {
  const { bundle, setBundle } = useData();
  const navigate = useNavigate();
  const watchlist = useWatchlist();
  const [params, setParams] = useSearchParams();
  const [stocks, setStocks] = useState<Record<string, Record<string, any>> | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);

  const themes = bundle.watchlist.themes ?? DEFAULT_THEMES;
  const names = Object.keys(themes);
  const selected = names.includes(params.get("theme") ?? "") ? params.get("theme")! : "";

  useEffect(() => {
    let cancelled = false;
    api
      .getBhavTechnicals()
      .then((res) => {
        if (cancelled) return;
        if (!res.ok || !res.rows?.length) {
          setError("The all-stocks NSE technicals aren't published right now — try again after the evening NSE refresh.");
          return;
        }
        const map: Record<string, Record<string, any>> = {};
        for (const r of res.rows) map[r.symbol] = { ...r, six_month_pct: r.w_pct_6m };
        setStocks(map);
        setAsOf(res.as_of ?? null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const rowsFor = (name: string) => (themes[name] ?? []).map((s) => stocks?.[s]).filter((r): r is Record<string, any> => !!r);

  const overview = useMemo(() => {
    if (!stocks) return [];
    return names
      .map((name) => {
        const rows = (themes[name] ?? []).map((s) => stocks[s]).filter((r): r is Record<string, any> => !!r);
        const best = [...rows].filter((r) => num(r.three_month_pct)).sort((a, b) => b.three_month_pct - a.three_month_pct)[0];
        return { name, ...rowStats(rows), best: best?.symbol as string | undefined };
      })
      .sort((a, b) => (b.m3 ?? -1e9) - (a.m3 ?? -1e9));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stocks, themes]);

  const save = (next: Record<string, string[]>) => {
    const prev = bundle.watchlist.themes;
    setBundle((b) => ({ ...b, watchlist: { ...b.watchlist, themes: next } }));
    api.setThemes(next).catch(() => {
      setBundle((b) => ({ ...b, watchlist: { ...b.watchlist, themes: prev } }));
      setMsg("Couldn't save that change — try again.");
    });
  };

  const select = (name: string) => setParams(name ? { tab: "themes", theme: name } : { tab: "themes" });

  const addStock = () => {
    const sym = adding.trim().toUpperCase();
    if (!sym || !selected) return;
    if (!stocks?.[sym]) return setMsg(`${sym} isn't a listed NSE symbol in our store.`);
    if (themes[selected].includes(sym)) return setMsg(`${sym} is already in ${selected}.`);
    setMsg(null);
    setAdding("");
    save({ ...themes, [selected]: [...themes[selected], sym] });
  };

  const removeStock = (sym: string) => save({ ...themes, [selected]: themes[selected].filter((s) => s !== sym) });

  const createTheme = () => {
    const name = (newName ?? "").trim();
    if (!name) return setNewName(null);
    if (name.length > 40) return setMsg("Keep the theme name under 40 characters.");
    if (themes[name]) return setMsg(`${name} already exists.`);
    setNewName(null);
    setMsg(null);
    save({ ...themes, [name]: [] });
    select(name);
  };

  const deleteTheme = () => {
    if (!selected || !window.confirm(`Delete the "${selected}" theme? The stocks themselves are untouched.`)) return;
    const next = { ...themes };
    delete next[selected];
    save(next);
    select("");
  };

  const suggestions = useMemo(() => {
    const q = adding.trim().toLowerCase();
    if (!stocks || q.length < 2) return [];
    return Object.values(stocks)
      .filter((r) => r.symbol.toLowerCase().startsWith(q) || String(r.name ?? "").toLowerCase().includes(q))
      .slice(0, 12);
  }, [stocks, adding]);

  const cols = useMemo(() => {
    const all: Col[] = [...STOCK_COLS, { key: "_remove", label: "", render: (r) => (
      <button title="Remove from this theme" onClick={(e) => { e.stopPropagation(); removeStock(r.symbol); }} className="text-slate-400 hover:text-red-600 px-1">
        ✕
      </button>
    ) }];
    // Symbol (star + Screener link), Name, Mkt Cap and Price get a fixed share; the remove button is the last column; the return/EMA columns split the rest
    const fixed = [14, 14, 8, 7];
    const remove = 3;
    const rest = (100 - fixed.reduce((a, b) => a + b, 0) - remove) / (all.length - fixed.length - 1);
    return all.map((c, i) => ({ ...c, width: i < fixed.length ? fixed[i] : i === all.length - 1 ? remove : rest }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, themes]);

  const rows = useMemo(
    () => (selected && stocks ? rowsFor(selected).sort((a, b) => (b.three_month_pct ?? -1e9) - (a.three_month_pct ?? -1e9)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, themes, stocks],
  );
  const notFound = selected && stocks ? (themes[selected] ?? []).filter((s) => !stocks[s]) : [];

  if (error) return <div className="text-sm text-red-600 py-10 text-center">{error}</div>;
  if (!stocks) return <ScreenerLoading label="themes" />;

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <button onClick={() => select("")} className={`text-xs px-2.5 py-1 rounded-full border ${!selected ? "bg-slate-800 text-white border-slate-800" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}>
          All themes
        </button>
        {names.map((n) => (
          <button key={n} onClick={() => select(n)} className={`text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${selected === n ? "bg-slate-800 text-white border-slate-800" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}>
            {n} <span className="opacity-60">{themes[n].length}</span>
          </button>
        ))}
        {newName === null ? (
          <button onClick={() => setNewName("")} className="text-xs px-2.5 py-1 rounded-full border border-dashed border-slate-300 text-slate-500 hover:border-slate-400">
            ＋ New theme
          </button>
        ) : (
          <span className="inline-flex gap-1">
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createTheme()} placeholder="Theme name" className="text-xs border border-slate-300 rounded px-2 py-1 w-40 bg-transparent" />
            <button onClick={createTheme} className="text-xs px-2 py-1 rounded bg-indigo-600 text-white">
              Create
            </button>
            <button onClick={() => setNewName(null)} className="text-xs px-2 py-1 text-slate-500">
              Cancel
            </button>
          </span>
        )}
        {asOf && <span className="ml-auto text-xs text-slate-400">session {asOf}</span>}
      </div>
      {msg && <div className="text-xs text-amber-600 mb-2">{msg}</div>}

      <MethodologyNote>
        A theme is a named list of NSE stocks — the supply-chain names behind one story (transformers, pipes, data centers, shipbuilding…). The starting lists were
        built by matching company names against our daily NSE store, so every symbol is real, but <b>membership is a judgement call, not an official index</b> — edit
        it: pick a theme, type a symbol in <b>Add stock</b>, or press ✕ on a row; <b>＋ New theme</b> starts a new list. A stock can sit in several themes. Columns are
        the same as the index lists (latest session, split-adjusted). <b>All themes</b> ranks the themes by their <b>median 3M return</b>, with the share of members above
        their 200D EMA and within 10% of the all-time high — a quick read on which theme is leading and which is breaking down.
      </MethodologyNote>

      {!selected ? (
        <div className="overflow-auto border border-slate-200 rounded-lg">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">Theme</th>
                <th className="text-right px-2 py-2">Stocks</th>
                <th className="text-right px-2 py-2">Day %</th>
                <th className="text-right px-2 py-2">1M %</th>
                <th className="text-right px-2 py-2">3M % ▼</th>
                <th className="text-right px-2 py-2">6M %</th>
                <th className="text-right px-2 py-2">1Y %</th>
                <th className="text-right px-2 py-2">&gt; 200D EMA</th>
                <th className="text-right px-2 py-2">Near ATH</th>
                <th className="text-left px-3 py-2">Best 3M</th>
              </tr>
            </thead>
            <tbody>
              {overview.map((t) => (
                <tr key={t.name} onClick={() => select(t.name)} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                  <td className="px-3 py-2 font-medium">{t.name}</td>
                  <td className="px-2 py-2 text-right">{t.n}</td>
                  <td className="px-2 py-2 text-right"><Signed v={t.d1} digits={1} /></td>
                  <td className="px-2 py-2 text-right"><Signed v={t.m1} digits={1} /></td>
                  <td className="px-2 py-2 text-right"><Signed v={t.m3} digits={1} /></td>
                  <td className="px-2 py-2 text-right"><Signed v={t.m6} digits={1} /></td>
                  <td className="px-2 py-2 text-right"><Signed v={t.y1} digits={1} /></td>
                  <td className="px-2 py-2 text-right">{t.above200 == null ? dash : `${t.above200}%`}</td>
                  <td className="px-2 py-2 text-right">{t.nearAth == null ? dash : `${t.nearAth}%`}</td>
                  <td className="px-3 py-2">{t.best ?? dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <Strip s={rowStats(rows)} />
          <div className="flex flex-wrap items-center gap-2 mb-3 relative">
            <input
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addStock()}
              list="theme-suggest"
              placeholder="Add stock — symbol or name"
              className="text-xs border border-slate-300 rounded px-2 py-1.5 w-64 bg-transparent"
            />
            <datalist id="theme-suggest">
              {suggestions.map((r) => (
                <option key={r.symbol} value={r.symbol}>
                  {r.name}
                </option>
              ))}
            </datalist>
            <button onClick={addStock} className="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white">
              Add
            </button>
            <button onClick={deleteTheme} className="ml-auto text-xs text-slate-400 hover:text-red-600">
              Delete theme
            </button>
          </div>
          {notFound.length > 0 && <div className="text-xs text-amber-600 mb-2">Not in today's NSE store (renamed or delisted?): {notFound.join(", ")}</div>}
          <GenericTable
            key={selected}
            rows={rows}
            cols={cols}
            navigate={(t) => navigate(`/company/${t}`)}
            watchlist={watchlist}
            emptyMessage="No stocks in this theme yet — add one above."
          />
        </>
      )}
    </div>
  );
}
