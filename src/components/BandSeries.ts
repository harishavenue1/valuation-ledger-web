// 2026-09-27 ("green patch was supposed to be only for the smart
// money band but you made full lower half") — a true fill BETWEEN two
// independent lines (the SmartMoney channel's top/bottom) isn't
// possible with lightweight-charts' built-in series types (Area only
// fills from a line down to the chart's own bottom edge, not to
// another moving line) — confirmed by checking the library's own
// typings before reaching for this. This is a minimal custom series
// plugin (the library's own documented extension mechanism,
// ICustomSeriesPaneView) that draws exactly that: a filled polygon
// between a `top` and `bottom` value per bar, nothing more.
import { CustomConflationContext, CustomData, CustomSeriesOptions, CustomSeriesPricePlotValues, ICustomSeriesPaneRenderer, ICustomSeriesPaneView, PaneRendererCustomData, Time, WhitespaceData, customSeriesDefaultOptions } from "lightweight-charts";

export interface BandData extends CustomData<Time> {
  top: number;
  bottom: number;
}

export interface BandSeriesOptions extends CustomSeriesOptions {
  fillColor: string;
  borderColor: string;
  borderWidth: number;
}

export const defaultBandSeriesOptions: BandSeriesOptions = {
  ...customSeriesDefaultOptions,
  fillColor: "rgba(71, 176, 39, 0.15)",
  borderColor: "rgba(71, 176, 39, 0.5)",
  borderWidth: 1,
  // A band/channel has no single meaningful "current price" — off by
  // default here at the source (2026-09-27, "why 2 horizontal rows on
  // every chart") rather than relying on every caller to remember to
  // pass this.
  priceLineVisible: false,
  lastValueVisible: false,
};

class BandSeriesRenderer implements ICustomSeriesPaneRenderer {
  private _data: PaneRendererCustomData<Time, BandData> | null = null;
  private _options: BandSeriesOptions | null = null;

  update(data: PaneRendererCustomData<Time, BandData>, options: BandSeriesOptions): void {
    this._data = data;
    this._options = options;
  }

  draw(target: Parameters<ICustomSeriesPaneRenderer["draw"]>[0], priceToCoordinate: Parameters<ICustomSeriesPaneRenderer["draw"]>[1]): void {
    if (!this._data || !this._options || this._data.bars.length === 0) return;
    const options = this._options;
    const bars = this._data.bars;

    // 2026-09-27 ("on top left corner what is wrong, some green
    // path" / "sometime bottom left corner") — a zigzag traced back to
    // the chart sometimes being (re)created before its container had
    // settled to a real size (see CandlestickChart.tsx's initChart
    // comment for the actual fix). This guard is a second, independent
    // layer: never plot a point whose coordinate isn't a finite number,
    // regardless of how a bad one might arise — a NaN/Infinity
    // priceToCoordinate result is what turns into the visible zigzag.
    const finite = (n: number) => Number.isFinite(n);

    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const ratio = scope.horizontalPixelRatio;
      const vRatio = scope.verticalPixelRatio;

      ctx.beginPath();
      let started = false;
      for (const bar of bars) {
        const y = priceToCoordinate(bar.originalData.top);
        const x = bar.x * ratio;
        if (y === null || !finite(y) || !finite(x)) continue;
        if (!started) {
          ctx.moveTo(x, y * vRatio);
          started = true;
        } else {
          ctx.lineTo(x, y * vRatio);
        }
      }
      for (let i = bars.length - 1; i >= 0; i--) {
        const bar = bars[i];
        const y = priceToCoordinate(bar.originalData.bottom);
        const x = bar.x * ratio;
        if (y === null || !finite(y) || !finite(x)) continue;
        ctx.lineTo(x, y * vRatio);
      }
      ctx.closePath();
      ctx.fillStyle = options.fillColor;
      ctx.fill();

      // Top/bottom boundary strokes, separately (a single closed-path
      // stroke would also draw the two vertical end-caps, which reads
      // as an unwanted box edge at the chart's left/right extremes).
      ctx.strokeStyle = options.borderColor;
      ctx.lineWidth = options.borderWidth * vRatio;
      for (const key of ["top", "bottom"] as const) {
        ctx.beginPath();
        let lineStarted = false;
        for (const bar of bars) {
          const y = priceToCoordinate(bar.originalData[key]);
          const x = bar.x * ratio;
          if (y === null || !finite(y) || !finite(x)) continue;
          if (!lineStarted) {
            ctx.moveTo(x, y * vRatio);
            lineStarted = true;
          } else {
            ctx.lineTo(x, y * vRatio);
          }
        }
        ctx.stroke();
      }
    });
  }
}

export class BandSeries implements ICustomSeriesPaneView<Time, BandData, BandSeriesOptions> {
  private _renderer = new BandSeriesRenderer();

  priceValueBuilder(plotRow: BandData): CustomSeriesPricePlotValues {
    return [plotRow.top, plotRow.bottom];
  }

  isWhitespace(data: BandData | WhitespaceData<Time>): data is WhitespaceData<Time> {
    return (data as Partial<BandData>).top === undefined || (data as Partial<BandData>).bottom === undefined;
  }

  renderer(): ICustomSeriesPaneRenderer {
    return this._renderer;
  }

  update(data: PaneRendererCustomData<Time, BandData>, options: BandSeriesOptions): void {
    this._renderer.update(data, options);
  }

  defaultOptions(): BandSeriesOptions {
    return defaultBandSeriesOptions;
  }

  // 2026-09-27 ("both left and right side of chart has the smart
  // money banner distorted") — at a wide range (5Y = 260 weekly bars)
  // the chart needs to CONFLATE multiple time points into fewer
  // rendered columns once each bar would be narrower than the
  // library's minimum spacing. Every other series here (candles,
  // lines) has well-tested built-in conflation; a custom series has
  // none unless it implements this method itself — without it, the
  // library was falling back to some default that didn't understand
  // this series' {top, bottom} shape, producing the jagged zigzag
  // (worst at the edges, where conflation groups are least stable).
  // Averaging top-with-top and bottom-with-bottom across the two
  // merging points is the same idea line/area series already use for
  // their own single value.
  conflationReducer(item1: CustomConflationContext<Time, BandData>, item2: CustomConflationContext<Time, BandData>): BandData {
    return {
      time: item2.data.time,
      top: (item1.data.top + item2.data.top) / 2,
      bottom: (item1.data.bottom + item2.data.bottom) / 2,
    };
  }
}
