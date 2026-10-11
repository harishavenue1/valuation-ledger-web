// Pulling forward-looking statements ("guidance") out of headlines and tweets. It is a pattern match, not
// understanding: a sentence counts when it has a forward-looking phrase AND a concrete figure or fiscal
// year, and it is typed by what the figure is about.

export type GType = "Revenue" | "Margin" | "Capex" | "Orders" | "Other";
export const G_TYPES: GType[] = ["Revenue", "Margin", "Capex", "Orders", "Other"];
export const G_CLASS: Record<GType, string> = {
  Revenue: "bg-emerald-50 text-emerald-700 border-emerald-300",
  Margin: "bg-violet-50 text-violet-700 border-violet-300",
  Capex: "bg-sky-50 text-sky-700 border-sky-300",
  Orders: "bg-teal-50 text-teal-700 border-teal-300",
  Other: "bg-slate-100 text-slate-600 border-slate-300",
};

const FORWARD =
  /\b(guid(e|es|ed|ance)|expects?|expected to|targets?|targeting|aims?|aspires?|plans? to|to (double|triple|grow|reach|touch|cross|add|invest|set up|commission)|will (grow|reach|touch|add|invest)|forecasts?|on track to|set to|eyes?|looking (at|to)|ambition|visibility|by (fy\s?\d{2}|20\d{2})|next (two|three|2|3|5) years|medium.term|raises? (capex|guidance)|revises? (guidance|target))\b/i;
const QUANT = /(\d[\d,.]*\s?(%|per ?cent|x\b|times|crore|cr\b|lakh|bn\b|billion|mn\b|million|gw|mw|gwh|mwp|tonnes?|mt|units|stores|plants|bps))|\bfy\s?\d{2}\b|\b20\d{2}\b/i;
const NEGATIVE_CONTEXT = /stock prediction|analyst targets?|key levels|price (forecast|prediction)|share price (target|forecast)|price target|target price|\bbuy\b.{0,20}target|stock (could|may) (rally|jump)|technical|support at|resistance|stop.?loss/i;

/** The fiscal year a statement is about: the LATEST one it names ("₹20,000 Cr by financial year 2029, against ₹4,750 Cr in FY26" -> FY29). */
export function horizonOf(p: string): string | null {
  const ys: number[] = [];
  for (const m of p.matchAll(/\bFY\s?-?(\d{2,4})E?\b/gi)) ys.push(parseInt(m[1].slice(-2)));
  for (const m of p.matchAll(/\b(?:financial|fiscal) year\s+(?:ending\s+)?(?:march\s+)?(?:FY\s?)?(20\d{2}|\d{2})\b/gi)) ys.push(parseInt(m[1].slice(-2)));
  for (const m of p.matchAll(/\bby\s+(?:the end of\s+)?(?:FY\s?)?(20\d{2})\b/gi)) ys.push(parseInt(m[1].slice(-2)));
  for (const m of p.matchAll(/\bby\s+(?:the end of\s+)?FY\s?(\d{2})\b/gi)) ys.push(parseInt(m[1]));
  const ok = ys.filter((y) => y >= 20 && y <= 45);
  return ok.length ? `FY${Math.max(...ok)}` : null;
}

const CR_UNIT: Record<string, number> = { "lakh crore": 1e5, crore: 1, crores: 1, cr: 1, bn: 100, billion: 100 };
/** The largest ₹ amount in a sentence, in crore (a revenue target is normally the biggest figure in it); null if none. */
export function targetAmountCr(p: string): number | null {
  let best: number | null = null;
  for (const m of p.matchAll(/(?:₹|rs\.?|inr)?\s?([\d,]+(?:\.\d+)?)\s?(lakh crore|crores?|cr\b|bn\b|billion)/gi)) {
    const v = parseFloat(m[1].replace(/,/g, "")) * (CR_UNIT[m[2].toLowerCase()] ?? 1);
    if (!Number.isNaN(v) && (best == null || v > best)) best = v;
  }
  return best;
}

export interface Guidance {
  text: string;
  types: GType[];
  horizon: string | null;
  strength: number;
}

function typesOf(t: string): GType[] {
  const out: GType[] = [];
  if (/revenue|sales|top.?line|turnover|growth|cagr/i.test(t)) out.push("Revenue");
  if (/margin|ebitda|\bopm\b|\bpat\b|profit|\beps\b|earnings/i.test(t)) out.push("Margin");
  if (/capex|capacity|plant|expansion|invest|facility|commission|\bgw\b|\bmw\b|tonnes?/i.test(t)) out.push("Capex");
  if (/order|inflow|intake|pipeline|backlog/i.test(t)) out.push("Orders");
  return out.length ? out : ["Other"];
}

/** Guidance-like sentences in `text` (one entry per sentence, strongest first). */
export function extractGuidance(text: string, minStrength = 2): Guidance[] {
  const out: Guidance[] = [];
  const parts = text
    .replace(/https?:\/\/\S+/g, "")
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z₹•🔹👉➡️])/)
    .map((p) => p.replace(/^[\s•\-–👉➡️🔹▪️]+/, "").trim())
    .filter((p) => p.length >= 25);
  for (const p of parts) {
    if (!FORWARD.test(p) || !QUANT.test(p) || NEGATIVE_CONTEXT.test(p)) continue;
    const horizon = horizonOf(p);
    let strength = 1;
    if (/[\d,.]+\s?(%|per ?cent|crore|cr\b|bn\b|billion|x\b|times|gw|mw)/i.test(p)) strength++;
    if (horizon) strength++;
    if (/guid(e|es|ed|ance)|expects?|targets?|aims?/i.test(p)) strength++;
    if (strength < minStrength) continue;
    out.push({ text: p.slice(0, 300), types: typesOf(p), horizon, strength });
  }
  return out.sort((a, b) => b.strength - a.strength);
}
