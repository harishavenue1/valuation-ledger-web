import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Signed } from "../components/ScreenerTable";
import { api } from "../lib/api";
import { Item, TAG_CLASS, TAG_ORDER, chartPath, fmtCr, storyStats, tvUrl, useBusinessData } from "../lib/businessData";

// Company tab — one company's business in one place: what it does (Screener.in's About + Key Points),
// growth record, strengths/watch-outs, concall + presentation links, and the recent catalysts from the Radar.

interface Profile {
  symbol: string;
  name?: string;
  about?: string;
  key_points?: string;
  pros?: string[];
  cons?: string[];
  ratios?: Record<string, string>;
  growth?: Record<string, Record<string, string>>;
  classification?: string[];
  concalls?: { date: string; links: Record<string, string> }[];
  website?: string | null;
  fetched?: string;
  error?: string;
}

export default function CompanyProfile() {
  const [params, setParams] = useSearchParams();
  const symbol = (params.get("symbol") ?? "").toUpperCase();
  const { radar, tech } = useBusinessData();
  const [input, setInput] = useState(symbol);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => setInput(symbol), [symbol]);
  useEffect(() => {
    if (!symbol) return;
    let off = false;
    setProfile(null);
    setItems(null);
    setErr(null);
    setLoading(true);
    api
      .getBusinessProfile(symbol)
      .then((p) => !off && setProfile(p))
      .catch((e: any) => !off && setErr(String(e?.message ?? e)))
      .finally(() => !off && setLoading(false));
    api
      .getBusinessRadarSymbol(symbol)
      .then((r) => !off && setItems(r.items))
      .catch(() => !off && setItems([]));
    return () => {
      off = true;
    };
  }, [symbol]);

  const choices = useMemo(() => {
    const m = new Map<string, string>();
    for (const [s, n] of Object.entries(radar?.names ?? {})) m.set(s, n);
    for (const [s, r] of tech.entries()) if (!m.has(s) && r.name) m.set(s, r.name);
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [radar, tech]);

  function go(e: React.FormEvent) {
    e.preventDefault();
    const raw = input.trim().toUpperCase();
    if (!raw) return;
    const hit = choices.find(([s, n]) => s === raw || n.toUpperCase() === raw)?.[0] ?? raw;
    setParams({ tab: "company", symbol: hit });
  }

  const t = tech.get(symbol);
  const st = useMemo(() => (items ? storyStats(items, 0, 120, Date.now()) : null), [items]);
  const sector = radar?.sectors?.[symbol] || profile?.classification?.[0] || "";
  const keyPts = profile?.key_points?.trim();

  return (
    <div>
      <form onSubmit={go} className="flex flex-wrap items-center gap-2 mb-4">
        <input
          list="biz-companies"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ticker or company name, e.g. HFCL"
          className="px-2 py-1.5 text-sm border border-slate-300 rounded bg-white w-72"
        />
        <datalist id="biz-companies">
          {choices.slice(0, 4000).map(([s, n]) => (
            <option key={s} value={s}>
              {n}
            </option>
          ))}
        </datalist>
        <button className="text-sm px-3 py-1.5 rounded border border-indigo-300 text-indigo-700 bg-indigo-50 hover:border-indigo-500 font-medium">Open</button>
        <span className="text-xs text-slate-500">Business text comes from the company's Screener.in page (cached for a week); catalysts come from the Radar.</span>
      </form>

      {!symbol && <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded p-4">Pick a company above, or click any ticker on the Radar or Sectors tab.</div>}
      {loading && <div className="text-sm text-slate-500">Loading {symbol}…</div>}
      {err && <div className="text-sm text-red-600">Could not load the profile: {err}</div>}

      {symbol && profile && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-lg font-semibold">
              {symbol} <span className="font-normal text-slate-500 text-base">{profile.name ?? radar?.names?.[symbol] ?? ""}</span>
            </h2>
            {t?.price != null && (
              <span className="text-sm">
                <Link to={chartPath(symbol)} className="text-indigo-600 hover:underline" title="Internal chart">
                  ₹{t.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </Link>{" "}
                {t.change_pct != null && <Signed v={t.change_pct} digits={1} />}
              </span>
            )}
            <a href={tvUrl(symbol)} target="_blank" rel="noreferrer" className="text-xs text-slate-500 hover:text-slate-700">
              TradingView ↗
            </a>
            {profile.website && (
              <a href={profile.website} target="_blank" rel="noreferrer" className="text-xs text-slate-500 hover:text-slate-700">
                Website ↗
              </a>
            )}
            <a href={`https://www.screener.in/company/${symbol}/`} target="_blank" rel="noreferrer" className="text-xs text-slate-500 hover:text-slate-700">
              Screener ↗
            </a>
            {sector && <span className="text-xs px-2 py-0.5 rounded-full border border-slate-300 text-slate-600">{sector}</span>}
            {t && (
              <span className="text-xs text-slate-500">
                3M <Signed v={t.three_month_pct} digits={0} /> · wRSI {t.rsi_w != null ? Number(t.rsi_w).toFixed(0) : "–"}
                {t.dc_state ? ` · DC27W ${t.dc_state}` : ""}
              </span>
            )}
          </div>

          {profile.error && <div className="text-sm text-amber-700">{profile.error}</div>}

          {profile.ratios && Object.keys(profile.ratios).length > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {Object.entries(profile.ratios).map(([k, v]) => (
                <span key={k}>
                  <span className="text-slate-500">{k}</span> <b>{v}</b>
                </span>
              ))}
            </div>
          )}

          {profile.growth && Object.keys(profile.growth).length > 0 && (
            <section>
              <h3 className="text-sm font-semibold mb-1">Growth record</h3>
              <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                {Object.entries(profile.growth).map(([title, rows]) => (
                  <div key={title} className="border border-slate-200 rounded p-2">
                    <div className="text-xs text-slate-500 mb-1">{title}</div>
                    {Object.entries(rows).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-sm">
                        <span className="text-slate-500">{k}</span>
                        <span className="font-medium">{v}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          )}

          {(profile.about || keyPts) && (
            <section>
              <h3 className="text-sm font-semibold mb-1">The business</h3>
              {profile.about && <p className="text-sm whitespace-pre-line max-w-4xl">{profile.about}</p>}
              {keyPts && (
                <details open className="mt-2">
                  <summary className="cursor-pointer text-xs text-slate-500">Key points (segments, capacity, strategy as the company describes them)</summary>
                  <div className="text-sm whitespace-pre-line max-w-4xl mt-1 text-slate-700">{keyPts}</div>
                </details>
              )}
            </section>
          )}

          {((profile.pros?.length ?? 0) > 0 || (profile.cons?.length ?? 0) > 0) && (
            <section className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold mb-1 text-emerald-700">Strengths</h3>
                <ul className="text-sm list-disc pl-5 space-y-0.5">{(profile.pros ?? []).map((p, i) => <li key={i}>{p}</li>)}</ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-1 text-red-700">Watch-outs</h3>
                <ul className="text-sm list-disc pl-5 space-y-0.5">{(profile.cons ?? []).map((p, i) => <li key={i}>{p}</li>)}</ul>
              </div>
            </section>
          )}

          <section>
            <h3 className="text-sm font-semibold mb-1">What management said — concalls &amp; presentations</h3>
            {(profile.concalls?.length ?? 0) === 0 ? (
              <div className="text-sm text-slate-500">No concall links on the company's page.</div>
            ) : (
              <ul className="text-sm space-y-1">
                {profile.concalls!.map((c, i) => (
                  <li key={i} className="flex gap-3 items-baseline">
                    <span className="w-20 text-slate-500 shrink-0">{c.date}</span>
                    {Object.entries(c.links).map(([label, href]) => (
                      <a key={label} href={href} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                        {label}
                      </a>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-1">Recent catalysts</h3>
            {st && (
              <div className="flex flex-wrap items-center gap-1.5 mb-2 text-xs text-slate-500">
                <span>Last 120 days: {st.stories} stories · score {st.score.toFixed(1)}{st.valueCr ? ` · ₹${fmtCr(st.valueCr)} Cr in orders/capex/deals` : ""}</span>
                {TAG_ORDER.filter((g) => st.tagCounts[g]).map((g) => (
                  <span key={g} className={`px-1.5 py-0.5 rounded border ${TAG_CLASS[g]}`}>
                    {g} {st.tagCounts[g]}
                  </span>
                ))}
              </div>
            )}
            {items === null ? (
              <div className="text-sm text-slate-500">Loading…</div>
            ) : items.length === 0 ? (
              <div className="text-sm text-slate-500">Nothing collected for this company yet.</div>
            ) : (
              <ul className="space-y-1.5">
                {items.map((i, k) => (
                  <li key={k} className="flex gap-2 items-baseline text-sm">
                    <span className="text-xs text-slate-400 w-20 shrink-0">{i.d}</span>
                    <span className="flex flex-wrap gap-1 shrink-0">
                      {i.g.map((g) => (
                        <span key={g} className={`text-[10px] px-1 rounded border ${TAG_CLASS[g]}`}>
                          {g}
                        </span>
                      ))}
                    </span>
                    {i.u ? (
                      <a href={i.u} target="_blank" rel="noreferrer" className="hover:underline">
                        {i.t}
                      </a>
                    ) : (
                      <span>{i.t}</span>
                    )}
                    {i.a != null && <span className="text-xs text-slate-500 shrink-0">₹{fmtCr(i.a)} Cr</span>}
                    <span className="text-xs text-slate-400 shrink-0">{i.s}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
