#!/usr/bin/env python3
"""One-off: apply investorstack.in's "50 must-read concalls — Q1 FY27"
research to the Valuation Ledger.

For each of the 50 companies:
  - fetches full data via Screener (fetch_one + clean_stock) and upserts
    into `stocks` — adding it if new, refreshing it if already tracked
    (never touches `scenarios`, so any hand-edited Base/Bull/Bear driver
    values on an already-tracked company like RKFORGE/ASTRAMICRO/
    MTARTECH/KPL/SAKAR/HFCL/STLTECH are left alone);
  - seeds `guidance` (Base/Bull/Bear Revenue Growth %) from that
    company's own concall guidance table, so the app's
    defaultCaseState() picks it up for any case that hasn't been
    hand-edited yet;
  - adds the ticker to the Guidance Tracker's tracked list and logs a
    "Q1 FY27" cell with the growth trigger as the note.

Base/Bull/Bear methodology: Base = the company's own primary/most-
confident FY27 growth guidance (or a conservative estimate off the
concrete figures given, where management didn't state a clean overall
%  — flagged in the note as "(estimated)" in that source_text below).
Bull = the stated stretch/FY28 target or upper end of a range. Bear =
Base with a ~30-40% relative haircut for execution/macro risk. This is
a deliberately simple, transparent rule — not a precise forecast —
documented per-company in the guidance source_text so it's clear which
number came from management directly vs. was estimated.

Usage:
    DATABASE_URL=postgres://... python3 scripts/apply_q1fy27_concalls.py

Safe to re-run — everything here is an upsert. Rerunning just refreshes
prices/fundamentals and re-applies the same guidance/tracker note.
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))
from _clean import clean_stock  # noqa: E402
from _db import get_all_json, get_conn, get_json, get_meta, set_meta, upsert_json  # noqa: E402
from _screener_fetch import fetch_one  # noqa: E402

QUARTER_LABEL = "Q1 FY27"
SOURCE_NOTE_SUFFIX = " (investorstack.in Q1 FY27 concall research, Aug 2026)"

# ticker, base%, bull%, bear%, trigger (also the guidance source_text
# and the tracker note), tag ("Beat" when guidance was explicitly
# raised this quarter, "Neutral" for a fresh/reaffirmed guide),
# confidence ("Company-stated" when the %s come straight from
# management, "Estimated" when derived/inferred because no single
# clean overall growth% was given on the call).
COMPANIES = [
    ("BHARATFORG", 15, 22, 8,
     "Naval defense, aerospace ring mill, semiconductor and energetics diversification backed by a ₹2,500cr capacity fundraise; India manufacturing arm targeted at 15% CAGR over 5 years, aerospace to double in 2 years.",
     "Neutral", "Estimated"),
    ("HAPPYFORGE", 17, 25, 10,
     "₹950cr order book (60% export) with permanent price hikes secured and a new world-class forging press for energy/data-center parts; FY27 volume growth guided high-teens, EBITDA margin sustained above 30%.",
     "Neutral", "Company-stated"),
    ("RKFORGE", 23, 28, 15,
     "Rail-wheel JV with Indian Railways (110,000 wheels to FY28) plus a ramping Mexico plant; management says 'the best period has just started'. Revenue targeted at ₹8,000cr by FY29 (22-25% CAGR).",
     "Neutral", "Company-stated"),
    ("SONACOMS", 18, 28, 10,
     "DENSO JV for high-voltage EV powertrains — first Indian auto component maker earning royalty income from a global player — plus a new Robotics/Physical-AI vertical with an ₹800cr order book.",
     "Neutral", "Estimated"),
    ("TDPOWERSYS", 20, 30, 12,
     "AI data-center gas-turbine demand surge; capacity being tripled through FY30, entering the >100MW large-generator segment. FY27 revenue guided to ₹2,600cr with possible upside.",
     "Neutral", "Company-stated"),
    ("JYOTICNC", 27, 32, 18,
     "Capacity doubling on a ₹4,848cr order book; FY27 revenue growth guided 25-30%.",
     "Neutral", "Company-stated"),
    ("SETL", 45, 55, 30,
     "New GScale AI data-center JV plus a GL Hakko glass JV; consolidated FY27 revenue guided to ₹1,450cr (core business 40-50% growth plus a new ₹250cr GScale contribution).",
     "Neutral", "Company-stated"),
    ("OMNI", 37, 45, 22,
     "₹3,000cr+ order book including a $100M+ Weatherford contract; FY28 revenue growth guided 35-40%.",
     "Neutral", "Company-stated"),
    ("ASTRAMICRO", 18, 25, 10,
     "HAL's Uttam Radar order doubles the book; FY27 revenue guided to ₹1,350cr (+15-20%), FY28 to ~₹1,600cr, management targets a 6-7x turnover in 5 years.",
     "Neutral", "Company-stated"),
    ("AXISCADES", 25, 40, 15,
     "Divesting legacy IT services (Accordis, $237M) to redeploy into aerospace/defense manufacturing and ZEDA semiconductor equipment; FY27 revenue guided to ₹1,377cr, Defense growth above 75%, ZEDA above 100%.",
     "Neutral", "Estimated"),
    ("MTARTECH", 80, 95, 55,
     "Nuclear (Kaiga units 5&6), fuel cells, aerospace and a new data-center vertical; FY27 revenue growth guided at 80% YoY, management confident of beating it.",
     "Beat", "Company-stated"),
    ("ATHERENERG", 25, 40, 10,
     "AURIC capacity doubling to 9.2 lakh units and a new EL scooter platform launching into unmet 2W-EV demand of 13-15k units/month.",
     "Neutral", "Estimated"),
    ("SANSERA", 19, 27, 12,
     "Aerospace/defense/semiconductor order book tripled to ₹5,750cr, including a new $75M semiconductor order; FY27 top-line growth guided high-teens to ~20%.",
     "Neutral", "Company-stated"),
    ("DIVGIITTS", 20, 30, 10,
     "New Indonesia transfer-case export program (70,000 units) and the US 'Project Mayflower' plant; targeting a ₹1,000cr revenue milestone with EBITDA margin sustained at 20-22%+.",
     "Neutral", "Estimated"),
    ("SSWL", 20, 28, 12,
     "Industry pricing power has returned and the Bhuj alloy-wheel expansion is sold out before commissioning; FY27 revenue growth guided at 20%+ toward ₹6,500cr.",
     "Neutral", "Company-stated"),
    ("LLOYDSME", 25, 40, 12,
     "Transforming from an iron-ore miner into an integrated steel-copper player; value-added product mix rose from 13% to 41% of revenue in a single year.",
     "Neutral", "Estimated"),
    ("DEEDEV", 25, 35, 15,
     "Anjar capacity ramp plus a Siemens gas-turbine piping MoU and a new seamless-pipe plant; FY27 revenue guided above ₹1,500cr en route to a ₹2,500cr FY29 target.",
     "Neutral", "Company-stated"),
    ("MANINDS", 27, 35, 15,
     "NPC Saudi Arabia acquisition (Aramco-approved) plus a new Dammam coating facility; FY28 growth guided at 25-30% on a ~₹5,000cr FY27 consolidated revenue base.",
     "Neutral", "Company-stated"),
    ("AEROFLEX", 30, 45, 15,
     "Data-center liquid-cooling skid assemblies now 23% of revenue within a year of launch; capacity scaling from 6,000 to 15,000 units.",
     "Neutral", "Estimated"),
    ("MANAKCOAT", 28, 35, 15,
     "Colour-coating capacity tripling (86,000 to 236,000 tons) on a record ₹450cr order book; FY28 revenue guided to ₹1,700-1,750cr, up ~30% over the FY27 guide.",
     "Neutral", "Company-stated"),
    ("CLEANMAX", 35, 50, 20,
     "Data-center/hyperscaler renewable power deals with Meta, Apple, Google and Amazon; FY28 EBITDA guided to at least ₹3,000cr (2.4x FY26).",
     "Neutral", "Estimated"),
    ("KSHINTL", 26, 35, 15,
     "T&D and high-voltage wire boom, anchored by a 5-year Hitachi Energy framework deal; FY27 volume growth guided around 26%, EBITDA/ton guided near ₹75,000.",
     "Neutral", "Company-stated"),
    ("QPOWER", 20, 50, 12,
     "Converging capacity expansions (CTC wire, BESS, insulators) and the pending Winwin Speciality Insulators acquisition on a ₹1,945cr order book (1.9x FY26 revenue); management guides 20% growth for FY27, 50% for FY28.",
     "Neutral", "Company-stated"),
    ("DIACABS", 60, 75, 35,
     "Post-insolvency turnaround compounding into structural growth — revenue more than doubled this quarter on a ₹3,688cr order book (2x FY26 revenue); FY27 revenue guided to ₹4,300-4,500cr, FY28 to ₹7,500cr.",
     "Neutral", "Estimated"),
    ("AETHER", 27, 32, 18,
     "Entering semiconductor-grade low-dielectric materials plus a Dow Chemical silicones-technology partnership; core CEM/CRAMS business guided to compound 25-30%.",
     "Neutral", "Company-stated"),
    ("FCL", 100, 130, 60,
     "CrudeChem US oilfield-chemicals acquisition delivering — Texas capacity expanded from 80,000 to 148,000 MTPA; US business guided to $100M revenue in FY27, doubling to $200M in FY28 (largely acquisition-driven, not organic).",
     "Neutral", "Company-stated"),
    ("NEOGEN", 15, 30, 8,
     "Transitioning into a US-facing, non-FEOC-compliant battery-materials supplier; standalone base-business guidance raised to ₹950-1,050cr for FY27, battery-chemicals revenue guided to ₹2,400-2,900cr by FY29.",
     "Beat", "Company-stated"),
    ("YASHO", 35, 42, 20,
     "Contract-backed specialty-chemical transition; FY28 revenue target raised to above ₹1,600cr (from ₹850cr currently), management guides 30-40% annual growth over the next few years.",
     "Beat", "Company-stated"),
    ("SUDEEPPHRM", 25, 40, 15,
     "Battery-grade iron-phosphate (LFP) materials moving from development to binding commercial agreements, alongside continued pharma-excipient capacity expansion (Phase 1, April 2027).",
     "Neutral", "Estimated"),
    ("NAVINFLUOR", 20, 30, 10,
     "HPP/Specialty/CDMO growth with a DRDO partnership; CDMO business targeted at $100M by FY28, net debt-free.",
     "Neutral", "Estimated"),
    ("HSCL", 20, 35, 10,
     "Multi-pronged battery-materials expansion — CNT, super-speciality carbon black, LFP cathode and anode; FY28 PAT guidance reaffirmed at ₹1,100cr.",
     "Neutral", "Estimated"),
    ("POCL", 30, 45, 15,
     "New copper-cathode plant (36,000 tpa) transforming the company from a lead recycler into a copper producer; FY27 copper-cathode volume guided above 30,000 tons.",
     "Neutral", "Estimated"),
    ("AARTIPHARM", 25, 45, 12,
     "Xanthine capacity doubling alongside a scaling CDMO business; FY27 xanthine revenue guided to ₹900-1,100cr, CDMO targeted at ₹1,000cr by FY29/30.",
     "Neutral", "Company-stated"),
    ("SENORES", 35, 40, 20,
     "ANDA portfolio doubled with new US commercial subsidiaries; FY27 revenue growth guided at 30-40%, PAT growth 50-60%.",
     "Neutral", "Company-stated"),
    ("GRANULES", 15, 25, 8,
     "Mix shifting toward complex generics, Gagillapur remediation complete, and a new peptide-CDMO push; EBITDA margin guided to continue at 22-23%.",
     "Neutral", "Estimated"),
    ("ONESOURCE", 45, 67, 25,
     "GLP-1 injector-pen capacity bottleneck play with capacity tripling; FY28 revenue guided to $400M (~67% growth over the current ~$240M annualized run-rate), at a 40% EBITDA margin.",
     "Neutral", "Company-stated"),
    ("SHILPAMED", 15, 25, 5,
     "Transitioning from formulations toward biologics and CDMO as the heavy reinvestment phase ends; EBITDA margin guided to continue near 30% (management declined a specific revenue % on the call).",
     "Neutral", "Estimated"),
    ("KPL", 40, 50, 25,
     "Shifting from injectables toward biosimilars via a new hormone/biologics facility; FY27 revenue guided to ₹700-720cr (+40%), FY28 at least +25-30%, targeting ₹1,500cr by FY30.",
     "Neutral", "Company-stated"),
    ("SAKAR", 45, 60, 25,
     "Oncology export ramp through the new EU-GMP Bavla facility; FY27 oncology revenue guided to ₹186-188cr (2x FY26), FY28 to ₹280-300cr (3x FY26).",
     "Neutral", "Estimated"),
    ("RATEGAIN", 70, 80, 45,
     "Sojern acquisition integration and an AI-powered travel-revenue platform; FY27 revenue guidance raised to ~₹3,100cr (+70% YoY, management says 'should definitely beat'), organic growth exiting at 15-20%.",
     "Beat", "Company-stated"),
    ("HFCL", 40, 55, 25,
     "AI/hyperscale data-center fiber demand with an order book 5x FY26 revenue; FY27 revenue-growth guidance raised from 20% to above 40%.",
     "Beat", "Company-stated"),
    ("STLTECH", 30, 45, 15,
     "$1.1B hyperscaler deal shifting the revenue mix toward data centers; FY27 EBITDA-margin guidance raised from 20% to 23%, data-center/enterprise revenue mix raised from 30% to 50% of FY27.",
     "Beat", "Estimated"),
    ("BBOX", 25, 32, 15,
     "Scaling AI-hyperscale data-center execution — the only India-origin player running gigawatt-scale programs; record backlog up 83% to $950M behind a new $131M hyperscaler order. FY27 revenue guided to ₹7,800-8,000cr (+23-27%).",
     "Neutral", "Company-stated"),
    ("AEGISVOPAK", 25, 35, 12,
     "Transitioning from a stable terminal operator into a much larger infrastructure platform — liquid capacity growing from 1.7M to ~3M CBM by FY28, backed by a ₹10,000cr capex program and 15-year take-or-pay contracts.",
     "Neutral", "Company-stated"),
    ("SHADOWFAX", 39, 45, 25,
     "Five consecutive quarters of 65%+ growth with new verticals (dark stores, Prime Large, D2C, SF360) scaling fast; FY27 revenue-growth guidance raised from 27-30% to 38-40% on Amazon Now traction.",
     "Beat", "Company-stated"),
    ("RBLBANK", 15, 23, 8,
     "Emirates NBD's $2.75bn capital infusion (60% stake, now promoter) resets the bank's cost of funds and growth trajectory; management guides 30-40bps margin improvement and ROA toward ~1% by Q2-Q3.",
     "Neutral", "Estimated"),
    ("MUTHOOTMF", 20, 28, 10,
     "MFI turnaround with gold-loan diversification; FY27 AUM growth guided at 20% (revised up), ROA/ROE guided toward the upper end of 3.3%/18%.",
     "Neutral", "Company-stated"),
    ("BORORENEW", 25, 60, 10,
     "Solar glass capacity expansion (600 TPD) with anti-dumping protection; revenue targeted at ₹4,000cr from ₹2,500cr in 3-4 years, +60% sales guided on commissioning.",
     "Neutral", "Company-stated"),
    ("SHAILY", 30, 45, 15,
     "Healthcare/GLP-1 pen injector pivot now 51% of revenue (+85% YoY); FY27 guide of 36 million pens likely to be outperformed as the 25-million-unit capacity line comes online.",
     "Neutral", "Estimated"),
    ("UFBL", 30, 40, 18,
     "QSR turnaround — SSSG accelerated to 28.7%, revenue +43.4% YoY, entirely volume-led with no price hikes; management flags growth will mathematically moderate on a higher base through Q3/Q4.",
     "Neutral", "Estimated"),
]

AS_OF = "2026-08-22"
CONFIDENCE_LABEL = {"Company-stated": "High (from management's own guidance table)", "Estimated": "Medium (estimated from concrete figures given, no single overall % stated)"}


def main():
    conn = get_conn()
    try:
        existing = get_all_json(conn, "stocks")
        tracker = get_meta(conn, "guidance_tracker", {"quarters": [], "tracked": [], "cells": {}})
        if QUARTER_LABEL not in tracker["quarters"]:
            tracker["quarters"].append(QUARTER_LABEL)

        added, refreshed, failed = [], [], []
        for i, (ticker, base, bull, bear, trigger, tag, confidence) in enumerate(COMPANIES):
            was_tracked = ticker in existing
            print(f"[{i+1}/{len(COMPANIES)}] {ticker}{' (already tracked)' if was_tracked else ''} …", flush=True)
            try:
                # One retry with a backoff before giving up — confirmed
                # live (2026-08-22) that the ~1-in-5 "HTTP fetch failed"
                # errors under this rapid back-to-back loop are purely
                # transient rate-limiting (every single one of the 10
                # that failed in a 50-company run succeeded instantly on
                # a standalone retry), same pattern already documented
                # in _screener_fetch.py's own chart-API retry logic.
                data, err = fetch_one(ticker)
                if err:
                    print(f"  retrying after: {err}")
                    time.sleep(3.0)
                    data, err = fetch_one(ticker)
                if err:
                    print(f"  FETCH FAILED (after retry): {err}")
                    failed.append((ticker, err))
                    continue
                data = clean_stock(data)
                data["owned"] = existing.get(ticker, {}).get("owned", False)
                upsert_json(conn, "stocks", data["ticker"], data)
                (refreshed if was_tracked else added).append(data["ticker"])

                guidance = {
                    "revenue_growth": {"base": base, "bull": bull, "bear": bear},
                    "source_text": trigger + SOURCE_NOTE_SUFFIX,
                    "confidence": CONFIDENCE_LABEL[confidence],
                    "source_urls": [],
                    "as_of": AS_OF,
                }
                upsert_json(conn, "guidance", data["ticker"], guidance)

                if data["ticker"] not in tracker["tracked"]:
                    tracker["tracked"].append(data["ticker"])
                tracker["cells"].setdefault(data["ticker"], {})[QUARTER_LABEL] = {"note": trigger, "tag": tag}
            except Exception as e:
                print(f"  ERROR: {e}")
                failed.append((ticker, str(e)))
            time.sleep(1.5)  # pacing between companies — each fetch_one() already fires ~5-6 requests internally

        set_meta(conn, "guidance_tracker", tracker)

        print()
        print(f"Added {len(added)} new companies: {', '.join(added)}")
        print(f"Refreshed {len(refreshed)} already-tracked companies: {', '.join(refreshed)}")
        if failed:
            print(f"Failed {len(failed)}: {failed}")
        print("Done.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
