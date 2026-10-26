// Blockbuster Guidances (2026-10-26): reads the concall lines api/_concall.py already pulled from management's own transcript
// speech and works out the growth number management put on the table. Pattern matching, not comprehension — every row on the
// page carries the full quote and the transcript link so the number can be checked at the source.

export type Metric = "Revenue" | "Profit" | "Orders" | "Volume";
export interface Guided {
  metric: Metric;
  growth: number; // the LOW end of what was guided, in % (a range "25-30%" counts as 25); doubling = 100, tripling = 200
  label: string; // how it was said: "25–30%", "doubling", "3x"
}

const GROW = /\b(grow(th|ing|s|n)?|cagr|increase|increasing|rise|rising|expand|expansion|up by|scale|doubl\w*|tripl\w*|double|triple)\b/i;
// "50% of the revenues", "utilisation of 75%", "EBITDA margin of 22%" — a % that is a share, level or ratio, not growth
function isShareOrRatio(text: string, i: number, len: number): boolean {
  const pre = text.slice(Math.max(0, i - 32), i);
  const post = text.slice(i + len, i + len + 30);
  if (/^\s*(of|in)\s+(?:(?:our|the|its|total|overall|critical|current|consolidated)\s+){0,2}(revenues?|sales|order ?book|capacity|market|business|volumes?|portfolio|mix|total|ebitda|profits?)/i.test(post)) return true;
  if (/(margins?|utili[sz]ation|share|roce|roe|mix|yield|payout|dividend|npa|nim|occupancy|plf|rate|ratio|contribution|penetration)\b[^.]{0,22}$/i.test(pre)) return true;
  return false;
}
const FORWARD = /\b(guid\w*|expect\w*|target\w*|aim\w*|aspir\w*|plan\w*|will|should|going to|on track|confident|looking (at|to)|ambition|visibility|aiming|anticipat\w*|project\w*|committed|endeavou?r\w*|believe)\b/i;
const PAST = /\b(grew|grown|reported|delivered|achieved|registered|clocked|posted|recorded|witnessed|saw|came in|stood at|was up|were up|has grown|have grown|closed|ended|exited|crossed|exceeded|surpassed|finishing|reflecting|were at|was at|higher than|ahead of|above|better than)\b/i;
const NUM = "(\\d{1,3}(?:\\.\\d+)?)";
const RANGE = new RegExp(`${NUM}\\s*(?:%|per ?cent)?\\s*(?:to|-|–|—|and|/)\\s*${NUM}\\s*(?:%|per ?cent)`, "ig");
const SINGLE = new RegExp(`${NUM}\\s*(?:%|per ?cent)`, "ig");

function metricOf(window: string): Metric | null {
  const w = window.toLowerCase();
  const order = /\b(order ?(inflow|book|intake|flow|win)s?|orders?|bookings?|pre-?sales)\b/.exec(w);
  const profit = /\b(ebitda|pat\b|profit|profitability|eps|earnings|ebit\b|bottom ?line|net income)\b/.exec(w);
  const rev = /\b(revenues?|sales|top ?line|turnover|income from operations)\b/.exec(w);
  const vol = /\b(volumes?|tonnage|units|sell(-| )?through|throughput|offtake)\b/.exec(w);
  const hits = ([["Orders", order], ["Profit", profit], ["Revenue", rev], ["Volume", vol]] as [Metric, RegExpExecArray | null][]).filter((h) => h[1]);
  if (!hits.length) return null;
  return hits.sort((a, b) => a[1]!.index - b[1]!.index)[0][0]; // the first-named one is what the sentence is about
}

/** The most aggressive growth guided in this line, or null when the line is not a forward growth statement with a number. */
export function guidedGrowth(text: string): Guided | null {
  if (!text || text.includes("?")) return null;
  if (/\b(capacity|centers?|centres?|stores?|outlets?|plants?|branches|rooms?|beds?|footprint|price goes up)\b/i.test(text) && !/\b(revenue|sales|ebitda|profit|pat|orders?)\b/i.test(text)) return null;
  if (!FORWARD.test(text)) return null;
  // the forward cue has to sit next to the number (a "guidance" ten words later does not make "grew 157%" a guide) and no past-tense cue may
  const forwardAt = (i: number, len: number) => FORWARD.test(text.slice(Math.max(0, i - 90), i + len + 40)) && !PAST.test(text.slice(Math.max(0, i - 60), i + len + 10));
  let best: Guided | null = null;
  const take = (g: Guided) => {
    if (!best || g.growth > best.growth) best = g;
  };
  const around = (i: number, len: number) => text.slice(Math.max(0, i - 70), Math.min(text.length, i + len + 50));

  const seen: number[] = [];
  for (const re of [RANGE, SINGLE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (seen.some((s) => Math.abs(s - m!.index) < 6) && re === SINGLE) continue; // the single % inside an already-read range
      const win = around(m.index, m[0].length);
      const near = text.slice(Math.max(0, m.index - 45), Math.min(text.length, m.index + m[0].length + 25));
      if (!GROW.test(near) || !forwardAt(m.index, m[0].length)) continue;
      if (isShareOrRatio(text, m.index, m[0].length)) continue;
      const metric = metricOf(win);
      if (!metric) continue;
      const lo = parseFloat(m[1]);
      if (!(lo >= 1 && lo <= 500)) continue;
      if (re === RANGE) {
        seen.push(m.index);
        take({ metric, growth: Math.min(lo, parseFloat(m[2])), label: `${m[1]}–${m[2]}%` });
      } else {
        take({ metric, growth: lo, label: `${m[1]}%` });
      }
    }
  }
  // doubling / tripling / Nx — about revenue, profit, orders or volume, never a ratio (book-to-bill, net debt / EBITDA, "visibility") or a multiple of the market
  const MULT = /\b(doubl(?:e|ing|ed)(?![\s-]*digit)|tripl(?:e|ing|ed)|(\d(?:\.\d)?)\s?x\b|(two|three|four|five)[- ]?fold)/gi;
  let mm: RegExpExecArray | null;
  while ((mm = MULT.exec(text))) {
    const ctx = text.slice(Math.max(0, mm.index - 70), mm.index + mm[0].length + 60);
    if (/\b(margins?|roce|roe|capacity|capex|stores?|outlets?|plants?|branches|locations?|rooms?|beds?|visibility|book[- ]?to[- ]?bill|debt|leverage|gearing|backlog|order ?book|coverage|ratio|valuation|multiple|gdp|the market|industry|share of|digit)\b/i.test(ctx)) continue;
    if (!GROW.test(ctx) || !forwardAt(mm.index, mm[0].length)) continue;
    if (/^\s*of\s+\d/.test(text.slice(mm.index + mm[0].length, mm.index + mm[0].length + 8))) continue;
    const metric = metricOf(around(mm.index, mm[0].length));
    if (!metric) continue;
    const w = mm[0].toLowerCase();
    const n = mm[2] ? parseFloat(mm[2]) : /tripl|three/.test(w) ? 3 : /four/.test(w) ? 4 : /five/.test(w) ? 5 : 2;
    if (n >= 2 && n <= 10) take({ metric, growth: (n - 1) * 100, label: n === 2 ? "doubling" : `${n}x` });
  }
  return best;
}
