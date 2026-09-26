import { useEffect, useState, createContext, useContext } from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { api, ApiError, Bundle } from "./lib/api";
import Login from "./pages/Login";
import Summary from "./pages/Summary";
import Companies from "./pages/Companies";
import Detail from "./pages/Detail";
import GuidanceTracker from "./pages/GuidanceTracker";
import VirajScreen from "./pages/VirajScreen";
import MomentumScreeners from "./pages/MomentumScreeners";
import TechnicalSummary from "./pages/TechnicalSummary";
import AllTechnicals from "./pages/AllTechnicals";
import AllFundamentals from "./pages/AllFundamentals";
import FixedAssetChange from "./pages/FixedAssetChange";
import PortfolioAllocation from "./pages/PortfolioAllocation";
import PortfolioPerformance from "./pages/PortfolioPerformance";
import GlobalMacro from "./pages/GlobalMacro";
import FIITrend from "./pages/FIITrend";
import SectorDirectory from "./pages/SectorDirectory";
import StrategicAlpha from "./pages/StrategicAlpha";
import Top100UsStocks from "./pages/Top100UsStocks";
import ReverseDCF from "./pages/ReverseDCF";
import ReverseDCFScan from "./pages/ReverseDCFScan";
import MTFCalculator from "./pages/MTFCalculator";
import TurtleWealth from "./pages/TurtleWealth";
import Watchlist from "./pages/Watchlist";
import Guide from "./pages/Guide";
import Settings from "./pages/Settings";

// Status of an in-flight/last "Run now" click for a cloud screener
// (see RunButton.tsx's CloudRunButton). Lives here rather than as
// component-local useState so it survives the button unmounting —
// switching Momentum Screener tabs (or navigating to Viraj Screen and
// back) remounts RunButton, and a run that's still awaiting its fetch
// on Vercel keeps going regardless; without this, losing the component
// instance mid-run also lost the only place tracking it, so the next
// mount started blank at "idle" and looked like the run had stopped.
export type CloudRunState = "idle" | "running" | "done" | "error";
export interface CloudRunEntry {
  state: CloudRunState;
  detail: string | null;
}
interface DataCtx {
  bundle: Bundle;
  setBundle: React.Dispatch<React.SetStateAction<Bundle>>;
  reload: () => Promise<void>;
  cloudRuns: Record<string, CloudRunEntry>;
  setCloudRun: (screener: string, entry: CloudRunEntry) => void;
}
const Ctx = createContext<DataCtx | null>(null);
export function useData() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData outside provider");
  return ctx;
}

