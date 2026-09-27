import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, HistogramSeries, LineSeries, PriceScaleMode, SeriesMarker, Time, UTCTimestamp, createChart, createSeriesMarkers } from "lightweight-charts";
import { ChartBar } from "../lib/api";
import { BandSeries } from "./BandSeries";

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
// is now a genuine filled band between sm_ch_top/sm_ch_bot, via
// BandSeries.ts's own custom series plugin — see that file's comment
// for why a plain built-in series can't do this (Area only fills down
// to the chart's own bottom edge, not to another moving line).
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
const SM_CHANNEL_FILL = "rgba(71, 176, 39, 0.15)"; // the "lighter green curve" band fill the user pointed at
const SM_CHANNEL_BORDER = "rgba(71, 176, 39, 0.5)";
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
function buildMarkers(bars: ChartBar[]): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];
  for (const b of bars) {
    const time = toUnixSeconds(b.date);
    if (b.qb_buy) markers.push({ time, position: "belowBar", color: "#84cc16", shape: "arrowUp", text: "QB" }); // lime, triangleup belowbar
    if (b.qb_sell) markers.push({ time, position: "aboveBar", color: QB_SELL_MARKER_COLOR, shape: "arrowDown", text: "QB" }); // red, triangledown abovebar
    if (b.mltis_buy) markers.push({ time, position: "aboveBar", color: "#06b6d4", shape: "arrowDown", text: "RSI>66" }); // aqua, triangledown abovebar — Pine's own (unusual) placement, kept faithful; labeled by the condition it fires on (ribbon + weekly RSI>66)
    if (b.mltis_sell) markers.push({ time, position: "aboveBar", color: "#f97316", shape: "square", text: "✕" }); // orange, xcross abovebar (approximated as square)
    if (b.sm_buy) markers.push({ time, position: "belowBar", color: "#0d9488", shape: "arrowUp", text: "SM Entry" }); // teal
    if (b.sm_sell) markers.push({ time, position: "aboveBar", color: "#7f1d1d", shape: "arrowDown", text: "SM Sell" }); // maroon
    if (b.sm_close) markers.push({ time, position: "inBar", color: QB_TRAIL_COLOR, shape: "circle", text: "SM Close" }); // orange, closest to Pine's absolute-position xcross
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
      const s = chart.addSeries(LineSeries, { color: EMA1_COLOR, lineWidth: 1, title: "EMA1 (12W)", priceLineVisible: false, lastValueVisible: false });
      s.setData(toPoints("ema1"));
    }
    if (lines.ema2) {
      const s = chart.addSeries(LineSeries, { color: EMA2_COLOR, lineWidth: 1, title: "EMA2 (21W)", priceLineVisible: false, lastValueVisible: false });
      s.setData(toPoints("ema2"));
    }
    if (lines.slowEma) {
      // 2026-09-27 ("green patch was supposed to be only for the
      // smart money band but you made full lower half") — this was
      // briefly an Area series with a gradient glow underneath, which
      // was the wrong element to shade. Plain line, like every other
      // EMA here.
      const s = chart.addSeries(LineSeries, { color: SLOW_EMA_COLOR, lineWidth: 2, title: "Slow EMA (33W)", priceLineVisible: false, lastValueVisible: false });
      s.setData(toPoints("slow_ema"));
    }
    if (lines.qbUpper) {
      const s = chart.addSeries(LineSeries, { color: QB_UPPER_COLOR, lineWidth: 1, lineStyle: 2, title: "QB Upper Band", priceLineVisible: false, lastValueVisible: false });
      s.setData(toPoints("qb_upper"));
    }
    if (lines.qbTrail) {
      const s = chart.addSeries(LineSeries, { color: QB_TRAIL_COLOR, lineWidth: 1, lineStyle: 2, title: "QB Trail (34W)", priceLineVisible: false, lastValueVisible: false });
      s.setData(toPoints("qb_trail"));
    }
    if (lines.smLines) {
      const trend = chart.addSeries(LineSeries, { color: SM_TREND_COLOR, lineWidth: 2, title: "SM Trend (SMA40)", priceLineVisible: false, lastValueVisible: false });
      trend.setData(toPoints("sm_trend"));
      const fast1 = chart.addSeries(LineSeries, { color: SM_FAST1_COLOR, lineWidth: 1, title: "SM EMA10", priceLineVisible: false, lastValueVisible: false });
      fast1.setData(toPoints("sm_fast1"));
      const fast2 = chart.addSeries(LineSeries, { color: SM_FAST2_COLOR, lineWidth: 1, title: "SM EMA20", priceLineVisible: false, lastValueVisible: false });
      fast2.setData(toPoints("sm_fast2"));
    }
    if (lines.smChannel) {
      // 2026-09-27 ("green patch was supposed to be only for the
      // smart money band") — a real filled band between sm_ch_top and
      // sm_ch_bot, not two dashed lines (the earlier approximation,
      // before it was clear the user specifically wanted the shaded
      // fill here). See BandSeries.ts's own module comment for why
      // this needed a custom series plugin.
      // 2026-09-27 ("why 2 horizontal rows on every chart") — a
      // custom series defaults to showing its own price line + last-
      // value label (here, the channel's own "bottom" value, since
      // priceValueBuilder's last array entry is treated as "current
      // price") — a second, meaningless dashed line alongside the
      // candles' own legitimate one. Every other overlay series here
      // already has both off; this one was missed.
      const band = chart.addCustomSeries(new BandSeries(), { fillColor: SM_CHANNEL_FILL, borderColor: SM_CHANNEL_BORDER, borderWidth: 1, priceLineVisible: false, lastValueVisible: false });
      band.setData(
        bars.filter((b) => b.sm_ch_top != null && b.sm_ch_bot != null).map((b) => ({ time: toUnixSeconds(b.date), top: b.sm_ch_top as number, bottom: b.sm_ch_bot as number }))
      );
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
