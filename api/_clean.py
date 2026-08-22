"""Ported from ~/valuation-ledger/app.py's clean_stock() — Screener
sometimes appends a trailing "TTM" (trailing-twelve-months) column to
the annual P&L table when quarterly data has outpaced the last fiscal
year-end. Left in, `years[-1]` isn't a real "Mon YYYY" fiscal label,
which breaks anything computing off it (confirmed live: TITAN's stored
data ends with "TTM", and the model's headline_cagr()/est_year_label()
both read years[-1] unconditionally before checking anything else).

Applied once, at fetch time (right after screener_fetch.fetch_one()),
so everything downstream — DB storage, the /api/stocks bundle, the
client-side compute engine — only ever sees clean fiscal-year columns.
"""
import re

FY_LABEL_RE = re.compile(r"^(Mar|Jun|Sep|Dec)\s+\d{4}$")
ARRAY_FIELDS = [
    "revenue", "revenue_growth_pct", "expenses", "operating_profit", "opm_pct",
    "other_income", "interest", "depreciation", "pbt", "tax_pct", "net_profit",
    "pat_growth_pct", "eps", "shares_cr",
]


def clean_stock(raw):
    years = raw["years"]
    fy_idx = [i for i, y in enumerate(years) if FY_LABEL_RE.match(y)]
    stock = {k: v for k, v in raw.items() if k not in ARRAY_FIELDS and k != "years"}
    stock["years"] = [years[i] for i in fy_idx]
    for f in ARRAY_FIELDS:
        if f in raw:
            stock[f] = [raw[f][i] for i in fy_idx]
    return stock
