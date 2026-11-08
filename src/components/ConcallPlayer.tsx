import { useCallback, useEffect, useRef, useState } from "react";
import { buildScript, chunkify, type SpeakMode, type SpeakRow } from "../lib/concallSpeech";

// Read-aloud player for /concall-summary.
// First choice: pre-generated neural-voice MP3s in /audio (made by the ConcallSummary skill's make_audio.py, listed in /audio/manifest.json).
// Fallback when a holding has no matching MP3: the browser's own (mechanical) speech engine, see lib/concallSpeech.ts.

const ls = {
  get: (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

type Man = { items: Record<string, Partial<Record<SpeakMode, { file: string; key: string; headline: string; call_date: string }>>> };
let manP: Promise<Man | null> | null = null;
const loadManifest = () => (manP ??= fetch("/audio/manifest.json").then((r) => (r.ok ? r.json() : null)).catch(() => null));

interface Cur { i: number; n: number; symbol: string; paused: boolean; via: "audio" | "voice"; pos: number; len: number }
export type PlayRow = SpeakRow & { symbol: string };

export function useConcallSpeech() {
  const supported = typeof window !== "undefined";
  const synth = supported && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined" ? window.speechSynthesis : null;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [man, setMan] = useState<Man | null>(null);
  const [rate, setRateS] = useState(() => ls.get("cc_rate", "1"));
  const [mode, setModeS] = useState<SpeakMode>(() => (ls.get("cc_mode", "brief") === "full" ? "full" : "brief"));
  const [voiceURI, setVoiceS] = useState(() => ls.get("cc_voice", ""));
  const [cur, setCur] = useState<Cur | null>(null);
  const tok = useRef(0);
  const queue = useRef<PlayRow[]>([]);
  const keep = useRef<SpeechSynthesisUtterance | null>(null); // stops the browser from garbage-collecting the utterance mid-speech
  const au = useRef<HTMLAudioElement | null>(null);
  const warm = useRef<HTMLAudioElement | null>(null);
  const curRef = useRef<Cur | null>(null); curRef.current = cur;
  const rateRef = useRef(rate); rateRef.current = rate;
  const modeRef = useRef(mode); modeRef.current = mode;
  const voicesRef = useRef(voices); voicesRef.current = voices;
  const voiceRef = useRef(voiceURI); voiceRef.current = voiceURI;
  const manRef = useRef(man); manRef.current = man;

  useEffect(() => { loadManifest().then(setMan); }, []);
  useEffect(() => {
    if (!synth) return;
    const load = () => setVoices(synth.getVoices().filter((v) => /^en/i.test(v.lang)));
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => synth.removeEventListener?.("voiceschanged", load);
  }, [synth]);
  useEffect(() => { if (au.current) au.current.playbackRate = Number(rate) || 1; }, [rate]);
  useEffect(() => () => { tok.current++; synth?.cancel(); au.current?.pause(); }, [synth]);

  // The MP3 for this holding, only if it was made from the summary now on the page (same headline and call date).
  const audioUrl = (r: PlayRow): string | null => {
    const it = manRef.current?.items?.[r.symbol];
    if (!it) return null;
    const order: SpeakMode[] = modeRef.current === "full" ? ["full", "brief"] : ["brief", "full"];
    for (const m of order) { const e = it[m]; if (e && e.headline === r.headline && e.call_date === r.call_date) return `/audio/${e.file}?v=${e.key}`; }
    return null;
  };

  const pickVoice = () => {
    const vs = voicesRef.current;
    return vs.find((v) => v.voiceURI === voiceRef.current) ?? vs.find((v) => /en[-_]IN/i.test(v.lang)) ?? vs.find((v) => /en[-_]GB/i.test(v.lang)) ?? vs[0];
  };

  const runItem = useCallback((i: number, t: number) => {
    if (t !== tok.current) return;
    const row = queue.current[i];
    if (!row) { setCur(null); return; }
    const n = queue.current.length;
    const advance = () => { if (t !== tok.current) return; if (i + 1 < n) runItem(i + 1, t); else setCur(null); };

    const speakFallback = () => {
      if (!synth) { advance(); return; }
      const chunks = chunkify(buildScript(row, modeRef.current, n > 1 ? i + 1 : undefined, n > 1 ? n : undefined));
      setCur({ i, n, symbol: row.symbol, paused: false, via: "voice", pos: 0, len: chunks.length });
      const step = (c: number) => {
        if (t !== tok.current) return;
        if (c >= chunks.length) { advance(); return; }
        const u = new SpeechSynthesisUtterance(chunks[c]);
        u.rate = Number(rateRef.current) || 1;
        const v = pickVoice();
        if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "en-IN";
        u.onend = () => step(c + 1);
        u.onerror = (e) => { if (t !== tok.current || e.error === "canceled" || e.error === "interrupted") return; step(c + 1); };
        keep.current = u;
        setCur((p) => (p && p.symbol === row.symbol ? { ...p, pos: c } : p));
        synth.speak(u);
      };
      step(0);
    };

    const url = audioUrl(row);
    if (!url) { speakFallback(); return; }
    const a = warm.current && warm.current.src.endsWith(url) ? warm.current : new Audio(url);
    warm.current = null;
    a.playbackRate = Number(rateRef.current) || 1;
    au.current = a;
    setCur({ i, n, symbol: row.symbol, paused: false, via: "audio", pos: 0, len: 1 });
    a.ontimeupdate = () => { if (t === tok.current && a.duration) setCur((p) => (p && p.symbol === row.symbol ? { ...p, pos: a.currentTime, len: a.duration } : p)); };
    a.onended = () => { au.current = null; advance(); };
    a.onerror = () => { if (t === tok.current) { au.current = null; speakFallback(); } };
    a.play().catch(() => { if (t === tok.current && au.current === a) { au.current = null; speakFallback(); } });
    const nx = queue.current[i + 1]; const nu = nx && audioUrl(nx);
    if (nu) { const w = new Audio(nu); w.preload = "auto"; warm.current = w; }
  }, [synth]);

  const play = useCallback((rows: PlayRow[], start = 0) => {
    if (!rows.length) return;
    const t = ++tok.current;
    synth?.cancel(); au.current?.pause(); au.current = null;
    queue.current = rows;
    setTimeout(() => runItem(start, t), 60);
  }, [synth, runItem]);

  const stop = useCallback(() => { tok.current++; synth?.cancel(); au.current?.pause(); au.current = null; setCur(null); }, [synth]);
  const pause = useCallback(() => { if (au.current) au.current.pause(); else synth?.pause(); setCur((p) => (p ? { ...p, paused: true } : p)); }, [synth]);
  const resume = useCallback(() => { if (au.current) void au.current.play(); else synth?.resume(); setCur((p) => (p ? { ...p, paused: false } : p)); }, [synth]);
  const jump = useCallback((d: number) => {
    const p = curRef.current;
    if (p && queue.current[p.i + d]) play(queue.current, p.i + d);
  }, [play]);
  const seek = useCallback((d: number) => { const a = au.current; if (a && a.duration) a.currentTime = Math.max(0, Math.min(a.duration - 0.5, a.currentTime + d)); }, []);

  const hasAudio = !!man && Object.keys(man.items ?? {}).length > 0;
  return {
    supported: supported && (hasAudio || !!synth), hasAudio, voices, cur, rate, mode, voiceURI,
    setRate: (v: string) => { setRateS(v); ls.set("cc_rate", v); },
    setMode: (v: SpeakMode) => { setModeS(v); ls.set("cc_mode", v); },
    setVoice: (v: string) => { setVoiceS(v); ls.set("cc_voice", v); },
    play, stop, pause, resume, seek, next: () => jump(1), prev: () => jump(-1),
  };
}

type Speech = ReturnType<typeof useConcallSpeech>;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function PlayerControls({ s, count, onAll }: { s: Speech; count: number; onAll: () => void }) {
  if (!s.supported) return <span className="text-xs text-slate-400">Audio is not available in this browser.</span>;
  const sel = "border border-slate-300 rounded px-1.5 py-0.5 text-xs bg-white";
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
      <button onClick={onAll} disabled={!count} className="px-2.5 py-1 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">🔊 Listen to all shown ({count})</button>
      <label className="text-slate-500">Length <select value={s.mode} onChange={(e) => s.setMode(e.target.value as SpeakMode)} className={sel}><option value="brief">Brief (about 2-3 min each)</option><option value="full">Full (about 8-10 min each)</option></select></label>
      <label className="text-slate-500">Speed <select value={s.rate} onChange={(e) => s.setRate(e.target.value)} className={sel}>{["0.8", "1", "1.15", "1.3", "1.5", "1.75", "2"].map((r) => <option key={r} value={r}>{r}×</option>)}</select></label>
      {!s.hasAudio && s.voices.length > 1 && (
        <label className="text-slate-500">Voice <select value={s.voiceURI} onChange={(e) => s.setVoice(e.target.value)} className={`${sel} max-w-[11rem]`}><option value="">Auto</option>{s.voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}</select></label>
      )}
      <span className="text-slate-400">{s.hasAudio ? "Natural voice. Quotes are not read; they stay on screen for checking. A holding without a fresh recording falls back to the browser voice." : "Browser voice (no recordings found). Quotes are not read."}</span>
    </div>
  );
}

export function PlayerBar({ s, label }: { s: Speech; label: string }) {
  const c = s.cur;
  if (!c) return null;
  const btn = "px-2 py-1 rounded hover:bg-white/20 disabled:opacity-30";
  const aud = c.via === "audio";
  const pct = c.len ? Math.min(100, Math.round(((aud ? c.pos : c.pos + 1) / c.len) * 100)) : 0;
  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 w-[min(94vw,40rem)] rounded-xl bg-slate-900 text-white shadow-xl px-3 py-2">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{c.paused ? "⏸ Paused" : "🔊 Reading"} · {label}</div>
          <div className="text-[11px] text-slate-400">{c.n > 1 ? `Holding ${c.i + 1} of ${c.n}` : "Single holding"} · {aud ? `${mmss(c.pos)} / ${mmss(c.len)} · natural voice` : "browser voice"} · {s.rate}×</div>
        </div>
        <button className={btn} onClick={s.prev} disabled={c.i === 0} title="Previous holding">⏮</button>
        {aud && <button className={btn} onClick={() => s.seek(-15)} title="Back 15 seconds">↺15</button>}
        <button className={btn} onClick={c.paused ? s.resume : s.pause} title={c.paused ? "Resume" : "Pause"}>{c.paused ? "▶" : "⏸"}</button>
        {aud && <button className={btn} onClick={() => s.seek(15)} title="Forward 15 seconds">15↻</button>}
        <button className={btn} onClick={s.next} disabled={c.i + 1 >= c.n} title="Next holding">⏭</button>
        <button className={btn} onClick={s.stop} title="Stop">⏹</button>
      </div>
      <div className="mt-1.5 h-1 rounded bg-white/20 overflow-hidden"><div className="h-full bg-indigo-400" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
