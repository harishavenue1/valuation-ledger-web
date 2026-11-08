// Read-aloud for the Concall Summary page (2026-11-08, "add a audio feature to read out the concall or any readable summary on page as its difficult to read all holdings").
// Uses the browser's own speech engine (window.speechSynthesis): no API key, no cost, nothing is sent anywhere, and no server function is added.
// This file only turns a summary row into text that sounds right when spoken. Evidence quotes are NOT read out (they are for checking on screen).

export interface SpeakRow {
  symbol: string; name?: string; weight?: number | null; call_date: string; tone: string; tone_note?: string; headline: string;
  highlights: { point?: string }[];
  positives: { tag?: string; point?: string; impact?: string }[];
  negatives: { tag?: string; point?: string; impact?: string }[];
  between_the_lines?: { signal?: string; reading?: string }[];
  vs_last_call?: { change?: string }[];
  guidance?: { item: string; number: string; horizon?: string }[];
  watch_next?: string[]; data_gaps?: string[];
}
export type SpeakMode = "brief" | "full";

const UNIT: Record<string, string> = { Cr: "crore", Mn: "million", mn: "million", bn: "billion", Bn: "billion" };

// Make finance shorthand pronounceable.
export function spoken(t?: string): string {
  if (!t) return "";
  return t
    .replace(/[*_`#]/g, "")
    .replace(/(\d)\s?(Cr|Mn|mn|bn|Bn)\b/g, (_m, d, u) => `${d} ${UNIT[u]}`)
    .replace(/₹\s?/g, "rupees ")
    .replace(/USD\s?(?=\d)/g, "US dollars ")
    .replace(/(\d)\s?[-–]\s?(\d)/g, "$1 to $2")
    .replace(/(^|[\s(,;])\+(?=\d)/g, "$1plus ")
    .replace(/(^|[\s(,;])[-−](?=\d)/g, "$1minus ")
    .replace(/(\d)x\b/g, "$1 times")
    .replace(/\bFY\s?'?(\d{2})\b/g, "F Y $1")
    .replace(/\bYoY\b/gi, "year on year")
    .replace(/\bQoQ\b/gi, "quarter on quarter")
    .replace(/\bPBT\b/g, "profit before tax")
    .replace(/\bPAT\b/g, "profit after tax")
    .replace(/\bEBITDA\b/g, "ebit-dah")
    .replace(/\bbps\b/gi, "basis points")
    .replace(/\bCapex\b/gi, "capex")
    .replace(/%/g, " percent")
    .replace(/[~≈]/g, "about ")
    .replace(/→/g, ". ")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

const end = (s: string) => (/[.!?]$/.test(s) ? s : s + ".");

export function buildScript(r: SpeakRow, mode: SpeakMode, pos?: number, total?: number): string[] {
  const full = mode === "full";
  const L: string[] = [];
  const who = spoken(r.name || r.symbol);
  L.push(`${pos && total ? `Holding ${pos} of ${total}. ` : ""}${who}.${r.weight != null ? ` ${r.weight.toFixed(1)} percent of your portfolio.` : ""} Call dated ${r.call_date}. Tone: ${r.tone}.`);
  L.push(end(spoken(r.headline)));
  if (full && r.tone_note) L.push(end(spoken(r.tone_note)));

  const hl = (full ? r.highlights : r.highlights.slice(0, 3)).map((h) => end(spoken(h.point))).filter((s) => s.length > 1);
  if (hl.length) L.push("Highlights.", ...hl);

  const item = (p: { tag?: string; point?: string; impact?: string }) =>
    full ? `${p.tag ? p.tag + ". " : ""}${end(spoken(p.point))}${p.impact ? " Impact: " + end(spoken(p.impact)) : ""}` : end(spoken(p.point));
  const pos2 = full ? r.positives : r.positives.slice(0, 2);
  const neg2 = full ? r.negatives : r.negatives.slice(0, 2);
  if (pos2.length) L.push(`Positives.`, ...pos2.map(item));
  if (neg2.length) L.push(`Negatives and risks.`, ...neg2.map(item));

  const btl = (full ? r.between_the_lines : r.between_the_lines?.slice(0, 2)) ?? [];
  if (btl.length) L.push("Reading between the lines. This part is interpretation, not what management said.", ...btl.map((b) => `${b.signal ? end(spoken(b.signal)) + " " : ""}${end(spoken(b.reading))}`));

  if (full) {
    if (r.vs_last_call?.length) L.push("What changed since the last call.", ...r.vs_last_call.map((c) => end(spoken(c.change))));
    if (r.guidance?.length) L.push("Numbers management put out.", ...r.guidance.map((g) => end(spoken(`${g.item}: ${g.number}${g.horizon ? ", " + g.horizon : ""}`))));
    if (r.watch_next?.length) L.push("Watch next.", ...r.watch_next.map((w) => end(spoken(w))));
    if (r.data_gaps?.length) L.push("Not covered on the call.", ...r.data_gaps.map((w) => end(spoken(w))));
  }
  return L;
}

// Some browsers (Chrome) cut a long utterance off after ~15 seconds, so speak in short sentence-sized pieces.
export function chunkify(lines: string[], max = 200): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const sentences = line.split(/(?<=[.!?;:])\s+/);
    let cur = "";
    for (const s of sentences) {
      if (cur && (cur + " " + s).length > max) { out.push(cur); cur = s; } else cur = cur ? cur + " " + s : s;
    }
    if (cur) out.push(cur);
  }
  return out.flatMap((c) => {
    if (c.length <= max * 1.25) return [c];
    const parts: string[] = []; let cur = "";
    for (const w of c.split(" ")) { if ((cur + " " + w).length > max) { parts.push(cur); cur = w; } else cur = cur ? cur + " " + w : w; }
    if (cur) parts.push(cur);
    return parts;
  });
}
