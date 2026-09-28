import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, HistogramSeries, LineSeries, PriceScaleMode, SeriesMarker, Time, UTCTimestamp, createChart, createSeriesMarkers } from "lightweight-charts";
import { ChartBar } from "../lib/api";

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
// was briefly a genuine filled band via a custom series plugin, then
// reverted (see the smChannel block's own comment) after that plugin
// turned out to have a reproducible edge-of-chart rendering bug that
// survived two rounds of targeted fixes. It's two dashed lines
// (sm_ch_top/sm_ch_bot) — no built-in series in this library fills
// between two independent moving lines (Area only fills down to the
// chart's own bottom edge), and a correct custom-series fill would
// need more plugin-debugging time than this cosmetic, off-by-default
// feature is worth.
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
  logScale: true,
};

// 2026-09-27 ("needs some more fine tuning, see this format" — a
// screenshot of the user's own TradingView) — pixel-sampled from the
// attached image with PIL, not eyeballed.
const UP_COLOR = "#1a796f"; // teal, pixel-sampled from the user's own TradingView screenshot
const DOWN_COLOR = "#ffb6c1"; // 2026-09-27 ("the grey candle in chart change color to pink lighttone") — CSS's own "lightpink", replacing the earlier tan/beige (which read as grey)
const EMA1_COLOR = "#d4aa00"; // Pine's own EMA1 color
const EMA2_COLOR = "#94a3b8"; // Pine's own EMA2 (#dee3e7) is too light for a white background here
const SLOW_EMA_COLOR = "#47b027"; // Pine's own EMA3/slow color
const QB_UPPER_COLOR = "#0ea5e9"; // sky-500 — quantBollinger upper band
const QB_TRAIL_COLOR = "#f97316"; // orange-500 — quantBollinger 34W trail
const SM_TREND_COLOR = "#0d9488"; // teal-600 — Pine's own smLineColor when dir==1, close enough as a fixed color
const SM_FAST1_COLOR = "#a855f7"; // purple-500
const SM_FAST2_COLOR = "#ec4899"; // pink-500
const SM_CHANNEL_LINE = "rgba(71, 176, 39, 0.6)"; // the "lighter green curve" the user pointed at — see this block's own comment for why it's two dashed lines, not a filled band
const QB_SELL_MARKER_COLOR = "#dc2626"; // Pine hardcodes color.red for this ONE marker, independent of DOWN_COLOR (candle down-color is now tan, not red — this stays red regardless)

function toUnixSeconds(dateStr: string): UTCTimestamp {
  return (Date.parse(dateStr + "T00:00:00Z") / 1000) as UTCTimestamp;
}

const COMMON_LAYOUT = {
  layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#475569", fontSize: 11 },
  grid: { vertLines: { color: "#f1f5f9" }, horzLines: { color: "#f1f5f9" } },
  rightPriceScale: { borderColor: "#e2e8f0" },
  timeScale: { borderColor: "#e2e8f0" },
  crosshair: { vertLine: { color: "#94a3b8", labelBackgroundColor: "#334155" }, horzLine: { color: "#94a3b8", labelBackgroundColor: "#334155" } },
};

// Faithful to the pasted Pine script's own shape/color/position choices
// per signal (see its plotshape() calls) — lightweight-charts' marker
// shapes are limited to circle/square/arrowUp/arrowDown, so xcross and
// Pine's "label" shapes are approximated with the closest available
// shape rather than a lookalike.
// 2026-09-28 ("also dont show the text" / "also no need to mention QB
// and RSI >66 text") — no caption under/above any marker, just the
// shape+color+position, which the MethodologyNote legend already
// explains. Also flipped RSI>66 to an up arrow below the bar ("make
// arrow for RSI>66 to uparrow instead of down arrow"), matching the
// other buy-side markers (QB/SM Entry) instead of Pine's original
// above-bar down-arrow placement.
function buildMarkers(bars: ChartBar[]): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];
  for (const b of bars) {
    const time = toUnixSeconds(b.date);
    if (b.qb_buy) markers.push({ time, position: "belowBar", color: "#84cc16", shape: "arrowUp" }); // lime
    if (b.qb_sell) markers.push({ time, position: "aboveBar", color: QB_SELL_MARKER_COLOR, shape: "arrowDown" }); // red
    if (b.mltis_buy) markers.push({ time, position: "belowBar", color: "#06b6d4", shape: "arrowUp" }); // aqua
    if (b.mltis_sell) markers.push({ time, position: "aboveBar", color: "#f97316", shape: "square" }); // orange, xcross abovebar (approximated as square)
    if (b.sm_buy) markers.push({ time, position: "belowBar", color: "#0d9488", shape: "arrowUp" }); // teal
    if (b.sm_sell) markers.push({ time, position: "aboveBar", color: "#7f1d1d", shape: "arrowDown" }); // maroon
    if (b.sm_close) markers.push({ time, position: "inBar", color: QB_TRAIL_COLOR, shape: "circle" }); // orange, closest to Pine's absolute-position xcross
  }
  return markers;
}

export default function CandlestickChart({ bars, lines = DEFAULT_LINE_VISIBILITY }: { bars: ChartBar[]; lines?: LineVisibility }) {
  const containerRef = useRef<HTMLDivElement>(null);

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
      const s = chart.addSeries(LineSeries, { color: SLOW_EMA_COLOR, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
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
      // 2026-09-27 — briefly a real filled band via a custom series
      // plugin (BandSeries.ts). That plugin had a reproducible zigzag
      // rendering bug at the chart's edges ("on top left corner what
      // is wrong" / "sometime bottom left corner" / "both left and
      // right side ... distorted") that survived two rounds of
      // targeted fixes (deferred chart init, finite-coordinate
      // guards, a conflationReducer) — for a cosmetic, off-by-default
      // feature, that's not a good trade against just reverting to
      // this simpler, two-dashed-lines approximation, which never had
      // a rendering artifact across any of its uses this session.
      const top = chart.addSeries(LineSeries, { color: SM_CHANNEL_LINE, lineWidth: 1, lineStyle: 3, priceLineVisible: false, lastValueVisible: false });
      top.setData(toPoints("sm_ch_top"));
      const bot = chart.addSeries(LineSeries, { color: SM_CHANNEL_LINE, lineWidth: 1, lineStyle: 3, priceLineVisible: false, lastValueVisible: false });
      bot.setData(toPoints("sm_ch_bot"));
    }

    // Volume as a low-profile histogram in the bottom ~20% of the pane,
    // on its own price scale (id "vol") so it never fights the
    // candlesticks' own scale. Not part of the Pine script (indicator-
    // only, no volume plot) — kept anyway as a cheap, standard addition.
    if (lines.volume) {
      const volumeSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volumeSeries.setData(bars.map((b) => ({ time: toUnixSeconds(b.date), value: b.volume ?? 0, color: b.close >= b.open ? `${UP_COLOR}66` : `${DOWN_COLOR}66` })));
    }

    candleSeries.setData(bars.map((b) => ({ time: toUnixSeconds(b.date), open: b.open, high: b.high, low: b.low, close: b.close })));
    createSeriesMarkers(candleSeries, buildMarkers(bars));

    chart.timeScale().fitContent();
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

    return () => {
      resizeObserver.disconnect();
      chart?.remove();
    };
  }, [bars, lines]);

  return <div ref={containerRef} className="w-full h-full" />;
}
