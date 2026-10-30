"""The market-ping CARD (2026-10-30: "this ui is very plain vanilla, can't get user focus"): draws the half-hourly Telegram message as one
dark dashboard image — coloured heat tiles for the indices / commodities / currencies, and bar lists for the holdings' and the Nifty 750's
top movers — so it can be read at a glance on a phone. Pure Pillow (no matplotlib), built-in font, no files to ship.

render(data) -> PNG bytes. `data`:
  now_ist (datetime), market_open (bool), fresh (bool: a "since last ping" figure exists)
  tiles: [{"group": "idx"|"oth", "label", "price", "day", "since"|None}]
  held / uni: None or {"ups": [(sym, chg, price)], "downs": [...], "weights": {sym: %}, "note": str}"""
import io

from PIL import Image, ImageDraw, ImageFont

W = 1000
PAD = 28
BG = (11, 18, 32)
PANEL = (19, 29, 48)
NEUTRAL = (30, 41, 59)
WHITE = (241, 245, 249)
MUTED = (148, 163, 184)
GREEN = (34, 197, 94)
RED = (248, 113, 113)
GREEN_BG = (21, 128, 61)
RED_BG = (185, 28, 28)
ACCENT = (56, 189, 248)

_fonts = {}


def font(size):
    if size not in _fonts:
        _fonts[size] = ImageFont.load_default(size=size)
    return _fonts[size]


def text(d, xy, s, size, fill, anchor="la", bold=False):
    d.text(xy, s, font=font(size), fill=fill, anchor=anchor, stroke_width=1 if bold else 0, stroke_fill=fill)


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def px(price):
    return f"{price:,.0f}" if price >= 1000 else f"{price:,.2f}"


def tile_color(day):
    t = min(abs(day) / 3.0, 1.0) * 0.8 + 0.2  # 3% or more = full colour; even a tiny move still tints
    if day > 0.005:
        return mix(NEUTRAL, GREEN_BG, t)
    if day < -0.005:
        return mix(NEUTRAL, RED_BG, t)
    return NEUTRAL


def section(d, y, title, right=None):
    d.rectangle([PAD, y + 4, PAD + 6, y + 30], fill=ACCENT)
    text(d, (PAD + 18, y + 17), title, 24, WHITE, "lm", bold=True)
    if right:
        text(d, (W - PAD, y + 17), right, 19, MUTED, "rm")
    return y + 44


def tiles(d, y, items, fresh):
    cols = 5
    gap = 12
    tw = (W - 2 * PAD - gap * (cols - 1)) // cols
    th = 134
    for i, it in enumerate(items):
        x = PAD + (i % cols) * (tw + gap)
        yy = y + (i // cols) * (th + gap)
        d.rounded_rectangle([x, yy, x + tw, yy + th], radius=16, fill=tile_color(it["day"]))
        text(d, (x + 14, yy + 14), it["label"].upper(), 17, (203, 213, 225), bold=True)
        text(d, (x + 14, yy + 40), px(it["price"]), 23, WHITE)
        big = f"{it['day']:+.2f}%"
        text(d, (x + 14, yy + 74), big, 34, WHITE, bold=True)
        if fresh and it.get("since") is not None:
            text(d, (x + 14, yy + 114), f"30m {it['since']:+.2f}%", 16, (226, 232, 240))
    rows = (len(items) + cols - 1) // cols
    return y + rows * (th + gap) + 6


def movers(d, y, block, with_weight):
    gap = 24
    cw = (W - 2 * PAD - gap) // 2
    ups, downs = block["ups"], block["downs"]
    biggest = max([abs(m[1]) for m in ups + downs] + [1.0])
    for ci, (title, items, col, bg) in enumerate((("TOP 5 UP", ups, GREEN, GREEN_BG), ("TOP 5 DOWN", downs, RED, RED_BG))):
        x0 = PAD + ci * (cw + gap)
        d.rounded_rectangle([x0, y, x0 + cw, y + 36 + 5 * 42 + 14], radius=16, fill=PANEL)
        tri = [(x0 + 18, y + 24), (x0 + 34, y + 24), (x0 + 26, y + 11)] if ci == 0 else [(x0 + 18, y + 12), (x0 + 34, y + 12), (x0 + 26, y + 25)]
        d.polygon(tri, fill=col)
        text(d, (x0 + 44, y + 19), title, 19, col, "lm", bold=True)
        text(d, (x0 + cw - 16, y + 19), "weight" if with_weight else "price", 16, MUTED, "rm")
        for ri in range(5):
            ry = y + 40 + ri * 42
            if ri < len(items):
                sym, chg, price = items[ri]
                text(d, (x0 + 16, ry + 20), sym[:11], 21, WHITE, "lm", bold=True)
                bx = x0 + 172
                bmax = 96
                bl = max(4, int(bmax * min(abs(chg) / biggest, 1.0)))
                d.rounded_rectangle([bx, ry + 9, bx + bl, ry + 31], radius=6, fill=bg)
                text(d, (x0 + cw - 92, ry + 20), f"{chg:+.2f}%", 20, col, "rm", bold=True)
                extra = (f"{block['weights'].get(sym, 0):.1f}%" if block["weights"].get(sym) else "0") if with_weight else px(price)
                text(d, (x0 + cw - 16, ry + 20), extra, 17, MUTED, "rm")
    return y + 36 + 5 * 42 + 14 + 18


def render(data):
    height = 1500
    img = Image.new("RGB", (W, height), BG)
    d = ImageDraw.Draw(img)
    # header
    now = data["now_ist"]
    text(d, (PAD, 40), "MARKET PULSE", 40, WHITE, "lm", bold=True)
    text(d, (PAD, 78), f"{now:%a %d %b}  ·  {now:%H:%M} IST", 22, MUTED, "lm")
    live = data["market_open"]
    pill = (21, 128, 61) if live else (71, 85, 105)
    d.rounded_rectangle([W - PAD - 150, 22, W - PAD, 62], radius=20, fill=pill)
    text(d, (W - PAD - 75, 42), "LIVE" if live else "MARKET CLOSED" if now.weekday() < 5 else "WEEKEND", 17 if live else 15, WHITE, "mm", bold=True)
    y = 112
    y = section(d, y, "INDICES", "vs previous close")
    y = tiles(d, y, [t for t in data["tiles"] if t["group"] == "idx"], data["fresh"])
    y = section(d, y + 6, "COMMODITIES & FX", "vs previous close")
    y = tiles(d, y, [t for t in data["tiles"] if t["group"] == "oth"], data["fresh"])
    if data.get("held"):
        y = section(d, y + 6, "YOUR HOLDINGS", "day %  ·  portfolio weight")
        y = movers(d, y, data["held"], True)
    if data.get("uni"):
        y = section(d, y + 2, "NIFTY 750", "day %  ·  price" + (f"   ({data['uni']['note']})" if data["uni"].get("note") else ""))
        y = movers(d, y, data["uni"], False)
    text(d, (W // 2, y + 6), "green = up, red = down  ·  deeper colour = bigger move", 16, MUTED, "mm")
    img = img.crop((0, 0, W, y + 30))
    out = io.BytesIO()
    img.save(out, "PNG", optimize=True)
    return out.getvalue()
