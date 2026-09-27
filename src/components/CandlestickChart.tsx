import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, HistogramSeries, LineSeries, LogicalRangeChangeEventHandler, SeriesMarker, Time, UTCTimestamp, createChart, createSeriesMarkers } from "lightweight-charts";
import { ChartBar } from "../lib/api";

// 2026-09-27 ("start with the chart") — the app's other charts
// (StrategicAlpha's TimeSeriesChart, PortfolioAllocation's SectorDonut)
// are hand-rolled SVG specifically to avoid a charting library
// dependency for simple line/donut shapes. A real candlestick chart
// with volume + a synced RSI sub-pane + signal markers is a different
// order of problem — reinventing pan/zoom/crosshair/multi-pane sync in
// raw SVG would be a lot of code for a worse result than the purpose-
// built library. lightweight-charts is TradingView's own open-source
// library (MIT, ~45KB gzipped) — a deliberate, one-off exception to
// the "no charting library" precedent, not a general policy change.
//
// 2026-09-27 ("the chart indicator has to be our own built") — the
// overlays/markers here are this account's own 3 signal systems
// (quantBollinger, myLongTermInvestingStrategy, SmartMoney), ported
// from the user's own Pine Script — see api/momentum_screeners.py's
// chartData module comment for the full port. NOT generic MA/EMA/RSI.
const UP_COLOR = "#059669"; // emerald-600, matches Signed's positive color elsewhere in this app
const DOWN_COLOR = "#dc2626"; // red-600, matches Signed's negative color
const EMA1_COLOR = "#d4aa00"; // Pine's own EMA1 color
const EMA2_COLOR = "#94a3b8"; // Pine's own EMA2 (#dee3e7) is too light for a white background here
const SLOW_EMA_COLOR = "#47b027"; // Pine's own EMA3/slow color
const QB_UPPER_COLOR = "#0ea5e9"; // sky-500 — quantBollinger upper band
const QB_TRAIL_COLOR = "#f97316"; // orange-500 — quantBollinger 34W trail
const RSI_COLOR = "#7c3aed"; // violet-600

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
    if (b.qb_sell) markers.push({ time, position: "aboveBar", color: DOWN_COLOR, shape: "arrowDown", text: "QB" }); // red, triangledown abovebar
    if (b.mltis_buy) markers.push({ time, position: "aboveBar", color: "#06b6d4", shape: "arrowDown", text: "LTIS" }); // aqua, triangledown abovebar — Pine's own (unusual) placement, kept faithful
    if (b.mltis_sell) markers.push({ time, position: "aboveBar", color: "#f97316", shape: "square", text: "✕" }); // orange, xcross abovebar (approximated as square)
    if (b.sm_buy) markers.push({ time, position: "belowBar", color: "#0d9488", shape: "arrowUp", text: "SM Entry" }); // teal
    if (b.sm_sell) markers.push({ time, position: "aboveBar", color: "#7f1d1d", shape: "arrowDown", text: "SM Sell" }); // maroon
    if (b.sm_close) markers.push({ time, position: "inBar", color: QB_TRAIL_COLOR, shape: "circle", text: "SM Close" }); // orange, closest to Pine's absolute-position xcross
  }
  return markers;
}

