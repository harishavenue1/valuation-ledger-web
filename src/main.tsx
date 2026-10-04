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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