// Lazily fetches the named momentum_screeners entries the first time a
// page asks for them, and caches the result in the shared bundle so
// switching tabs/pages doesn't refetch. Added 2026-09-20 — momentum_
// screeners used to arrive as part of the one big /api/stocks payload
// on every app load (88% of a 2.4MB bundle) regardless of which page,
// if any, actually needed it; now each screener page declares exactly
// which keys it uses and only those are fetched, on first visit.
export function useScreeners(names: string[]): { ready: boolean; error: string | null } {
  const { bundle, setBundle } = useData();
  const [error, setError] = useState<string | null>(null);
  const key = names.slice().sort().join(",");
  const missing = names.filter((n) => !(n in bundle.momentum_screeners));

  useEffect(() => {
    if (missing.length === 0) return;
    let cancelled = false;
    api
      .getScreeners(missing)
      .then((res) => {
        if (cancelled) return;
        setBundle((prev) => {
          const merged = { ...prev.momentum_screeners };
          for (const n of missing) {
            merged[n] = res.momentum_screeners[n] ?? merged[n] ?? { label: n, as_of: null, rows: [] };
          }
          return { ...prev, momentum_screeners: merged };
        });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { ready: missing.length === 0, error };
}

const EMPTY: Bundle = {
  stocks: {},
  scenarios: {},
  guidance: {},
  guidance_tracker: { quarters: [], tracked: [], cells: {} },
  viraj_screen: { as_of: null, rows: [] },
  momentum_screeners: {},
  run_requests: {},
  watchlist: { tickers: [] },
  last_refresh: {},
};

export default function App() {
  const [status, setStatus] = useState<"loading" | "authed" | "anon">("loading");
  const [bundle, setBundle] = useState<Bundle>(EMPTY);
  const [cloudRuns, setCloudRuns] = useState<Record<string, CloudRunEntry>>({});
  const setCloudRun = (screener: string, entry: CloudRunEntry) => setCloudRuns((prev) => ({ ...prev, [screener]: entry }));
  const navigate = useNavigate();

  async function reload() {
    const data = await api.getAll();
    setBundle(data);
    setStatus("authed");
  }

  useEffect(() => {
    api
      .getAll()
      .then((data) => {
        setBundle(data);
        setStatus("authed");
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setStatus("anon");
        else setStatus("anon");
      });
  }, []);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">
        Loading Valuation Ledger…
      </div>
    );
  }
  if (status === "anon") {
    return <Login onSuccess={() => reload()} />;
  }

  return (
    <Ctx.Provider value={{ bundle, setBundle, reload, cloudRuns, setCloudRun }}>
      <div className="min-h-screen flex flex-col">
        <header className="border-b border-slate-200 sticky top-0 bg-white/90 backdrop-blur z-20">
          {/* 2026-09-21 ("you could have increased width of table also",
              re: Portfolio Allocation's 18-column table) — widened from
              1800px to 2000px. Safe for every other page: Guide/Detail
              already self-cap narrower (1600px/1680px) via their own
              wrapper div — the established pattern here is "opt narrower
              if you don't need the full shell", not "the shell is sized
              exactly to fit every page". Summary's own card-grid
              (COL_WIDTHS ~1655px) still has comfortable margin at 2000px. */}
          <div className="max-w-[2000px] mx-auto px-4 py-3 flex items-center gap-4">
            <span className="font-semibold tracking-tight text-base text-indigo-600 flex-shrink-0">🧮 Valuation Ledger</span>
            {/* 2026-09-06 — "headers are distorted make it display with
                no slider but fit in a single row": 13 nav items no
                longer fit at text-sm/gap-4 with full labels once
                Portfolio Allocation/Global Macro/Strategic Alpha were
                added — trimmed every label to its shortest
                unambiguous form (dropping repeated/generic words like
                "Tracker", "Screen(ers)", "Summary", "Allocation") and
                tightened text size/gaps rather than adding a scrollbar
                or wrapping to a second row. */}
            <nav className="flex gap-2 text-xs whitespace-nowrap">
              <NavLink to="/" end className={({ isActive }) => navClass(isActive)}>
                Summary
              </NavLink>
              <NavLink to="/companies" className={({ isActive }) => navClass(isActive)}>
                Companies
              </NavLink>
              <NavLink to="/guidance-tracker" className={({ isActive }) => navClass(isActive)}>
                📋 Guidance
              </NavLink>
              <NavLink to="/viraj-screen" className={({ isActive }) => navClass(isActive)}>
                🎯 Viraj
              </NavLink>
              <NavLink to="/momentum-screeners" className={({ isActive }) => navClass(isActive)}>
                📈 Momentum
              </NavLink>
              <NavLink to="/technical-summary" className={({ isActive }) => navClass(isActive)}>
                🏆 Technical
              </NavLink>
              <NavLink to="/all-technicals" className={({ isActive }) => navClass(isActive)}>
                🔬 All Technicals
              </NavLink>
              <NavLink to="/all-fundamentals" className={({ isActive }) => navClass(isActive)}>
                📚 All Fundamentals
              </NavLink>
              <NavLink to="/fixed-asset-change" className={({ isActive }) => navClass(isActive)}>
                🏗️ Fixed Asset Δ
              </NavLink>
              {/* External link, not a route — 2026-09-06, "instead of
                  building page contents from chartink we can have link
                  to it saying marketBreath" (a market-breadth dashboard
                  someone else maintains on Chartink; scraping its
                  widgets was looked into and deliberately not pursued —
                  see the Technical Summary conversation). Just opens it
                  in a new tab, no data of ours involved. */}
              <a href="https://chartink.com/dashboard/163999" target="_blank" rel="noopener noreferrer" className={navClass(false)}>
                🌬️ Breadth ↗
              </a>
              <NavLink to="/portfolio-allocation" className={({ isActive }) => navClass(isActive)}>
                💼 Portfolio
              </NavLink>
              <NavLink to="/portfolio-performance" className={({ isActive }) => navClass(isActive)}>
                📊 Perf
              </NavLink>
              <NavLink to="/global-macro" className={({ isActive }) => navClass(isActive)}>
                🌍 Macro
              </NavLink>
              <NavLink to="/fii-trend" className={({ isActive }) => navClass(isActive)}>
                🌊 FII Trend
              </NavLink>
              <NavLink to="/sector-directory" className={({ isActive }) => navClass(isActive)}>
                🗂️ Sectors
              </NavLink>
              <NavLink to="/strategic-alpha" className={({ isActive }) => navClass(isActive)}>
                📡 Strategic
              </NavLink>
              <NavLink to="/top100-us-stocks" className={({ isActive }) => navClass(isActive)}>
                🇺🇸 Top100 US
              </NavLink>
              <NavLink to="/reverse-dcf" className={({ isActive }) => navClass(isActive)}>
                🔄 Rev DCF
              </NavLink>
              <NavLink to="/reverse-dcf-scan" className={({ isActive }) => navClass(isActive)}>
                📋 DCF Scan
              </NavLink>
              <NavLink to="/mtf-calculator" className={({ isActive }) => navClass(isActive)}>
                📐 MTF
              </NavLink>
              <NavLink to="/turtle-wealth" className={({ isActive }) => navClass(isActive)}>
                🐢 Turtle
              </NavLink>
              <NavLink to="/watchlist" className={({ isActive }) => navClass(isActive)}>
                ⭐ Watchlist
              </NavLink>
              <NavLink to="/guide" className={({ isActive }) => navClass(isActive)}>
                🧭 Guide
              </NavLink>
              <NavLink to="/settings" className={({ isActive }) => navClass(isActive)}>
                Settings
              </NavLink>
            </nav>
            <button
              className="ml-auto text-xs text-slate-400 hover:text-slate-700"
              onClick={async () => {
                await api.logout();
                setStatus("anon");
              }}
            >
              Log out
            </button>
          </div>
        </header>
        <main className="flex-1 max-w-[2000px] w-full mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<Summary />} />
            <Route path="/companies" element={<Companies onAdded={(t) => navigate(`/company/${t}`)} />} />
            <Route path="/company/:ticker" element={<Detail />} />
            <Route path="/guidance-tracker" element={<GuidanceTracker />} />
            <Route path="/viraj-screen" element={<VirajScreen />} />
            <Route path="/momentum-screeners" element={<MomentumScreeners />} />
            <Route path="/technical-summary" element={<TechnicalSummary />} />
            <Route path="/all-technicals" element={<AllTechnicals />} />
            <Route path="/all-fundamentals" element={<AllFundamentals />} />
            <Route path="/fixed-asset-change" element={<FixedAssetChange />} />
            <Route path="/portfolio-allocation" element={<PortfolioAllocation />} />
            <Route path="/portfolio-performance" element={<PortfolioPerformance />} />
            <Route path="/global-macro" element={<GlobalMacro />} />
            <Route path="/fii-trend" element={<FIITrend />} />
            <Route path="/sector-directory" element={<SectorDirectory />} />
            <Route path="/strategic-alpha" element={<StrategicAlpha />} />
            <Route path="/top100-us-stocks" element={<Top100UsStocks />} />
            <Route path="/reverse-dcf" element={<ReverseDCF />} />
            <Route path="/reverse-dcf-scan" element={<ReverseDCFScan />} />
            <Route path="/mtf-calculator" element={<MTFCalculator />} />
            <Route path="/turtle-wealth" element={<TurtleWealth />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/guide" element={<Guide />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </Ctx.Provider>
  );
}

function navClass(active: boolean) {
  return active ? "text-slate-900 font-medium" : "text-slate-500 hover:text-slate-800";
}
