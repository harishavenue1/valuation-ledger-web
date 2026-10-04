import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { applyTheme } from "./lib/theme";
import { api } from "./lib/api";

applyTheme();

// All Technicals needs a ~400KB payload that does not depend on the app bundle: start it now
if (location.pathname.startsWith("/all-technicals")) {
  api.getBhavTechnicals().catch(() => {});
}
// fetch the current page's code chunk in parallel with the app shell instead of after it
// (React.lazy would otherwise only ask for it once the shell had rendered the route)
const PRELOAD: [string, () => Promise<unknown>][] = [
  ["/all-technicals", () => import("./pages/AllTechnicals")],
  ["/portfolio-charts", () => import("./pages/PortfolioCharts")],
  ["/portfolio-allocation", () => import("./pages/PortfolioAllocation")],
  ["/all-fundamentals", () => import("./pages/AllFundamentals")],
  ["/momentum-screeners", () => import("./pages/MomentumScreeners")],
];
PRELOAD.find(([prefix]) => location.pathname.startsWith(prefix))?.[1]().catch(() => {});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
