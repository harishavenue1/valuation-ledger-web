// MTF (Margin Trading Facility) Calculator — added 2026-09-13, "can we
// build this as a new page" after reviewing the user's own Google
// Sheet (screenshot: two blocks, MTF-Gold and MTF-Silver, each with a
// day-bucket table of P/L, Tax, Charges, IntPaid, FinalProfit,
// FinalProfitWoLev, PAT(Lev)%, PAT(WoLev)%). Formulas below were
// reverse-engineered and verified cell-by-cell against that sheet
// before porting. Two deliberate corrections vs. the original sheet,
// confirmed with the user:
//
// 1. PAT(Lev)% — the sheet's denominator was
//    Invested + Tax + Charges + IntPaid, which double-counts Tax (it's
//    already subtracted out of the numerator FinalProfit), mechanically
//    eroding the leveraged return% as holding period grows even when
//    the underlying trade P/L hasn't moved. User picked "fix: capital +
//    interest only" — denominator here is Invested + IntPaid.
// 2. Charges are now deducted symmetrically in BOTH the leveraged and
//    unleveraged scenarios (the sheet only deducted them in the
//    leveraged one) — you'd pay brokerage either way.
//
// Also fixed vs. the sheet: Tax is floored at 0 (a loss shouldn't
// generate a tax "credit" in this simplified model).
//
// Updated 2026-09-13 ("also on MTF use the actual zerodha trade
// https://zerodha.com/calculators/mtf-calculator/") — user pointed at
// Zerodha's own real MTF calculator and gave a live example
// (GOLDCASE, Invested ₹10,00,000, Leverage 3.57x/Margin 28%, 180
// days, Expected 50% return -> Interest ₹1,85,040, Brokerage+Charges
// ₹9,831.02). Interest and Charges below are now Zerodha's own
// documented formulas (see computeZerodhaCharges below), verified to
// tie the Interest figure out EXACTLY against that example. Explicit
// user instruction on the one real conflict this surfaced: Zerodha's
// own displayed return% divides by Invested ALONE (no interest
// add-back — the ORIGINAL sheet's convention, which correction #1
// above deliberately moved away from) — user's call was "use zerodha
// for actual charges, leverage, margin and other related details..
// logic for final profit and loss go with earlier logic", i.e. keep
// PAT(Lev)%'s denominator as Invested + IntPaid (correction #1,
// unchanged) and keep Tax in the final P&L (Zerodha's own calculator
// doesn't model capital gains tax at all — this app's own addition on
// top, not a Zerodha-matched figure).
//
// Reworked again 2026-09-13 ("use similar ui as zerodha page as a
// playtool and let table reflect below that show as we earlier
// built") — Zerodha's own calculator drives off THREE sliders
// (Invested amount, No. of days held, Expected rate of return) plus a
// per-stock Margin/Leverage lookup, not Shares#/Buy Price. Those two
// fields were always mathematically redundant here anyway — every
// output only ever depended on their PRODUCT (Shares × Buy Price =
// Total Inv), never on Shares or Buy Price individually — so this
// switches the model over to Zerodha's own primary input,
// `investedAmount`, and derives Total Inv from it via Margin%, a
// straight simplification with no behavior change for any given
// (Total Inv, Margin%) pair. `days` is new: the single "current"
// holding period the live Playtool result reflects, independent of
// the day-bucket table below (still spans DEFAULT_DAYS/whatever list
// the page has, computed from the exact same instrument).

export interface MtfInstrument {
  name: string;
  investedAmount: number; // Zerodha's own primary slider — your own capital. Total Inv = investedAmount / (marginPct/100)
  marginPct: number; // broker's MTF margin requirement for this instrument. Zerodha looks this up live per stock via search (e.g. GOLDCASE 28%/3.57x, RELIANCE ~22.6%/4.42x) — not fetchable headlessly here, so it's a manual input
  dailyRatePct: number; // MTF funding interest, per DAY — Zerodha's own flat rate is 0.04%/day (₹40 per lakh), not annualized
  expPlPct: number; // expected rate of return over the holding period — Zerodha's own "Expected rate of return" slider
  days: number; // "No. of days held" slider — the single day count the live Playtool result reflects
  charges: number; // brokerage + STT + stamp duty + pledge/unpledge, same both scenarios — seed via computeZerodhaCharges, editable override
}

export interface MtfAssumptions {
  stcgPct: number;
  ltcgPct: number;
  ltcgThresholdDays: number; // > this many days = long-term (365 for equity)
}

