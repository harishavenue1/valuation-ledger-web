import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import RunButton from "../components/RunButton";
import { buildMatchers, chartPath, companyPath, findMentions, useBusinessData } from "../lib/businessData";

// Tweets tab — the accounts you follow for ideas, in one feed (no scrolling the timeline). The tweets are
// stored by api/_fintwit.py; they are loaded by whatever fetches X (see the note shown when the feed is empty).

interface Tweet {
  id: string;
  h: string;
  n: string;
  t: string;
  d: string;
  k: string;
  likes?: number | null;
  rts?: number | null;
  views?: number | null;
  img?: boolean;
}
interface Feed {
  tweets: Tweet[];
  handles: Record<string, string>;
  updated?: string;
}

const KIND_LABEL: Record<string, string> = { post: "Posts", quote: "Quotes", reply: "Replies", repost: "Reposts" };
const COLORS = ["#2a78d6", "#eb6834", "#2f9e6e", "#9b5de5", "#d6a72a", "#1b9aaa", "#c44569", "#6c7a89", "#8a6d3b", "#4a7c59"];
const URL_RX = /(https?:\/\/[^\s]+)/g;

function fmtN(n?: number | null): string {
  if (n == null) return "";
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
}
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const diff = Math.floor((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  const base = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  return diff === 0 ? `Today · ${base}` : diff === 1 ? `Yesterday · ${base}` : base;
}
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_RX).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline break-all">
            {part.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export default function Tweets() {
  const { radar, tech } = useBusinessData();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [who, setWho] = useState<Set<string>>(new Set());
  const [kinds, setKinds] = useState<Set<string>>(new Set(["post", "quote"]));
  const [days, setDays] = useState(7);
  const [q, setQ] = useState("");
  const [onlyStocks, setOnlyStocks] = useState(false);

  useEffect(() => {
    api.getFintwit().then(setFeed).catch((e: any) => setErr(String(e?.message ?? e)));
  }, []);

  const matchers = useMemo(() => buildMatchers(radar, tech), [radar, tech]);
  function mentions(text: string): string[] {
    return findMentions(text, matchers).slice(0, 6);
  }

  const handles = useMemo(() => Object.entries(feed?.handles ?? {}), [feed]);
  const colorOf = useMemo(() => {
    const m: Record<string, string> = {};
    handles.forEach(([h], i) => (m[h] = COLORS[i % COLORS.length]));
    return m;
  }, [handles]);

  const rows = useMemo(() => {
    if (!feed) return [];
    const cutoff = Date.now() - days * 86400000;
    const needle = q.trim().toLowerCase();
    return feed.tweets
      .filter((t) => new Date(t.d).getTime() >= cutoff)
      .filter((t) => who.size === 0 || who.has(t.h))
      .filter((t) => kinds.has(t.k))
      .filter((t) => !needle || t.t.toLowerCase().includes(needle))
      .map((t) => ({ t, m: mentions(t.t) }))
      .filter((x) => !onlyStocks || x.m.length > 0);
  }, [feed, who, kinds, days, q, onlyStocks, matchers]);

  const byDay = useMemo(() => {
    const out: [string, typeof rows][] = [];
    for (const r of rows) {
      const k = r.t.d.slice(0, 10);
      const last = out[out.length - 1];
      if (last && last[0] === k) last[1].push(r);
      else out.push([k, [r]]);
    }
    return out;
  }, [rows]);

  const toggle = <T,>(set: Set<T>, v: T, setter: (s: Set<T>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    setter(n);
  };

  return (
    <div>
      <p className="text-xs text-slate-500 mb-3 max-w-4xl">
        The accounts you follow for ideas, in one feed, newest first — no scrolling the timeline. Tickers and company names inside a tweet link to the Business company page.
        {feed?.updated && <> Last loaded {new Date(feed.updated).toLocaleString("en-IN")}.</>}
        <span className="ml-3 align-middle"><RunButton screener="fintwit" /></span>
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        {handles.map(([h, n]) => (
          <button
            key={h}
            onClick={() => toggle(who, h, setWho)}
            className={`text-xs px-2 py-1 rounded-full border ${who.has(h) ? "text-white font-medium" : "border-slate-300 text-slate-500"}`}
            style={who.has(h) ? { background: colorOf[h], borderColor: colorOf[h] } : undefined}
            title={`@${h}`}
          >
            {n}
          </button>
        ))}
        {who.size > 0 && (
          <button onClick={() => setWho(new Set())} className="text-xs text-slate-500 underline">
            all
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
        <span className="text-xs text-slate-500">Window</span>
        {[1, 3, 7, 30].map((d) => (
          <button key={d} onClick={() => setDays(d)} className={`text-sm px-2.5 py-1 rounded-full border ${days === d ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600"}`}>
            {d === 1 ? "24h" : `${d}d`}
          </button>
        ))}
        <span className="mx-1 text-slate-300">|</span>
        {Object.entries(KIND_LABEL).map(([k, label]) => (
          <label key={k} className="flex items-center gap-1 text-slate-600 cursor-pointer">
            <input type="checkbox" checked={kinds.has(k)} onChange={() => toggle(kinds, k, setKinds)} /> {label}
          </label>
        ))}
        <label className="flex items-center gap-1 text-slate-600 cursor-pointer" title="Only tweets that mention a listed company or ticker">
          <input type="checkbox" checked={onlyStocks} onChange={(e) => setOnlyStocks(e.target.checked)} /> Mentions a stock
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tweets" className="px-2 py-1 text-sm border border-slate-300 rounded bg-white w-48" />
        <span className="text-xs text-slate-500">{rows.length} tweets</span>
      </div>

      {err && <div className="text-sm text-red-600">Could not load: {err}</div>}
      {!feed && !err && <div className="text-sm text-slate-500">Loading…</div>}
      {feed && feed.tweets.length === 0 && (
        <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded p-4 max-w-3xl">
          No tweets stored yet. X no longer offers a free way for a server to read tweets. Add an X API bearer token as the Vercel environment variable <code>X_BEARER_TOKEN</code> and this feed
          fills itself once a day (press "Run now" for the first pull).
        </div>
      )}

      <div className="max-w-3xl space-y-5">
        {byDay.map(([day, items]) => (
          <section key={day}>
            <div className="text-xs font-semibold text-slate-500 mb-2">{dayLabel(items[0].t.d)}</div>
            <ul className="space-y-3">
              {items.map(({ t, m }) => (
                <li key={t.id} className="border border-slate-200 rounded p-3" style={{ borderLeft: `3px solid ${colorOf[t.h] ?? "#999"}` }}>
                  <div className="flex flex-wrap items-baseline gap-2 text-xs mb-1">
                    <b className="text-slate-700 text-sm">{t.n}</b>
                    <a href={`https://x.com/${t.h}`} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-slate-600">
                      @{t.h}
                    </a>
                    <span className="text-slate-400">{timeLabel(t.d)}</span>
                    {t.k !== "post" && <span className="px-1 rounded border border-slate-300 text-slate-500">{t.k}</span>}
                    <a href={`https://x.com/${t.h}/status/${t.id}`} target="_blank" rel="noreferrer" className="ml-auto text-slate-400 hover:text-slate-600">
                      Open on X ↗
                    </a>
                  </div>
                  <div className="text-sm whitespace-pre-line">
                    <Linked text={t.t} />
                  </div>
                  {(m.length > 0 || t.likes != null || t.views != null) && (
                    <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
                      {m.map((s) => (
                        <span key={s} className="px-1.5 py-0.5 rounded border border-indigo-200 text-indigo-700">
                          <Link to={companyPath(s)} className="hover:underline">
                            {s}
                          </Link>
                          <Link to={chartPath(s)} className="ml-1 text-slate-400 hover:text-slate-600" title="Chart">
                            📈
                          </Link>
                        </span>
                      ))}
                      <span className="ml-auto text-slate-400">
                        {t.likes != null ? `♥ ${fmtN(t.likes)}` : ""} {t.rts != null ? `⟲ ${fmtN(t.rts)}` : ""} {t.views != null ? `👁 ${fmtN(t.views)}` : ""}
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
