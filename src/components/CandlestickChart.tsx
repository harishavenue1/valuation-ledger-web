import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, PriceScaleMode, Time, UTCTimestamp, createChart } from "lightweight-charts";
import { ChartBar, ChartLevel } from "../lib/api";
import { BandSeries } from "./BandSeries";
import { MarkerEvent, MarkersPrimitive } from "./ChartMarkers";
import { AnchorSpec, computeAvwap } from "../lib/avwap";

// 2026-09-27 ("start with the chart") — the app's other charts
// (StrategicAlpha's TimeSeriesChart, PortfolioAllocation's SectorDonut)
// are hand-rolled SVG specifically to avoid a charting library
// dependency for simple line/donut shapes. A real candlestick chart
// with volume + signal markers is a different order of problem —
// reinventing pan/zoom/crosshair sync in raw SVG would be a lot of
// code for a worse result than the purpose-built library.
// lightweight-charts is TradingView's own open-source library (MIT,
// ~45KB gzipped) — a deliberate, one-off exception to the "no
// charting library" precedent, not a general policy change.
//
// 2026-09-27 ("the chart indicator has to be our own built") — the
// overlays/markers here are this account's own 3 signal systems
// (quantBollinger, myLongTermInvestingStrategy, SmartMoney), ported
// from the user's own Pine Script — see api/momentum_screeners.py's
// chartData module comment for the full port. NOT generic MA/EMA/RSI.
//
// 2026-09-27 ("give controls to modify the lines, as I did on trading
// view... currently on 33WEMA green line with smart indicator in
// lighter green curve") — the Pine script's own smShowLines/
// smShowChannel toggles (both default OFF) are now real controls here
// too, not a fixed on/off choice baked into the component.
//
// 2026-09-27 ("green patch was supposed to be only for the smart
// money band but you made full lower half") — the SmartMoney channel
// is a genuine filled band (sm_ch_top/sm_ch_bot) via BandSeries.ts's
// custom series plugin — no built-in series in this library fills
// between two independent moving lines (Area only fills down to the
// chart's own bottom edge). Was briefly reverted to two dashed lines
// after the plugin had a reproducible edge-of-chart zigzag; rebuilt
// 2026-09-28 after actually finding the cause — see BandSeries.ts's
// own module comment.
//
// 2026-09-27 ("remove rsi as its already built-in with indicator and
// expand the chart to full screen to utilize free space") — the
// separate RSI sub-pane (and the crosshair-sync plumbing it needed
// between two chart instances) is gone; RSI>66 is already visible as
// the myLongTermInvestingStrategy marker on the main chart. The
// component no longer takes a fixed `height` — it fills whatever
// height its container is given via CSS (a ResizeObserver on the
// wrapper div), so a page can make it as large as the available
// layout allows instead of this component dictating a fixed size.
//
// 2026-09-28 ("also dont show the text") — every overlay LineSeries
// had `priceLineVisible: false, lastValueVisible: false` yet was still
// showing a floating colored "title" pill mid-pane at its last value
// (confirmed live via Chart Settings — unchecking a line made
// specifically its own pill disappear, e.g. EMA1's). Root cause:
// lightweight-charts' series `title` renders that pane label whenever
// it's a non-empty string, independent of both those flags — neither
// one governs it. Fix is to just not set `title` on these series at
// all; the existing dot-legend row above the chart in
// PortfolioCharts.tsx already names/values each line, so nothing reads
// `title` elsewhere.
export interface LineVisibility {
  ema1: boolean;
  ema2: boolean;
  slowEma: boolean;
  qbUpper: boolean;
  qbTrail: boolean;
  smLines: boolean; // SmartMoney EMA(10)/EMA(20)/SMA(40) trend — Pine's smShowLines
  smChannel: boolean; // SmartMoney ATR channel top/bottom — Pine's smShowChannel
  volume: boolean;
  // Prior-high levels (dashed, from the bar that made the high out to the
  // latest bar) — see api/momentum_screeners.py _run_chart_data
  lvl8: boolean;
  lvl13: boolean;
  lvl26: boolean;
  lvl39: boolean;
  lvl52: boolean;
  lvlAth: boolean;
  // 2026-09-27 ("chart needs log format") — not really a "line", but
  // lives in the same settings object/panel/localStorage entry as
  // everything else here rather than its own separate piece of state.
  logScale: boolean;
}
export const DEFAULT_LINE_VISIBILITY: LineVisibility = {
  ema1: true,
  ema2: true,
  slowEma: true,
  qbUpper: true,
  qbTrail: true,
  smLines: false,
  smChannel: false,
  volume: true,
  lvl8: true,
  lvl13: true,
  lvl26: false,
  lvl39: true,
  lvl52: false,
  lvlAth: true,
  logScale: true,
};