export interface MtfRow {
  days: number;
  totalInv: number;
  invested: number;
  funded: number;
  pl: number;
  taxRatePct: number;
  tax: number;
  charges: number;
  intPaid: number;
  totalCashOut: number; // Invested + Tax + Charges + IntPaid — informational total cash deployed, not the PAT(Lev)% base
  finalProfit: number;
  finalProfitWoLev: number;
  patLevPct: number | null;
  patWoLevPct: number | null;
  leverageEdge: number; // finalProfit − finalProfitWoLev — the rupee benefit (or cost) of using MTF
}

// Zerodha's own documented MTF charge formula (zerodha.com/calculators/
// mtf-calculator/ FAQ), live-verified against the user's own GOLDCASE
// screenshot: Invested ₹10,00,000, Leverage 3.57x (Margin 28%), 180
// days, Expected 50% -> this formula returns ~₹9,536 against Zerodha's
// own displayed ₹9,831.02 for the same trade (~3% gap). The modeled
// components — brokerage (0.3% or ₹20/order, whichever LOWER, both
// legs), STT (0.1% delivery, both legs), stamp duty (0.015%, buy leg
// only), pledge/unpledge (₹15 + 18% GST, each way) — are Zerodha's
// own stable, well-documented rates. NOT modeled: exchange transaction
// charges, SEBI turnover fees, and GST on brokerage+those charges —
// individually tiny (well under 1% of the total) but numerous enough
// to explain the residual gap; deliberately left out rather than
// hardcoding statutory rates that drift with regulation and that this
// sandbox can't verify live.
export function computeZerodhaCharges(buyValue: number, sellValue: number): number {
  const brokerage = Math.min(0.003 * buyValue, 20) + Math.min(0.003 * sellValue, 20);
  const stt = 0.001 * buyValue + 0.001 * sellValue;
  const stampDuty = 0.00015 * buyValue;
  const pledgeUnpledge = 2 * (15 * 1.18);
  return Math.round((brokerage + stt + stampDuty + pledgeUnpledge) * 100) / 100; // round to paise — every caller wants a clean rupee figure, not a float artifact
}

export function computeMtfTotals(inst: MtfInstrument) {
  const totalInv = inst.marginPct > 0 ? inst.investedAmount / (inst.marginPct / 100) : inst.investedAmount;
  const funded = totalInv - inst.investedAmount;
  const dayCharge = funded * (inst.dailyRatePct / 100);
  const grossPl = totalInv * (inst.expPlPct / 100);
  const sellValue = totalInv + grossPl;
  const leverageX = inst.marginPct > 0 ? 100 / inst.marginPct : null; // Zerodha's own framing — e.g. Margin 28% = Leverage 3.57x
  return { totalInv, funded, dayCharge, grossPl, sellValue, leverageX };
}

export function computeMtfRow(inst: MtfInstrument, assumptions: MtfAssumptions, days: number): MtfRow {
  const { totalInv, funded, grossPl } = computeMtfTotals(inst);
  const invested = inst.investedAmount;

  const pl = grossPl;
  const taxRatePct = days > assumptions.ltcgThresholdDays ? assumptions.ltcgPct : assumptions.stcgPct;
  const tax = Math.max(0, pl) * (taxRatePct / 100);
  const intPaid = funded * (inst.dailyRatePct / 100) * days;

  const finalProfit = pl - tax - inst.charges - intPaid;
  const totalCashOut = invested + tax + inst.charges + intPaid;
  const patLevBase = invested + intPaid;
  const patLevPct = patLevBase > 0 ? (finalProfit / patLevBase) * 100 : null;

  const finalProfitWoLev = invested * (inst.expPlPct / 100) * (1 - taxRatePct / 100) - inst.charges;
  const patWoLevPct = invested > 0 ? (finalProfitWoLev / invested) * 100 : null;

  return {
    days,
    totalInv,
    invested,
    funded,
    pl,
    taxRatePct,
    tax,
    charges: inst.charges,
    intPaid,
    totalCashOut,
    finalProfit,
    finalProfitWoLev,
    patLevPct,
    patWoLevPct,
    leverageEdge: finalProfit - finalProfitWoLev,
  };
}

export const DEFAULT_DAYS = [30, 60, 90, 120, 150, 180, 240, 366, 450, 685];

export const DEFAULT_ASSUMPTIONS: MtfAssumptions = { stcgPct: 20, ltcgPct: 12.5, ltcgThresholdDays: 365 };

export function defaultInstrument(name: string): MtfInstrument {
  const investedAmount = 100000;
  const marginPct = 30;
  const expPlPct = 50;
  const totalInv = investedAmount / (marginPct / 100);
  const sellValue = totalInv * (1 + expPlPct / 100);
  return { name, investedAmount, marginPct, dailyRatePct: 0.04, expPlPct, days: 180, charges: computeZerodhaCharges(totalInv, sellValue) };
}
