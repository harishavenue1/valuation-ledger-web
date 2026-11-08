import { useCallback, useEffect, useRef, useState } from "react";
import { buildScript, chunkify, type SpeakMode, type SpeakRow } from "../lib/concallSpeech";

// Read-aloud player for /concall-summary. Browser speech engine only (see lib/concallSpeech.ts).

const ls = {
  get: (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

interface Cur { i: number; n: number; symbol: string; paused: boolean; chunk: number; chunks: number }

export function useConcallSpeech() {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  const synth = supported ? window.speechSynthesis : null;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [rate, setRateS] = useState(() => ls.get("cc_rate", "1"));
  const [mode, setModeS] = useState<SpeakMode>(() => (ls.get("cc_mode", "brief") === "full" ? "full" : "brief"));
  const [voiceURI, setVoiceS] = useState(() => ls.get("cc_voice", ""));
  const [cur, setCur] = useState<Cur | null>(null);
  const tok = useRef(0);
  const queue = useRef<SpeakRow[]>([]);
  const keep = useRef<SpeechSynthesisUtterance | null>(null); // stops the browser from garbage-collecting the utterance mid-speech
  const rateRef = useRef(rate); rateRef.current = rate;
  const modeRef = useRef(mode); modeRef.current = mode;
  const voicesRef = useRef(voices); voicesRef.current = voices;
  const voiceRef = useRef(voiceURI); voiceRef.current = voiceURI;

  useEffect(() => {
    if (!synth) return;
    const load = () => setVoices(synth.getVoices().filter((v) => /^en/i.test(v.lang)));
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => synth.removeEventListener?.("voiceschanged", load);
  }, [synth]);

  useEffect(() => () => { tok.current++; synth?.cancel(); }, [synth]);

  const pickVoice = () => {
    const vs = voicesRef.current;
    return vs.find((v) => v.voiceURI === voiceRef.current) ?? vs.find((v) => /en[-_]IN/i.test(v.lang)) ?? vs.find((v) => /en[-_]GB/i.test(v.lang)) ?? vs[0];
  };

  const runItem = useCallback((i: number, t: number) => {
    if (!synth || t !== tok.current) return;
    const row = queue.current[i];
    if (!row) { setCur(null); return; }
    const n = queue.current.length;
    const chunks = chunkify(buildScript(row, modeRef.current, n > 1 ? i + 1 : undefined, n > 1 ? n : undefined));
    setCur({ i, n, symbol: row.symbol, paused: false, chunk: 0, chunks: chunks.length });
    const step = (c: number) => {
      if (t !== tok.current) return;
      if (c >= chunks.length) { if (i + 1 < n) runItem(i + 1, t); else setCur(null); return; }
      const u = new SpeechSynthesisUtterance(chunks[c]);
      u.rate = Number(rateRef.current) || 1;
      const v = pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "en-IN";
      u.onend = () => step(c + 1);
      u.onerror = (e) => { if (t !== tok.current || e.error === "canceled" || e.error === "interrupted") return; step(c + 1); };
      keep.current = u;
      setCur((p) => (p && p.symbol === row.symbol ? { ...p, chunk: c } : p));
      synth.speak(u);
    };
    step(0);
  }, [synth]);

  const play = useCallback((rows: SpeakRow[], start = 0) => {
    if (!synth || !rows.length) return;
    const t = ++tok.current;
    synth.cancel();
    queue.current = rows;
    setTimeout(() => runItem(start, t), 60);
  }, [synth, runItem]);

  const stop = useCallback(() => { tok.current++; synth?.cancel(); setCur(null); }, [synth]);
  const pause = useCallback(() => { synth?.pause(); setCur((p) => (p ? { ...p, paused: true } : p)); }, [synth]);
  const resume = useCallback(() => { synth?.resume(); setCur((p) => (p ? { ...p, paused: false } : p)); }, [synth]);
  const curRef = useRef<Cur | null>(null); curRef.current = cur;
  const jump = useCallback((d: number) => {
    const p = curRef.current;
    if (p && queue.current[p.i + d]) play(queue.current, p.i + d);
  }, [play]);

  return {
    supported, voices, cur, rate, mode, voiceURI,
    setRate: (v: string) => { setRateS(v); ls.set("cc_rate", v); },
    setMode: (v: SpeakMode) => { setModeS(v); ls.set("cc_mode", v); },
    setVoice: (v: string) => { setVoiceS(v); ls.set("cc_voice", v); },
    play, stop, pause, resume, next: () => jump(1), prev: () => jump(-1),
  };
}

type Speech = ReturnType<typeof useConcallSpeech>;

export function PlayerControls({ s, count, onAll }: { s: Speech; count: number; onAll: () => void }) {
  if (!s.supported) return <span className="text-xs text-slate-400">Audio is not available in this browser.</span>;
  const sel = "border border-slate-300 rounded px-1.5 py-0.5 text-xs bg-white";
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
      <button onClick={onAll} disabled={!count} className="px-2.5 py-1 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">🔊 Listen to all shown ({count})</button>
      <label className="text-slate-500">Detail <select value={s.mode} onChange={(e) => s.setMode(e.target.value as SpeakMode)} className={sel}><option value="brief">Brief (headline, top points)</option><option value="full">Full (everything except quotes)</option></select></label>
      <label className="text-slate-500">Speed <select value={s.rate} onChange={(e) => s.setRate(e.target.value)} className={sel}>{["0.8", "1", "1.15", "1.3", "1.5", "1.75", "2"].map((r) => <option key={r} value={r}>{r}×</option>)}</select></label>
      {s.voices.length > 1 && (
        <label className="text-slate-500">Voice <select value={s.voiceURI} onChange={(e) => s.setVoice(e.target.value)} className={`${sel} max-w-[11rem]`}><option value="">Auto</option>{s.voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}</select></label>
      )}
      <span className="text-slate-400">Quotes are not read aloud; they stay on screen for checking. Detail and speed apply from the next holding.</span>
    </div>
  );
}

export function PlayerBar({ s, label }: { s: Speech; label: string }) {
  const c = s.cur;
  if (!c) return null;
  const btn = "px-2 py-1 rounded hover:bg-white/20 disabled:opacity-30";
  const pct = c.chunks ? Math.round(((c.chunk + 1) / c.chunks) * 100) : 0;
  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 w-[min(94vw,40rem)] rounded-xl bg-slate-900 text-white shadow-xl px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{c.paused ? "⏸ Paused" : "🔊 Reading"} · {label}</div>
          <div className="text-[11px] text-slate-400">{c.n > 1 ? `Holding ${c.i + 1} of ${c.n}` : "Single holding"} · {s.mode === "full" ? "full" : "brief"} · {s.rate}×</div>
        </div>
        <button className={btn} onClick={s.prev} disabled={c.i === 0} title="Previous holding">⏮</button>
        <button className={btn} onClick={c.paused ? s.resume : s.pause} title={c.paused ? "Resume" : "Pause"}>{c.paused ? "▶" : "⏸"}</button>
        <button className={btn} onClick={s.next} disabled={c.i + 1 >= c.n} title="Next holding">⏭</button>
        <button className={btn} onClick={s.stop} title="Stop">⏹</button>
      </div>
      <div className="mt-1.5 h-1 rounded bg-white/20 overflow-hidden"><div className="h-full bg-indigo-400" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
