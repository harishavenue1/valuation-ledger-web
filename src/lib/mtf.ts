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
//
// Updated again 2026-09-13 ("for gold and silver STCG is slab rate
// and also include the surcharge, cess as per indian rules") — gold/
// silver (and any other non-"listed security" asset — not covered by
// STT/section 111A) don't get the flat STCG% equity gets: short-term
// gains on them are taxed at the investor's own income-tax SLAB rate,
// and the resulting tax (both the slab-based STCG leg and the flat
// 12.5% LTCG leg — LTCG's rate itself is uniform across asset classes
// since the 2024 budget) gets surcharge and cess stacked on top,
// exactly like any other income-tax liability. Modeled as a
// per-instrument `slabRateTax` flag (on by default for the page's own
// Gold/Silver cards) plus 3 new shared assumptions (slabRatePct,
// surchargePct, cessPct) — see computeMtfRow's own comment for the
// exact stacking formula. Equity/ETF instruments (slabRateTax=false,
// the default for anything else) are unaffected — plain stcgPct/
// ltcgPct, no surcharge/cess, same as every earlier version of this
// file.

export interface MtfInstrument {
  name: string;
  investedAmount: number; // Zerodha's own primary slider — your own capital. Total Inv = investedAmount / (marginPct/100)
  marginPct: number; // broker's MTF margin requirement for this instrument. Zerodha looks this up live per stock via search (e.g. GOLDCASE 28%/3.57x, RELIANCE ~22.6%/4.42x) — not fetchable headlessly here, so it's a manual input
  dailyRatePct: number; // MTF funding interest, per DAY — Zerodha's own flat rate is 0.04%/day (₹40 per lakh), not annualized
  expPlPct: number; // expected rate of return over the holding period — Zerodha's own "Expected rate of return" slider
  days: number; // "No. of days held" slider — the single day count the live Playtool result reflects
  slabRateTax: boolean; // 2026-09-13 ("for gold and silver STCG is slab rate ... include surcharge, cess") — gold/silver (and other non-equity assets, since they're not "listed securities" under STT/111A) don't get the flat STCG% — short-term gains are taxed at the investor's own income-tax SLAB rate instead, and BOTH slab-STCG and flat-LTCG get surcharge+cess stacked on top. Equity/ETF instruments (the default, false) keep the plain shared STCG%/LTCG% — unaffected.
}

