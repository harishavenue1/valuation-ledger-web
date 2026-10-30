import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData, useScreeners } from "../App";
import { api } from "../lib/api";
import { MethodologyNote, ScreenerLoading, Signed, fmtNum } from "../components/ScreenerTable";

// Trade Desk — added 2026-10-30 ("give me a page for me to buy sell with controls, button, qty, holdings list").
//
// This page PREPARES orders; it never sends one. You pick a stock (or click Buy / Sell on a holding), set the side, quantity and price with the
// controls, see what the order does to your holding and your portfolio weight, and add it to a basket. "Open basket in Kite" then posts the basket
// to Kite's own order window (Kite Publisher), where you log in and press the final confirm yourself — no broker credential is stored anywhere
// in this app. Without a Kite API key the basket can be copied as text instead.
//
// Holdings (quantity, average, price) are as of the last PF update; "Refresh live prices" pulls current Yahoo quotes so a ticket is sized off today's
// price. Untested against a live Kite account — see the note at the bottom of the page.

type Side = "BUY" | "SELL";
type OType = "MARKET" | "LIMIT";
type Product = "CNC" | "MTF";
interface Held {
  symbol: string;
  qty: number;
  avg: number | null;
  ltp: number | null;
  weight: number;
  exchange: string;
  isFund: boolean;
  pnl: number | null;
}
interface Ticket {
  id: number;
  side: Side;
  symbol: string;
  exchange: string;
  qty: number;
  otype: OType;
  price: number | null; // the limit price (LIMIT) — for MARKET only the estimate used to size it
  product: Product;
  est: number; // estimated value ₹
}

const lsGet = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};
const R = (v: number) => `₹${fmtNum(v, 0)}`;