export default function CandlestickChart({ bars, height = 380 }: { bars: ChartBar[]; height?: number }) {
  const mainRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mainRef.current || !rsiRef.current || bars.length === 0) return;

    const mainChart = createChart(mainRef.current, { ...COMMON_LAYOUT, height, width: mainRef.current.clientWidth });
    const rsiChart = createChart(rsiRef.current, { ...COMMON_LAYOUT, height: 110, width: rsiRef.current.clientWidth });

    const candleSeries = mainChart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderVisible: false,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
    });
    const ema1Series = mainChart.addSeries(LineSeries, { color: EMA1_COLOR, lineWidth: 1, title: "EMA1 (12W)", priceLineVisible: false, lastValueVisible: false });
    const ema2Series = mainChart.addSeries(LineSeries, { color: EMA2_COLOR, lineWidth: 1, title: "EMA2 (21W)", priceLineVisible: false, lastValueVisible: false });
    const slowEmaSeries = mainChart.addSeries(LineSeries, { color: SLOW_EMA_COLOR, lineWidth: 2, title: "Slow EMA (33W)", priceLineVisible: false, lastValueVisible: false });
    const qbUpperSeries = mainChart.addSeries(LineSeries, { color: QB_UPPER_COLOR, lineWidth: 1, lineStyle: 2, title: "QB Upper Band", priceLineVisible: false, lastValueVisible: false });
    const qbTrailSeries = mainChart.addSeries(LineSeries, { color: QB_TRAIL_COLOR, lineWidth: 1, lineStyle: 2, title: "QB Trail (34W)", priceLineVisible: false, lastValueVisible: false });
    // Volume as a low-profile histogram in the bottom ~20% of the main
    // pane, on its own price scale (id "vol") so it never fights the
    // candlesticks' own scale. Not part of the Pine script (indicator-
    // only, no volume plot) — kept anyway as a cheap, standard addition.
    const volumeSeries = mainChart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    mainChart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const rsiSeries = rsiChart.addSeries(LineSeries, { color: RSI_COLOR, lineWidth: 1, title: "RSI14", priceLineVisible: false });

    candleSeries.setData(bars.map((b) => ({ time: toUnixSeconds(b.date), open: b.open, high: b.high, low: b.low, close: b.close })));
    ema1Series.setData(bars.filter((b) => b.ema1 != null).map((b) => ({ time: toUnixSeconds(b.date), value: b.ema1 as number })));
    ema2Series.setData(bars.filter((b) => b.ema2 != null).map((b) => ({ time: toUnixSeconds(b.date), value: b.ema2 as number })));
    slowEmaSeries.setData(bars.filter((b) => b.slow_ema != null).map((b) => ({ time: toUnixSeconds(b.date), value: b.slow_ema as number })));
    qbUpperSeries.setData(bars.filter((b) => b.qb_upper != null).map((b) => ({ time: toUnixSeconds(b.date), value: b.qb_upper as number })));
    qbTrailSeries.setData(bars.filter((b) => b.qb_trail != null).map((b) => ({ time: toUnixSeconds(b.date), value: b.qb_trail as number })));
    volumeSeries.setData(bars.map((b) => ({ time: toUnixSeconds(b.date), value: b.volume ?? 0, color: b.close >= b.open ? `${UP_COLOR}66` : `${DOWN_COLOR}66` })));
    rsiSeries.setData(bars.filter((b) => b.rsi14 != null).map((b) => ({ time: toUnixSeconds(b.date), value: b.rsi14 as number })));

    createSeriesMarkers(candleSeries, buildMarkers(bars));

    // Keep both panes' visible range in sync (drag/zoom one, the other
    // follows) — the standard lightweight-charts multi-pane pattern; a
    // guard flag stops the two subscriptions from re-triggering each
    // other in an infinite loop.
    let syncing = false;
    const syncFromMain: LogicalRangeChangeEventHandler = (range) => {
      if (syncing || !range) return;
      syncing = true;
      rsiChart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    };
    const syncFromRsi: LogicalRangeChangeEventHandler = (range) => {
      if (syncing || !range) return;
      syncing = true;
      mainChart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    };
    mainChart.timeScale().subscribeVisibleLogicalRangeChange(syncFromMain);
    rsiChart.timeScale().subscribeVisibleLogicalRangeChange(syncFromRsi);

    mainChart.timeScale().fitContent();
    rsiChart.timeScale().fitContent();

    function handleResize() {
      if (mainRef.current) mainChart.applyOptions({ width: mainRef.current.clientWidth });
      if (rsiRef.current) rsiChart.applyOptions({ width: rsiRef.current.clientWidth });
    }
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncFromMain);
      rsiChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncFromRsi);
      mainChart.remove();
      rsiChart.remove();
    };
  }, [bars, height]);

  return (
    <div>
      <div ref={mainRef} />
      <div className="flex items-center gap-2 mt-1 mb-0.5">
        <span className="text-[10px] font-medium text-violet-600 pl-2">RSI (14, weekly)</span>
        <span className="text-[10px] text-slate-300">66 threshold not drawn — read the line's own level</span>
      </div>
      <div ref={rsiRef} />
    </div>
  );
}