export interface MtfAssumptions {
  stcgPct: number;
  ltcgPct: number;
  ltcgThresholdDays: number; // > this many days = long-term (365 for equity)
  slabRatePct: number; // investor's own marginal income-tax slab rate — applies to STCG on slabRateTax instruments (gold/silver etc.) instead of stcgPct. Default 30% (the top individual slab under both regimes) — this app has no notion of the user's actual income, so it's a manual input
  surchargePct: number; // individual income-tax surcharge, based on TOTAL income (not just this gain): 10% (₹50L-1Cr), 15% (1Cr-2Cr), 25% (2Cr-5Cr, new-regime cap), 0% below ₹50L. Manual input, default 0% (can't be derived without knowing total income)
  cessPct: number; // Health & Education Cess — a stable, well-documented flat 4% on (tax + surcharge), applies to every slab of every regime
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
//
// 2026-09-13 ("remove the charges as input tab, it must via rules not
// a user input") — Charges is no longer a stored/editable field on
// MtfInstrument at all; every caller derives it fresh from this
// formula, every render, off the instrument's current size. The
// breakdown variant exists so the UI can show each component's own
// rupee amount and % of the total on hover ("give a breakdown with
// percentages of charges on mouse over").
export interface ZerodhaChargesBreakdown {
  brokerage: number;
  stt: number;
  stampDuty: number;
  pledgeUnpledge: number;
  total: number;
}

export function computeZerodhaChargesBreakdown(buyValue: number, sellValue: number): ZerodhaChargesBreakdown {
  const brokerage = Math.min(0.003 * buyValue, 20) + Math.min(0.003 * sellValue, 20);
  const stt = 0.001 * buyValue + 0.001 * sellValue;
  const stampDuty = 0.00015 * buyValue;
  const pledgeUnpledge = 2 * (15 * 1.18);
  const total = Math.round((brokerage + stt + stampDuty + pledgeUnpledge) * 100) / 100; // round to paise — every caller wants a clean rupee figure, not a float artifact
  return { brokerage, stt, stampDuty, pledgeUnpledge, total };
}

export function computeZerodhaCharges(buyValue: number, sellValue: number): number {
  return computeZerodhaChargesBreakdown(buyValue, sellValue).total;
}

export function computeMtfTotals(inst: MtfInstrument) {
  const totalInv = inst.marginPct > 0 ? inst.investedAmount / (inst.marginPct / 100) : inst.investedAmount;
  const funded = totalInv - inst.investedAmount;
  const dayCharge = funded * (inst.dailyRatePct / 100);
  const grossPl = totalInv * (inst.expPlPct / 100);
  const sellValue = totalInv + grossPl;
  const leverageX = inst.marginPct > 0 ? 100 / inst.marginPct : null; // Zerodha's own framing — e.g. Margin 28% = Leverage 3.57x
  const chargesBreakdown = computeZerodhaChargesBreakdown(totalInv, sellValue);
  return { totalInv, funded, dayCharge, grossPl, sellValue, leverageX, chargesBreakdown, charges: chargesBreakdown.total };
}

export function computeMtfRow(inst: MtfInstrument, assumptions: MtfAssumptions, days: number): MtfRow {
  const { totalInv, funded, grossPl, charges } = computeMtfTotals(inst);
  const invested = inst.investedAmount;

  const pl = grossPl;
  // 2026-09-13 ("for gold and silver STCG is slab rate ... include
  // surcharge, cess") — slabRateTax instruments swap the flat STCG%
  // for the investor's own income-tax slab rate (LTCG stays the flat
  // 12.5% either way — the post-2024-budget rate is uniform across
  // asset classes), and BOTH legs then get surcharge+cess stacked on
  // top (real Indian tax law applies surcharge+cess to the whole
  // capital-gains tax, not just the short-term leg). Equity/ETF
  // instruments (slabRateTax=false) are untouched — plain stcgPct/
  // ltcgPct, no surcharge/cess, same as before.
  const baseRatePct = days > assumptions.ltcgThresholdDays ? assumptions.ltcgPct : inst.slabRateTax ? assumptions.slabRatePct : assumptions.stcgPct;
  const taxRatePct = inst.slabRateTax ? baseRatePct * (1 + assumptions.surchargePct / 100) * (1 + assumptions.cessPct / 100) : baseRatePct;
  const tax = Math.max(0, pl) * (taxRatePct / 100);
  const intPaid = funded * (inst.dailyRatePct / 100) * days;

  const finalProfit = pl - tax - charges - intPaid;
  const totalCashOut = invested + tax + charges + intPaid;
  const patLevBase = invested + intPaid;
  const patLevPct = patLevBase > 0 ? (finalProfit / patLevBase) * 100 : null;

  const finalProfitWoLev = invested * (inst.expPlPct / 100) * (1 - taxRatePct / 100) - charges;
  const patWoLevPct = invested > 0 ? (finalProfitWoLev / invested) * 100 : null;

  return {
    days,
    totalInv,
    invested,
    funded,
    pl,
    taxRatePct,
    tax,
    charges,
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

export const DEFAULT_ASSUMPTIONS: MtfAssumptions = { stcgPct: 20, ltcgPct: 12.5, ltcgThresholdDays: 365, slabRatePct: 30, surchargePct: 0, cessPct: 4 };

export function defaultInstrument(name: string, slabRateTax = false, marginPct = 30): MtfInstrument {
  return { name, investedAmount: 100000, marginPct, dailyRatePct: 0.04, expPlPct: 50, days: 180, slabRateTax };
}