export const LEVEL_COLORS: Record<string, string> = {
  h8: "#7c8594",
  h13: "#8d96a3",
  h26: "#a2aab5",
  h39: "#b5bcc6",
  h52: "#c9ced6",
  ath: "#5194f0", // TradingView's blue axis tag (sampled)
};
const LEVEL_FLAG: Record<string, keyof LineVisibility> = { h8: "lvl8", h13: "lvl13", h26: "lvl26", h39: "lvl39", h52: "lvl52", ath: "lvlAth" };
export function visibleLevels(levels: ChartLevel[] | undefined, lines: LineVisibility): ChartLevel[] {
  // Two windows often land on the same bar (2M and 3M both = the same high; 9M
  // = ATH when the stock is still below its top): draw one line, name it with
  // every label that shares it, ATH's colour winning.
  const order = ["ath", "h52", "h39", "h26", "h13", "h8"];
  const shown = (levels ?? []).filter((l) => lines[LEVEL_FLAG[l.key]]).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const out: ChartLevel[] = [];
  for (const l of shown) {
    const twin = out.find((o) => Math.abs(o.price - l.price) < 0.005);
    if (twin) twin.label = `${twin.label} = ${l.label}`;
    else out.push({ ...l });
  }
  return out;
}

// 2026-09-27 ("needs some more fine tuning, see this format" — a
// screenshot of the user's own TradingView) — pixel-sampled from the
// attached image with PIL, not eyeballed.
const UP_COLOR = "#2e796f"; // teal, pixel-sampled from the user's own TradingView screenshot
const DOWN_COLOR = "#a49077"; // 2026-09-27 ("the grey candle in chart change color to pink lighttone") — CSS's own "lightpink", replacing the earlier tan/beige (which read as grey)
const UP_TEXT = "#389d8b"; // TradingView legend text colours (sampled)
const DOWN_TEXT = "#d9894a";
const VOL_UP = "#1d5553"; // sampled from the TradingView layout
const VOL_DOWN = "#752e33";
const EMA1_COLOR = "#d4aa00"; // Pine's own EMA1 color
const EMA2_COLOR = "#94a3b8"; // Pine's own EMA2 (#dee3e7) is too light for a white background here
const SLOW_EMA_COLOR = "#3f6a50"; // muted green like the TradingView layout // Pine's own EMA3/slow color
const QB_UPPER_COLOR = "#0ea5e9"; // sky-500 — quantBollinger upper band
const QB_TRAIL_COLOR = "#f97316"; // orange-500 — quantBollinger 34W trail
const SM_TREND_COLOR = "#0d9488"; // teal-600 — Pine's own smLineColor when dir==1, close enough as a fixed color
const SM_FAST1_COLOR = "#a855f7"; // purple-500
const SM_FAST2_COLOR = "#ec4899"; // pink-500
// 2026-10-01 ("why my charts not matching with trading view charts") —
// this was literally the same RGB (71, 176, 39) as SLOW_EMA_COLOR
// above, just lower opacity: with both the Slow EMA line and the
// SmartMoney channel visible, they blended into what read as one
// confusing green line/band, unlike TradingView's single unambiguous
// EMA line. Shifted to indigo — distinct from every other line color
// on this chart (green/teal/purple/pink/sky/orange/gold/slate already
// taken), still reads as a "zone" rather than a line.
const SM_CHANNEL_FILL = "rgba(255, 255, 255, 0.035)"; // indigo-500 — the "lighter green curve"/"thin intense green wave" the user pointed at — a real filled band via BandSeries.ts
const SM_CHANNEL_BORDER = "rgba(63, 106, 80, 0.55)";
const QB_SELL_MARKER_COLOR = "#dc2626"; // Pine hardcodes color.red for this ONE marker, independent of DOWN_COLOR (candle down-color is now tan, not red — this stays red regardless)

function toUnixSeconds(dateStr: string): UTCTimestamp {
  return (Date.parse(dateStr + "T00:00:00Z") / 1000) as UTCTimestamp;
}