export default function TradeDesk() {
  const { bundle } = useData();
  const { ready } = useScreeners(["portfolioAllocation"]);
  const pa = bundle.momentum_screeners.portfolioAllocation;
  const [pf, setPf] = useState<{ value: number; as_of?: string; holdings: Record<string, { qty: number; avg: number | null; ltp: number | null }> } | null>(null);
  const [quotes, setQuotes] = useState<Record<string, { price: number; prev: number; day: number }>>({});
  const [quoteAt, setQuoteAt] = useState<string | null>(null);
  const [loadingQ, setLoadingQ] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [side, setSide] = useState<Side>("BUY");
  const [symbol, setSymbol] = useState("");
  const [exchange, setExchange] = useState("NSE");
  const [qty, setQty] = useState(0);
  const [otype, setOtype] = useState<OType>("MARKET");
  const [limit, setLimit] = useState("");
  const [product, setProduct] = useState<Product>("CNC");
  const [basket, setBasket] = useState<Ticket[]>([]);
  const [apiKey, setApiKey] = useState(() => lsGet("kite-api-key", ""));
  const [capPct, setCapPct] = useState(() => parseFloat(lsGet("td-cap-pct", "3")) || 3);
  const [checked, setChecked] = useState(false);
  const [typed, setTyped] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .getJournal()
      .then((j) => setPf(j.portfolio?.holdings ? { value: j.portfolio.value, as_of: j.portfolio.as_of, holdings: j.portfolio.holdings } : null))
      .catch((e) => setErr(String(e?.message ?? e)));
  }, []);

  const meta = useMemo(() => new Map<string, any>((pa?.rows ?? []).map((r: any) => [r.symbol, r])), [pa]);
  const held: Held[] = useMemo(() => {
    if (!pf) return [];
    return Object.entries(pf.holdings)
      .filter(([, h]) => (h.qty ?? 0) > 0)
      .map(([sym, h]) => {
        const m = meta.get(sym);
        const live = quotes[sym]?.price;
        const px = live ?? h.ltp ?? 0;
        return { symbol: sym, qty: h.qty, avg: h.avg, ltp: px || null, weight: pf.value > 0 ? (h.qty * px) / pf.value * 100 : 0, exchange: m?.exchange === "BSE" ? "BSE" : "NSE", isFund: !!m?.is_fund, pnl: h.avg && px ? (px / h.avg - 1) * 100 : null };
      })
      .sort((a, b) => b.weight - a.weight);
  }, [pf, meta, quotes]);
  const heldMap = useMemo(() => new Map(held.map((h) => [h.symbol, h])), [held]);
  const shown = held.filter((h) => !q.trim() || h.symbol.includes(q.trim().toUpperCase()));

  const cur = heldMap.get(symbol.trim().toUpperCase());
  const sym = symbol.trim().toUpperCase();
  const live = quotes[sym]?.price;
  const mkt = live ?? cur?.ltp ?? null; // the best price we have for this symbol
  const limitPx = parseFloat(limit);
  const px = otype === "LIMIT" ? (Number.isFinite(limitPx) ? limitPx : null) : mkt;
  const value = px && qty > 0 ? px * qty : 0;
  const pv = pf?.value ?? 0;
  const heldQty = cur?.qty ?? 0;

  const warnings: string[] = [];
  if (sym && !px) warnings.push(otype === "LIMIT" ? "Enter a limit price." : "No price for this symbol yet — press Refresh live prices, or use a limit order.");
  if (side === "SELL" && qty > heldQty) warnings.push(`You hold ${heldQty} — this sells ${qty - heldQty} more than you own.`);
  if (otype === "LIMIT" && px && mkt && Math.abs(px / mkt - 1) > 0.05) warnings.push(`The limit is ${fmtNum(Math.abs(px / mkt - 1) * 100, 1)}% ${px > mkt ? "above" : "below"} the last price (₹${fmtNum(mkt, 2)}).`);
  if (pv > 0 && value / pv * 100 > capPct) warnings.push(`This order is ${fmtNum(value / pv * 100, 1)}% of the portfolio — above your ${capPct}% size cap.`);
  if (sym.endsWith("-BE")) warnings.push("-BE (trade-for-trade) stock: delivery only, no intraday exit.");

  const pickFrom = (h: Held, s: Side) => {
    setSide(s);
    setSymbol(h.symbol);
    setExchange(h.exchange);
    setQty(s === "SELL" ? h.qty : 0);
    setOtype("MARKET");
    setLimit("");
    setMsg(null);
    document.getElementById("td-ticket")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const refreshQuotes = async () => {
    setLoadingQ(true);
    try {
      const syms = Array.from(new Set([...held.map((h) => h.symbol), ...(sym ? [sym] : [])]));
      const r = await api.getLiveQuotes(syms);
      setQuotes(r.quotes);
      setQuoteAt(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoadingQ(false);
    }
  };

  const qtyFromWeight = (w: number) => (px && pv ? Math.max(0, Math.floor((pv * w) / 100 / px)) : 0);

  const addToBasket = () => {
    if (!sym || qty <= 0 || (!px && otype === "LIMIT")) {
      setMsg("Pick a symbol, a quantity and (for a limit order) a price first.");
      return;
    }
    setBasket((b) => [...b, { id: Date.now(), side, symbol: sym, exchange, qty, otype, price: px, product, est: value }]);
    setChecked(false);
    setTyped("");
    setMsg(`Added: ${side} ${qty} ${sym}.`);
    setQty(0);
  };

  const buyTotal = basket.filter((t) => t.side === "BUY").reduce((a, t) => a + t.est, 0);
  const sellTotal = basket.filter((t) => t.side === "SELL").reduce((a, t) => a + t.est, 0);
  const overCap = pv > 0 && Math.max(buyTotal, sellTotal) / pv * 100 > capPct;
  const canSend = basket.length > 0 && checked && (!overCap || typed.trim().toUpperCase() === "CONFIRM");

  const asText = () => basket.map((t) => `${t.side} ${t.qty} ${t.symbol} (${t.exchange}) ${t.otype === "LIMIT" ? `LIMIT @ ${t.price}` : "MARKET"} ${t.product}`).join("\n");
  const copyBasket = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      setMsg("Basket copied.");
    } catch {
      setMsg("Could not copy — select the text in the basket instead.");
    }
  };
  const openInKite = () => {
    if (!apiKey.trim() || !canSend) return;
    const data = basket.map((t) => ({
      variety: "regular",
      tradingsymbol: t.symbol,
      exchange: t.exchange,
      transaction_type: t.side,
      order_type: t.otype,
      quantity: t.qty,
      product: t.product,
      ...(t.otype === "LIMIT" ? { price: t.price } : {}),
      readonly: false,
      tag: "tradedesk",
    }));
    const f = document.createElement("form");
    f.method = "POST";
    f.action = "https://kite.zerodha.com/connect/basket";
    f.target = "_blank";
    for (const [k, v] of [["api_key", apiKey.trim()], ["data", JSON.stringify(data)]]) {
      const i = document.createElement("input");
      i.type = "hidden";
      i.name = k;
      i.value = v;
      f.appendChild(i);
    }
    document.body.appendChild(f);
    f.submit();
    f.remove();
    setMsg("Basket sent to Kite's order window in a new tab — confirm it there. Nothing was placed from this page.");
  };

  if (!ready) return <ScreenerLoading label="holdings" />;

  const input = "px-2 py-1.5 border border-slate-300 rounded text-sm bg-transparent";
  const chip = (on: boolean) => `px-2.5 py-1 rounded-full border text-xs ${on ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-3 mb-1">
        <h1 className="text-lg font-semibold">🛒 Trade Desk</h1>
        <span className="text-xs text-slate-500">
          Prepare buy / sell orders, then confirm them in Kite · holdings as of {pf?.as_of ?? "—"} (last PF update){quoteAt ? ` · live prices ${quoteAt}` : ""}
        </span>
      </div>
      <div className="my-3 text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded px-3 py-2">
        <b>This page does not place orders.</b> It builds a basket; "Open basket in Kite" sends it to Kite's own order window, where you log in and press the final confirm. Check
        symbol, side, quantity and price there too. Real money — go slowly.
      </div>
      {err && <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">Problem: {err}</div>}
      {!pf && !err && <div className="text-sm text-slate-400">Loading your holdings…</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-5 items-start">
        {/* holdings */}
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h2 className="text-sm font-medium text-slate-700">Holdings ({shown.length})</h2>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter symbol…" className={`${input} w-40`} />
            <button onClick={refreshQuotes} disabled={loadingQ} className="text-xs px-2.5 py-1.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-50">
              {loadingQ ? "fetching…" : "⟳ Refresh live prices"}
            </button>
            <span className="text-[11px] text-slate-400">portfolio value ₹{fmtNum(pv, 0)} at the last PF update</span>
          </div>
          <div className="border border-slate-200 rounded-lg overflow-auto max-h-[38rem]">
            <table className="w-full text-xs tabular-nums border-collapse">
              <thead className="sticky top-0 bg-slate-100 text-slate-600">
                <tr>
                  <th className="text-left px-2 py-2">Symbol</th>
                  <th className="text-right px-2 py-2">Held</th>
                  <th className="text-right px-2 py-2">Avg</th>
                  <th className="text-right px-2 py-2">Price</th>
                  <th className="text-right px-2 py-2">P&amp;L %</th>
                  <th className="text-right px-2 py-2">Weight %</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((h) => (
                  <tr key={h.symbol} className={`border-t border-slate-100 ${h.symbol === sym ? "bg-indigo-50" : ""}`}>
                    <td className="px-2 py-1.5 font-medium whitespace-nowrap">
                      {h.symbol} {h.isFund && <span className="text-[10px] text-slate-400">ETF</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right">{fmtNum(h.qty, 0)}</td>
                    <td className="px-2 py-1.5 text-right text-slate-600">{h.avg ? fmtNum(h.avg, 2) : "—"}</td>
                    <td className="px-2 py-1.5 text-right">
                      {h.ltp ? fmtNum(h.ltp, 2) : "—"} {quotes[h.symbol] && <span className="text-[10px] text-emerald-600">●</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right">{h.pnl == null ? "—" : <Signed v={h.pnl} digits={1} />}</td>
                    <td className="px-2 py-1.5 text-right text-slate-600">{fmtNum(h.weight, 2)}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <button onClick={() => pickFrom(h, "BUY")} className="px-2 py-0.5 rounded border border-emerald-500 text-emerald-700 hover:bg-emerald-50 mr-1">Buy</button>
                      <button onClick={() => pickFrom(h, "SELL")} className="px-2 py-0.5 rounded border border-red-400 text-red-700 hover:bg-red-50">Sell</button>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-slate-400">No holdings loaded — run the PF update first.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ticket + basket */}
        <div className="space-y-4 xl:sticky xl:top-4">
          <div id="td-ticket" className="p-4 border border-slate-200 rounded-lg">
            <div className="flex gap-2 mb-3">
              <button onClick={() => setSide("BUY")} className={`flex-1 py-2 rounded-lg font-semibold text-sm border ${side === "BUY" ? "bg-emerald-600 text-white border-emerald-600" : "border-slate-300 text-slate-600"}`}>
                BUY
              </button>
              <button onClick={() => setSide("SELL")} className={`flex-1 py-2 rounded-lg font-semibold text-sm border ${side === "SELL" ? "bg-red-600 text-white border-red-600" : "border-slate-300 text-slate-600"}`}>
                SELL
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              <input
                list="td-syms"
                value={symbol}
                onChange={(e) => {
                  setSymbol(e.target.value.toUpperCase());
                  const h = heldMap.get(e.target.value.trim().toUpperCase());
                  if (h) setExchange(h.exchange);
                }}
                placeholder="Symbol, e.g. RPEL"
                className={`${input} flex-1 min-w-[10rem] font-semibold`}
              />
              <datalist id="td-syms">{held.map((h) => <option key={h.symbol} value={h.symbol} />)}</datalist>
              <select value={exchange} onChange={(e) => setExchange(e.target.value)} className={input}>
                <option>NSE</option>
                <option>BSE</option>
              </select>
              <select value={product} onChange={(e) => setProduct(e.target.value as Product)} className={input} title="CNC = delivery with your own money, MTF = margin trading facility">
                <option value="CNC">CNC</option>
                <option value="MTF">MTF</option>
              </select>
            </div>

            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-slate-500 w-14">Quantity</span>
              {[-10, -1].map((d) => (
                <button key={d} onClick={() => setQty((v) => Math.max(0, v + d))} className="w-9 h-9 rounded border border-slate-300 text-sm hover:bg-slate-50">{d}</button>
              ))}
              <input type="number" min={0} value={qty || ""} onChange={(e) => setQty(Math.max(0, Math.floor(parseFloat(e.target.value) || 0)))} className={`${input} w-24 text-center text-base font-semibold`} placeholder="0" />
              {[1, 10].map((d) => (
                <button key={d} onClick={() => setQty((v) => v + d)} className="w-9 h-9 rounded border border-slate-300 text-sm hover:bg-slate-50">+{d}</button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mb-3 text-xs">
              <span className="text-slate-500 w-14">Quick</span>
              {side === "SELL"
                ? [25, 50, 75, 100].map((p) => (
                    <button key={p} onClick={() => setQty(p === 100 ? heldQty : Math.floor((heldQty * p) / 100))} className={chip(false)}>{p === 100 ? "all" : `${p}%`}</button>
                  ))
                : [0.25, 0.5, 1, 2].map((w) => (
                    <button key={w} onClick={() => setQty(qtyFromWeight(w))} className={chip(false)} title="quantity that makes this order that share of the portfolio">{w}% of portfolio</button>
                  ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-xs text-slate-500 w-14">Price</span>
              <button onClick={() => setOtype("MARKET")} className={chip(otype === "MARKET")}>Market</button>
              <button onClick={() => setOtype("LIMIT")} className={chip(otype === "LIMIT")}>Limit</button>
              {otype === "LIMIT" && <input type="number" step="0.05" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={mkt ? fmtNum(mkt, 2) : "price"} className={`${input} w-28`} />}
              <span className="text-xs text-slate-400">last price {mkt ? `₹${fmtNum(mkt, 2)}` : "—"}{live ? " (live)" : cur ? " (PF update)" : ""}</span>
            </div>

            {sym && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs space-y-0.5 mb-3">
                <div className="flex justify-between"><span className="text-slate-500">Order value</span><b>{value ? R(value) : "—"}{value && pv ? ` · ${fmtNum(value / pv * 100, 2)}% of portfolio` : ""}</b></div>
                <div className="flex justify-between"><span className="text-slate-500">You hold now</span><span>{heldQty ? `${fmtNum(heldQty, 0)} @ ₹${cur?.avg ? fmtNum(cur.avg, 2) : "—"} · ${fmtNum(cur?.weight ?? 0, 2)}%` : "none"}</span></div>
                {qty > 0 && px && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">After this order</span>
                    <span>
                      {side === "BUY"
                        ? `${fmtNum(heldQty + qty, 0)} sh · ${fmtNum(((heldQty + qty) * px) / (pv + value) * 100, 2)}%`
                        : `${fmtNum(Math.max(0, heldQty - qty), 0)} sh · ${fmtNum((Math.max(0, heldQty - qty) * px) / pv * 100, 2)}%`}
                    </span>
                  </div>
                )}
                {side === "SELL" && qty > 0 && px && cur?.avg && (
                  <div className="flex justify-between"><span className="text-slate-500">Approx. P&amp;L on this sale</span><b className={px >= cur.avg ? "text-emerald-600" : "text-red-600"}>{R(Math.min(qty, heldQty) * (px - cur.avg))}</b></div>
                )}
              </div>
            )}
            {warnings.length > 0 && (
              <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 list-disc pl-6 space-y-0.5 mb-3">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            )}
            <button onClick={addToBasket} disabled={!sym || qty <= 0} className={`w-full py-2.5 rounded-lg text-sm font-semibold ${sym && qty > 0 ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
              ＋ Add to basket
            </button>
            {msg && <div className="mt-2 text-xs text-slate-600">{msg}</div>}
          </div>

          <div className="p-4 border border-slate-200 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-sm font-medium text-slate-700">Basket ({basket.length})</h2>
              {basket.length > 0 && <button onClick={() => { setBasket([]); setChecked(false); setTyped(""); }} className="ml-auto text-xs text-slate-500 hover:underline">clear</button>}
            </div>
            {basket.length === 0 ? (
              <div className="text-xs text-slate-400">Nothing yet — pick a holding or type a symbol, set the quantity, press Add.</div>
            ) : (
              <>
                <table className="w-full text-xs tabular-nums mb-2">
                  <tbody>
                    {basket.map((t) => (
                      <tr key={t.id} className="border-t border-slate-100">
                        <td className="py-1.5"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${t.side === "BUY" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{t.side}</span></td>
                        <td className="py-1.5 font-medium">{t.symbol}</td>
                        <td className="py-1.5 text-right">{fmtNum(t.qty, 0)}</td>
                        <td className="py-1.5 text-right text-slate-500">{t.otype === "LIMIT" ? `@${fmtNum(t.price, 2)}` : "mkt"} · {t.product}</td>
                        <td className="py-1.5 text-right">{R(t.est)}</td>
                        <td className="py-1.5 text-right"><button onClick={() => setBasket((b) => b.filter((x) => x.id !== t.id))} className="text-slate-400 hover:text-red-600">✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-xs text-slate-600 mb-3">
                  Buys {R(buyTotal)} · Sells {R(sellTotal)} · Net {buyTotal - sellTotal >= 0 ? "out" : "in"} {R(Math.abs(buyTotal - sellTotal))}
                </div>
                <label className="flex items-start gap-2 text-xs text-slate-700 mb-2">
                  <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5" />
                  <span>I have checked each symbol, side, quantity and price above.</span>
                </label>
                {overCap && (
                  <div className="mb-2">
                    <div className="text-xs text-amber-800 mb-1">This basket is over your {capPct}% size cap — type <b>CONFIRM</b> to continue.</div>
                    <input value={typed} onChange={(e) => setTyped(e.target.value)} className={`${input} w-32`} placeholder="CONFIRM" />
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={openInKite} disabled={!canSend || !apiKey.trim()} className={`flex-1 py-2.5 rounded-lg text-sm font-semibold ${canSend && apiKey.trim() ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
                    Open basket in Kite ↗
                  </button>
                  <button onClick={copyBasket} className="px-3 py-2.5 rounded-lg text-sm border border-slate-300 text-slate-600 hover:bg-slate-50">Copy</button>
                </div>
                {!apiKey.trim() && <div className="text-[11px] text-slate-500 mt-1.5">Add your Kite API key below to enable the Kite button — until then use Copy and place the orders in Kite by hand.</div>}
              </>
            )}
          </div>

          <div className="p-4 border border-slate-200 rounded-lg text-xs space-y-2">
            <div className="text-sm font-medium text-slate-700">Settings</div>
            <label className="flex flex-col gap-1 text-slate-600">
              Kite API key <span className="text-slate-400">(the public key of your Kite Connect app — not the secret)</span>
              <input value={apiKey} onChange={(e) => { setApiKey(e.target.value); lsSet("kite-api-key", e.target.value); }} className={`${input} w-full`} placeholder="paste the api_key" />
            </label>
            <label className="flex items-center gap-2 text-slate-600">
              Size cap per basket
              <input type="number" step="0.5" value={capPct} onChange={(e) => { const v = parseFloat(e.target.value) || 0; setCapPct(v); lsSet("td-cap-pct", String(v)); }} className={`${input} w-20`} /> % of portfolio
            </label>
            <div className="text-slate-400">Both are saved in this browser only.</div>
          </div>
        </div>
      </div>

      <MethodologyNote>
        <p>
          <b>What it does:</b> lists your holdings from the last PF update (quantity, average cost, price, weight) and lets you build buy / sell tickets with a side toggle, quantity buttons, quick sizes (a share of the holding when selling, a share of
          the portfolio when buying), market or limit price and CNC / MTF. The preview shows the order value, what you will hold afterwards and your approximate P&amp;L on a sale. Warnings flag selling more than you own, a limit price far from the last price,
          and orders above your size cap.
        </p>
        <p>
          <b>What it does not do:</b> send anything. "Open basket in Kite" posts the basket to Kite Publisher (<code>kite.zerodha.com/connect/basket</code>) using your app's public API key; Kite shows the orders and you confirm there. No broker secret, password
          or access token is stored in this app. <b>Untested against a live account</b> — Kite may require the app's redirect URL to match this site, and a stock traded in the trade-for-trade series needs its exact Kite symbol (for example <code>NAME-BE</code>). Try
          it first with one tiny order. Trades you place appear in the Trade Journal after the next PF update, with the reason owed.
        </p>
        <p>
          Prices are as of the last PF update until you press <b>Refresh live prices</b> (Yahoo quotes — Indian stocks are live, a few minutes' lag is possible). Quantities are shares, not rupees. See also the <Link to="/trade-journal" className="underline">Trade Journal</Link>.
        </p>
      </MethodologyNote>
    </div>
  );
}
