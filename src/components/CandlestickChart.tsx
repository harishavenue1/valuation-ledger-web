import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, HistogramSeries, LineSeries, LogicalRangeChangeEventHandler, UTCTimestamp, createChart } from "lightweight-charts";
import { ChartBar } from "../lib/api";

// 2026-09-27 ("start with the chart") — the app's other charts
// (StrategicAlpha's TimeSeriesChart, PortfolioAllocation's SectorDonut)
// are hand-rolled SVG specifically to avoid a charting library
// dependency for simple line/donut shapes. A real candlestick chart
// with volume + a synced RSI sub-pane is a different order of problem
// — reinventing pan/zoom/crosshair/multi-pane sync in raw SVG would be
// a lot of code for a worse result than the purpose-built library.
// lightweight-charts is TradingView's own open-source library (MIT,
// ~45KB gzipped) — a deliberate, one-off exception to the "no charting
// library" precedent, not a general policy change.
const UP_COLOR = "#059669"; // emerald-600, matches Signed's positive color elsewhere in this app
const DOWN_COLOR = "#dc2626"; // red-600, matches Signed's negative color
const MA50_COLOR = "#f59e0b"; // amber-500
const EMA21_COLOR = "#2563eb"; // blue-600
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
    const ma50Series = mainChart.addSeries(LineSeries, { color: MA50_COLOR, lineWidth: 1, title: "MA50", priceLineVisible: false, lastValueVisible: false });
    const ema21Series = mainChart.addSeries(LineSeries, { color: EMA21_COLOR, lineWidth: 1, title: "EMA21", priceLineVisible: false, lastValueVisible: false });
    // Volume as a low-profile histogram in the bottom ~20% of the main
    // pane, on its own price scale (id "vol") so it never fights the
    // candlesticks' own scale.
    const volumeSeries = mainChart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    mainChart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const rsiSeries = rsiChart.addSeries(LineSeries, { color: RSI_COLOR, lineWidth: 1, title: "RSI14", priceLineVisible: false });

    candleSeries.setData(bars.map((b) => ({ time: toUnixSeconds(b.date), open: b.open, high: b.high, low: b.low, close: b.close })));
    ma50Series.setData(bars.filter((b) => b.ma50 != null).map((b) => ({ time: toUnixSeconds(b.date), value: b.ma50 as number })));
    ema21Series.setData(bars.filter((b) => b.ema21 != null).map((b) => ({ time: toUnixSeconds(b.date), value: b.ema21 as number })));
    volumeSeries.setData(bars.map((b) => ({ time: toUnixSeconds(b.date), value: b.volume ?? 0, color: b.close >= b.open ? `${UP_COLOR}66` : `${DOWN_COLOR}66` })));
    rsiSeries.setData(bars.filter((b) => b.rsi14 != null).map((b) => ({ time: toUnixSeconds(b.date), value: b.rsi14 as number })));

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
        <span className="text-[10px] font-medium text-violet-600 pl-2">RSI (14)</span>
        <span className="text-[10px] text-slate-300">30 / 70 reference not drawn — read the line's own level</span>
      </div>
      <div ref={rsiRef} />
    </div>
  );
}
