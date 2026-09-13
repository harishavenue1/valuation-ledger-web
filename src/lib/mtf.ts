// MTF (Margin Trading Facility) Calculator — added 2026-09-13, "can we
// build this as a new page" after reviewing the user's own Google
// Sheet (screenshot: two blocks, MTF-Gold and MTF-Silver, each with a
// day-bucket table of P/L, Tax, Charges, IntPaid, FinalProfit,
// FinalProfitWoLev, PAT(Lev)%, PAT(WoLev)%). Formulas below were
// reverse-engineered and verified cell-by-cell against that sheet
// before porting — see the review earlier in this session for the
// full trace. Two deliberate corrections vs. the original sheet,
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
// Also fixed vs. the sheet: CurPrice is derived from BuyPrice ×
// (1 + ExpPL%) and kept at full precision (the sheet displayed a
// rounded CurPrice — 38 — while its own P/L formula used the
// unrounded 37.5, so a reader's manual check of (CurPrice−BuyPrice)×
// Shares never tied out). Tax is floored at 0 (a loss shouldn't
// generate a tax "credit" in this simplified model).

export interface MtfInstrument {
  name: string;
  shares: number;
  buyPrice: number;
  marginPct: number; // broker's MTF margin requirement for this instrument — Invested = TotalInv × marginPct
  yearlyRatePct: number; // MTF funding interest, annualized
  expPlPct: number; // expected price move by the time of sale — drives CurPrice
  charges: number; // flat brokerage/charges per round trip, same both scenarios
}

export interface MtfAssumptions {
  stcgPct: number;
  ltcgPct: number;
  ltcgThresholdDays: number; // > this many days = long-term (365 for equity)
}

export interface MtfRow {
  days: number;
  curPrice: number;
  totalInvCr: number; // "Cr" naming avoided elsewhere in this file — plain rupees
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

export function computeMtfTotals(inst: MtfInstrument) {
  const totalInv = inst.shares * inst.buyPrice;
  const invested = totalInv * (inst.marginPct / 100);
  const funded = totalInv - invested;
  const dailyRatePct = inst.yearlyRatePct / 365;
  const dayCharge = funded * (dailyRatePct / 100);
  const curPrice = inst.buyPrice * (1 + inst.expPlPct / 100);
  return { totalInv, invested, funded, dailyRatePct, dayCharge, curPrice };
}

export function computeMtfRow(inst: MtfInstrument, assumptions: MtfAssumptions, days: number): MtfRow {
  const { totalInv, invested, funded, dailyRatePct, curPrice } = computeMtfTotals(inst);

  const pl = (curPrice - inst.buyPrice) * inst.shares;
  const taxRatePct = days > assumptions.ltcgThresholdDays ? assumptions.ltcgPct : assumptions.stcgPct;
  const tax = Math.max(0, pl) * (taxRatePct / 100);
  const intPaid = funded * (dailyRatePct / 100) * days;

  const finalProfit = pl - tax - inst.charges - intPaid;
  const totalCashOut = invested + tax + inst.charges + intPaid;
  const patLevBase = invested + intPaid;
  const patLevPct = patLevBase > 0 ? (finalProfit / patLevBase) * 100 : null;

  const finalProfitWoLev = invested * (inst.expPlPct / 100) * (1 - taxRatePct / 100) - inst.charges;
  const patWoLevPct = invested > 0 ? (finalProfitWoLev / invested) * 100 : null;

  return {
    days,
    curPrice,
    totalInvCr: totalInv,
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
  return { name, shares: 15000, buyPrice: 25, marginPct: 30, yearlyRatePct: 15, expPlPct: 50, charges: 937.5 };
}