// 2026-10-03 ("match it") — dark chart like the user's TradingView layout;
// colours pixel-sampled from the screenshot (background #14171f, no grid).
const CHART_BG = "#14171f";
const RIGHT_GAP_BARS = 10; // empty bars after the latest candle, like TradingView
const COMMON_LAYOUT = {
  layout: { background: { type: ColorType.Solid, color: CHART_BG }, textColor: "#a4a4a6", fontSize: 11 },
  grid: { vertLines: { visible: false }, horzLines: { visible: false } },
  rightPriceScale: { borderColor: "#2a2e39" },
  timeScale: { borderColor: "#2a2e39" },
  // 2026-10-03 ("update the cursorhair like this") — TradingView's: 1px SOLID
  // grey (#919191) lines, labels on a #2f333c box with white text, and the
  // date label as "Mon 01 Jun '26". Colours sampled from the screenshot.
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: "#919191", width: 1 as const, style: LineStyle.Solid, labelBackgroundColor: "#2f333c", labelVisible: true },
    horzLine: { color: "#919191", width: 1 as const, style: LineStyle.Solid, labelBackgroundColor: "#2f333c", labelVisible: true },
  },
  localization: { timeFormatter: (t: Time) => formatCrosshairDate(t) },
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatCrosshairDate(t: Time): string {
  if (typeof t !== "number") return String(t);
  const d = new Date(t * 1000);
  return `${WEEKDAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`;
}

// Faithful to the pasted Pine script's own shape/color/position choices
// per signal (see its plotshape() calls) — lightweight-charts' marker
// shapes are limited to circle/square/arrowUp/arrowDown, so xcross and
// Pine's "label" shapes are approximated with the closest available
// shape rather than a lookalike.
// 2026-09-28 ("also dont show the text" / "also no need to mention QB
// and RSI >66 text") — that exclusion was scoped to exactly those two
// ("SM ENTRY and SM EXIT was not supposed to be removed") — QB/RSI>66
// markers stay caption-free, every SmartMoney marker (and the EMA-
// breakdown ✕) keeps its own text, same as before. Also flipped
// RSI>66 to an up arrow below the bar ("make arrow for RSI>66 to
// uparrow instead of down arrow"), matching the other buy-side
// markers (QB/SM Entry) instead of Pine's original above-bar
// down-arrow placement.
function buildMarkerEvents(bars: ChartBar[]): MarkerEvent[] {
  const ev: MarkerEvent[] = [];
  for (const b of bars) {
    const time = toUnixSeconds(b.date);
    const base = { time, high: b.high, low: b.low, close: b.close };
    // the EMA-ribbon exit and the QB trail break usually land on the same
    // week; TradingView draws one small triangle for them, not two shapes
    if (b.qb_sell || b.mltis_sell) ev.push({ ...base, kind: "sell" });
    if (b.mltis_buy) ev.push({ ...base, kind: "rsi" });
    if (b.qb_buy) ev.push({ ...base, kind: "qbBuy" });
    if (b.sm_buy) ev.push({ ...base, kind: "smEntry" });
    if (b.sm_sell) ev.push({ ...base, kind: "smSell" });
    if (b.sm_close) ev.push({ ...base, kind: "smClose" });
  }
  return ev;
}

