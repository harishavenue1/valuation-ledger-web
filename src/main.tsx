import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { applyTheme } from "./lib/theme";

applyTheme();

// fetch the current page's code chunk in parallel with the app shell instead of after it
// (React.lazy would otherwise only ask for it once the shell had rendered the route)
const PRELOAD: [string, () => Promise<unknown>][] = [
  ["/chartist-rs-scanner", () => import("./pages/ChartistScanner")],
  ["/portfolio-allocation", () => import("./pages/PortfolioAllocation")],
  ["/guidance-valuation", () => import("./pages/GuidanceValuation")],
  ["/trade-journal", () => import("./pages/TradeJournal")],
];
PRELOAD.find(([prefix]) => location.pathname.startsWith(prefix))?.[1]().catch(() => {});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
