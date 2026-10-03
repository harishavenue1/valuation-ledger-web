import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";

// 2026-10-03 ("match it" — the user's own TradingView chart for Ram Ratna
// Wires next to ours): the Pine script draws SMALL triangles, a dot and
// two label styles, not the big built-in arrows/squares that
// lightweight-charts' own marker API is limited to. Everything is drawn
// here on the pane's canvas instead, in the colours sampled from that
// screenshot. A series primitive repaints on every pan/zoom, so positions
// are derived at draw time.
export type MarkerKind = "sell" | "rsi" | "qbBuy" | "smEntry" | "smSell" | "smClose";
export interface MarkerEvent {
  time: Time;
  kind: MarkerKind;
  high: number;
  low: number;
  close: number;
}

const COL = {
  sell: "#8a6a3d", // small brown ▾ above the bar
  rsi: "#3b9eac", // teal ▴ above the bar (RSI>66 with the EMA ribbon)
  qbBuy: "#78bf7d", // light-green ▴ below the bar
  dot: "#2f7c77", // SM Entry dot
  entryText: "#d1d4dc",
  sellBox: "#5a4830",
  sellText: "#d8cdb9",
  closeDot: "#f97316",
};

class Renderer implements IPrimitivePaneRenderer {
  constructor(private owner: MarkersPrimitive) {}
  draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]): void {
    const { chart, series, events } = this.owner;
    if (!chart || !series) return;
    const ts = chart.timeScale();
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const e of events) {
        const x = ts.timeToCoordinate(e.time);
        if (x == null || x < -20 || x > mediaSize.width + 20) continue;
        const yHigh = series.priceToCoordinate(e.high);
        const yLow = series.priceToCoordinate(e.low);
        const yClose = series.priceToCoordinate(e.close);
        if (yHigh == null || yLow == null) continue;
        switch (e.kind) {
          case "sell":
            tri(ctx, x, yHigh - 9, 5, 4, "down", COL.sell);
            break;
          case "rsi":
            tri(ctx, x, yHigh - 9, 5, 4, "up", COL.rsi);
            break;
          case "qbBuy":
            tri(ctx, x, yLow + 9, 5, 4, "up", COL.qbBuy);
            break;
          case "smEntry":
            ctx.fillStyle = COL.dot;
            ctx.beginPath();
            ctx.arc(x, yLow + 11, 3.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = COL.entryText;
            ctx.fillText("SM Entry", x, yLow + 26);
            break;
          case "smSell": {
            const w = ctx.measureText("SM Sell").width + 12;
            const cy = yHigh - 26;
            ctx.fillStyle = COL.sellBox;
            roundRect(ctx, x - w / 2, cy - 9, w, 18, 4);
            ctx.fill();
            ctx.fillStyle = COL.sellText;
            ctx.fillText("SM Sell", x, cy + 0.5);
            break;
          }
          case "smClose":
            if (yClose == null) break;
            ctx.fillStyle = COL.closeDot;
            ctx.beginPath();
            ctx.arc(x, yClose, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = COL.entryText;
            ctx.fillText("SM Close", x, yClose + 15);
            break;
        }
      }
    });
  }
}

function tri(ctx: CanvasRenderingContext2D, x: number, cy: number, halfW: number, halfH: number, dir: "up" | "down", color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  if (dir === "up") {
    ctx.moveTo(x, cy - halfH);
    ctx.lineTo(x + halfW, cy + halfH);
    ctx.lineTo(x - halfW, cy + halfH);
  } else {
    ctx.moveTo(x, cy + halfH);
    ctx.lineTo(x + halfW, cy - halfH);
    ctx.lineTo(x - halfW, cy - halfH);
  }
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class MarkersPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  private view: IPrimitivePaneView;
  constructor(public events: MarkerEvent[]) {
    const renderer = new Renderer(this);
    this.view = { zOrder: () => "top", renderer: () => renderer };
  }
  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart as IChartApi;
    this.series = p.series as ISeriesApi<SeriesType>;
  }
  detached() {
    this.chart = null;
    this.series = null;
  }
  paneViews() {
    return [this.view];
  }
}