export default function CandlestickChart({
  bars,
  lines = DEFAULT_LINE_VISIBILITY,
  levels,
  anchors,
  pickMode = false,
  onPick,
}: {
  bars: ChartBar[];
  lines?: LineVisibility;
  levels?: ChartLevel[];
  anchors?: AnchorSpec[]; // optional anchored VWAPs — none unless the user switches one on
  pickMode?: boolean; // next click on a bar sets an anchor date
  onPick?: (date: string) => void;
}) {
  const pickRef = useRef({ pickMode, onPick });
  pickRef.current = { pickMode, onPick };
  const anchorsKey = JSON.stringify((anchors ?? []).filter((a) => a.enabled && a.date));
  const containerRef = useRef<HTMLDivElement>(null);
  // OHLC readout under the cursor (TradingView's top-left legend); the latest bar when the cursor is off the chart
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const byDate = useMemo(() => new Map(bars.map((b, i) => [b.date, i])), [bars]);
  // the zoom/scroll position survives toggling a line in Chart Settings (TradingView keeps its view when an indicator is switched)
  const savedView = useRef<{ sig: string; from: number; to: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current || bars.length === 0) return;
    const container = containerRef.current;

    // 2026-09-27 ("on top left corner what is wrong, some green
    // path" / "sometime bottom left corner") — a stray zigzag from
    // the SmartMoney band's custom renderer, only ever at a corner,
    // only sometimes. Root cause: this component used to call
    // createChart() synchronously at mount using container.
    // clientWidth/clientHeight, but the flex-column layout in
    // PortfolioCharts.tsx hasn't necessarily finished sizing the
    // container on the very first paint — the chart could initialize
    // at a transitional 0×0 or wrong size, draw the custom series
    // once against that bad geometry, and the leftover pixels from
    // that one bad frame never got cleared since later ResizeObserver
    // callbacks only redraw with corrected data, not a full clear of
    // stale canvas content in an unrelated region. Deferring the
    // FIRST chart creation until the first real ResizeObserver
    // callback (a non-zero size) avoids ever drawing at a bad size in
    // the first place, rather than trying to clean up after it.
    let chart: ReturnType<typeof createChart> | null = null;

    function initChart(width: number, height: number) {
      if (chart || width <= 0 || height <= 0) return;
      chart = createChart(container, {
        ...COMMON_LAYOUT,
        height,
        width,
        rightPriceScale: { ...COMMON_LAYOUT.rightPriceScale, mode: lines.logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
        // 2026-10-03 ("on zooming the behaviour is different on tradingview"):
        // TradingView keeps a gap of empty bars to the right of the latest bar
        // and zooms with the RIGHT EDGE fixed (bars grow/shrink leftwards),
        // not around the cursor. The wheel is handled below for that; pinch
        // and axis-drag stay the library's own.
        timeScale: { ...COMMON_LAYOUT.timeScale, rightOffset: RIGHT_GAP_BARS, minBarSpacing: 1, barSpacing: 8 },
        handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      });
      setUpSeries(chart);
    }

    function setUpSeries(chart: ReturnType<typeof createChart>) {
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderVisible: false,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
      lastValueVisible: false, // TradingView layout shows no last-price tag / line
      priceLineVisible: false,
    });

    const toPoints = (key: keyof ChartBar) => bars.filter((b) => b[key] != null).map((b) => ({ time: toUnixSeconds(b.date), value: b[key] as number }));

    if (lines.ema1) {
      const s = chart.addSeries(LineSeries, { color: EMA1_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      s.setData(toPoints("ema1"));
    }
    if (lines.ema2) {
      const s = chart.addSeries(LineSeries, { color: EMA2_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      s.setData(toPoints("ema2"));
    }
    if (lines.slowEma) {
      // 2026-09-27 ("green patch was supposed to be only for the
      // smart money band but you made full lower half") — this was
      // briefly an Area series with a gradient glow underneath, which
      // was the wrong element to shade. Plain line, like every other
      // EMA here.
      const s = chart.addSeries(LineSeries, { color: SLOW_EMA_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      s.setData(toPoints("slow_ema"));
    }
    if (lines.qbUpper) {
      const s = chart.addSeries(LineSeries, { color: QB_UPPER_COLOR, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
      s.setData(toPoints("qb_upper"));
    }
    if (lines.qbTrail) {
      const s = chart.addSeries(LineSeries, { color: QB_TRAIL_COLOR, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
      s.setData(toPoints("qb_trail"));
    }
    if (lines.smLines) {
      const trend = chart.addSeries(LineSeries, { color: SM_TREND_COLOR, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      trend.setData(toPoints("sm_trend"));
      const fast1 = chart.addSeries(LineSeries, { color: SM_FAST1_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      fast1.setData(toPoints("sm_fast1"));
      const fast2 = chart.addSeries(LineSeries, { color: SM_FAST2_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      fast2.setData(toPoints("sm_fast2"));
    }
    if (lines.smChannel) {
      // 2026-09-28 — rebuilt as a real filled band via BandSeries.ts's
      // custom series plugin, after finding the actual cause of the
      // earlier zigzag (see that file's own module comment — the
      // renderer wasn't slicing its bars down to the chart's
      // visibleRange, so it was drawing through off-screen buffered
      // data on every redraw). Was a two-dashed-lines approximation in
      // between while that was unresolved.
      const bandData = bars
        .filter((b) => b.sm_ch_top != null && b.sm_ch_bot != null)
        .map((b) => ({ time: toUnixSeconds(b.date), top: b.sm_ch_top as number, bottom: b.sm_ch_bot as number }));
      const band = chart.addCustomSeries(new BandSeries((t) => chart.timeScale().timeToCoordinate(t), bandData), {
        fillColor: SM_CHANNEL_FILL,
        borderColor: SM_CHANNEL_BORDER,
        borderWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      band.setData(bandData);
    }

    // Volume as a low-profile histogram in the bottom ~20% of the pane,
    // on its own price scale (id "vol") so it never fights the
    // candlesticks' own scale. Not part of the Pine script (indicator-
    // only, no volume plot) — kept anyway as a cheap, standard addition.
    if (lines.volume) {
      const volumeSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volumeSeries.setData(bars.map((b) => ({ time: toUnixSeconds(b.date), value: b.volume ?? 0, color: b.close >= b.open ? VOL_UP : VOL_DOWN })));
    }

    // Prior-high levels: a dashed line from the bar that made the high (or the
    // left edge of the view) to the latest bar, with the price on the axis.
    // autoscaleInfoProvider -> null keeps a far-away level (an ATH 40% above)
    // from squashing the candles; out-of-view levels are simply not drawn.
    const firstT = toUnixSeconds(bars[0].date);
    const lastT = toUnixSeconds(bars[bars.length - 1].date);
    for (const lv of visibleLevels(levels, lines)) {
      const startT = Math.max(toUnixSeconds(lv.date), firstT) as UTCTimestamp;
      const startUse = startT >= lastT ? (toUnixSeconds(bars[Math.max(0, bars.length - 2)].date) as UTCTimestamp) : startT;
      // ATH is drawn the way the user's TradingView layout shows it: a 1px
      // solid dim-blue line (#284062) from the ATH bar to the edge, with a
      // light-blue price tag (#5194f0, dark text) on the axis.
      const isAth = lv.key === "ath";
      const s = chart.addSeries(LineSeries, {
        color: isAth ? "#284062" : LEVEL_COLORS[lv.key] ?? "#78716c",
        lineWidth: 1,
        lineStyle: isAth ? 0 : 2,
        priceLineVisible: false,
        lastValueVisible: !isAth,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => null,
      });
      if (isAth) s.createPriceLine({ price: lv.price, lineVisible: false, axisLabelVisible: true, axisLabelColor: "#5194f0", axisLabelTextColor: "#06080b", title: "" });
      s.setData([
        { time: startUse, value: lv.price },
        { time: lastT, value: lv.price },
      ]);
    }

    // Anchored VWAPs (optional): the VWAP line with its SD bands, one colour per anchor
    for (const a of (anchors ?? []).filter((x) => x.enabled && x.date)) {
      const pts = computeAvwap(bars, a.date);
      if (pts.length === 0) continue;
      const line = chart.addSeries(LineSeries, { color: a.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false });
      line.setData(pts.map((p) => ({ time: toUnixSeconds(p.date), value: p.vwap })));
      for (let k = 1; k <= Math.min(3, Math.max(0, a.bands)); k++) {
        for (const sign of [1, -1]) {
          const band = chart.addSeries(LineSeries, {
            color: a.color + (k === 1 ? "cc" : k === 2 ? "88" : "55"),
            lineWidth: 1,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            autoscaleInfoProvider: () => null, // a far 3-SD band must not squash the candles
          });
          band.setData(pts.map((p) => ({ time: toUnixSeconds(p.date), value: p.vwap + sign * k * p.sd })));
        }
      }
    }

    candleSeries.setData(bars.map((b) => ({ time: toUnixSeconds(b.date), open: b.open, high: b.high, low: b.low, close: b.close })));
    candleSeries.attachPrimitive(new MarkersPrimitive(buildMarkerEvents(bars)));
    chart.subscribeClick((param) => {
      if (!pickRef.current.pickMode || typeof param.time !== "number") return;
      pickRef.current.onPick?.(new Date(param.time * 1000).toISOString().slice(0, 10));
    });
    chart.subscribeCrosshairMove((param) => {
      const t = param.time;
      if (typeof t !== "number" || !param.point) {
        setHoverDate(null);
        return;
      }
      setHoverDate(new Date(t * 1000).toISOString().slice(0, 10));
    });

    // TradingView's own "High / Low" axis tags for the visible range
    const hi = Math.max(...bars.map((b) => b.high));
    const lo = Math.min(...bars.map((b) => b.low));
    for (const [price, title] of [[hi, "High"], [lo, "Low"]] as [number, string][]) {
      candleSeries.createPriceLine({ price, title, color: "transparent", lineVisible: false, axisLabelVisible: true, axisLabelColor: "#142a55", axisLabelTextColor: "#8fb3ff" });
    }

    // fit every bar plus the right-hand gap (fitContent() would drop the gap)
    const sig = `${bars[0].date}|${bars.length}|${bars[bars.length - 1].date}`;
    const keep = savedView.current && savedView.current.sig === sig ? savedView.current : null;
    chart.timeScale().setVisibleLogicalRange(keep ? { from: keep.from, to: keep.to } : { from: -0.5, to: bars.length - 1 + RIGHT_GAP_BARS });
    } // end setUpSeries

    // Fills whatever size its container is given by CSS (flex-1 in
    // PortfolioCharts.tsx) rather than the component dictating a fixed
    // pixel size — a plain window-resize listener wouldn't catch a
    // container that changes size without the WINDOW changing (e.g.
    // the sidebar's own content reflowing), so this observes the
    // container element itself. Also the trigger for the FIRST chart
    // creation (see initChart's own comment above) rather than a
    // separate synchronous createChart call at mount.
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      if (!chart) initChart(width, height);
      else chart.applyOptions({ width, height });
    });
    resizeObserver.observe(container);

    // wheel / trackpad-pinch zoom anchored at the right edge: changing the bar
    // spacing alone leaves the right offset (and so the latest bar) in place
    function onWheel(e: WheelEvent) {
      if (!chart) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // horizontal pan is the library's
      e.preventDefault();
      const ts = chart.timeScale();
      const vr = ts.getVisibleLogicalRange();
      if (!vr || ts.width() <= 0) return;
      const spacing = ts.width() / (vr.to - vr.from + 1); // current px per bar (options().barSpacing goes stale after a range set)
      const next = Math.min(120, Math.max(1, spacing * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
      ts.applyOptions({ barSpacing: next });
    }
    container.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      const vr = chart?.timeScale().getVisibleLogicalRange();
      if (vr && bars.length > 0) savedView.current = { sig: `${bars[0].date}|${bars.length}|${bars[bars.length - 1].date}`, from: vr.from, to: vr.to };
      resizeObserver.disconnect();
      container.removeEventListener("wheel", onWheel);
      chart?.remove();
    };
  }, [bars, lines, levels, anchorsKey]);

  const idx = hoverDate != null && byDate.has(hoverDate) ? (byDate.get(hoverDate) as number) : bars.length - 1;
  const cur = bars[idx];
  const prev = idx > 0 ? bars[idx - 1] : undefined;
  const chg = cur && prev ? cur.close - prev.close : null;
  const chgPct = cur && prev && prev.close ? (chg! / prev.close) * 100 : null;
  const up = (chg ?? 0) >= 0;
  const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtVol = (v: number | null) => (v == null ? "—" : v >= 1e7 ? `${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(2)} L` : v >= 1e3 ? `${(v / 1e3).toFixed(2)} K` : String(v));
  return (
    <div className="relative w-full h-full" style={pickMode ? { cursor: "crosshair" } : undefined}>
      <div ref={containerRef} className="w-full h-full" />
      {cur && (
        <div className="absolute top-1 left-2 z-10 pointer-events-none text-[11px] tabular-nums flex flex-wrap gap-x-3" style={{ color: "#a4a4a6" }}>
          <span>
            O <span style={{ color: up ? UP_TEXT : DOWN_TEXT }}>{fmt(cur.open)}</span>
          </span>
          <span>
            H <span style={{ color: up ? UP_TEXT : DOWN_TEXT }}>{fmt(cur.high)}</span>
          </span>
          <span>
            L <span style={{ color: up ? UP_TEXT : DOWN_TEXT }}>{fmt(cur.low)}</span>
          </span>
          <span>
            C <span style={{ color: up ? UP_TEXT : DOWN_TEXT }}>{fmt(cur.close)}</span>
          </span>
          {chg != null && chgPct != null && (
            <span style={{ color: up ? UP_TEXT : DOWN_TEXT }}>
              {chg >= 0 ? "+" : "−"}
              {fmt(Math.abs(chg))} ({chg >= 0 ? "+" : "−"}
              {Math.abs(chgPct).toFixed(2)}%)
            </span>
          )}
          <span>
            Vol <span style={{ color: up ? UP_TEXT : DOWN_TEXT }}>{fmtVol(cur.volume)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
