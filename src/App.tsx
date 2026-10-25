import { Suspense, lazy, useEffect, useRef, useState, createContext, useContext } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError, Bundle } from "./lib/api";
import { getTheme, setTheme, Theme } from "./lib/theme";
import Login from "./pages/Login";
import Summary from "./pages/Summary";
const Companies = lazy(() => import("./pages/Companies"));
const Detail = lazy(() => import("./pages/Detail"));
const GuidanceTracker = lazy(() => import("./pages/GuidanceTracker"));
const VirajScreen = lazy(() => import("./pages/VirajScreen"));
const MomentumScreeners = lazy(() => import("./pages/MomentumScreeners"));
const TechnicalSummary = lazy(() => import("./pages/TechnicalSummary"));
const AllTechnicals = lazy(() => import("./pages/AllTechnicals"));
const AllFundamentals = lazy(() => import("./pages/AllFundamentals"));
const FixedAssetChange = lazy(() => import("./pages/FixedAssetChange"));
const PortfolioAllocation = lazy(() => import("./pages/PortfolioAllocation"));
const PortfolioPerformance = lazy(() => import("./pages/PortfolioPerformance"));
const GlobalMacro = lazy(() => import("./pages/GlobalMacro"));
const FIITrend = lazy(() => import("./pages/FIITrend"));
const MarketPulse = lazy(() => import("./pages/MarketPulse"));
const Directory = lazy(() => import("./pages/Directory"));
const Business = lazy(() => import("./pages/Business"));
import { BusinessNavBadge } from "./lib/businessAlerts";
const PortfolioCharts = lazy(() => import("./pages/PortfolioCharts"));
const StrategicAlpha = lazy(() => import("./pages/StrategicAlpha"));
const Top100UsStocks = lazy(() => import("./pages/Top100UsStocks"));
const ReverseDCF = lazy(() => import("./pages/ReverseDCF"));
const ReverseDCFScan = lazy(() => import("./pages/ReverseDCFScan"));
const MTFCalculator = lazy(() => import("./pages/MTFCalculator"));
const TurtleWealth = lazy(() => import("./pages/TurtleWealth"));
const Watchlist = lazy(() => import("./pages/Watchlist"));
const Guide = lazy(() => import("./pages/Guide"));
const Settings = lazy(() => import("./pages/Settings"));

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

// A saved company with no financial years (e.g. a fresh listing Screener has no annual table for) used to crash every page that
// reads its last year — one bad record blanked the whole app. Such records are left out of the bundle instead.
function dropBrokenStocks(data: Bundle): Bundle {
  const ok: Bundle["stocks"] = {};
  for (const [t, s] of Object.entries(data.stocks ?? {})) {
    if (Array.isArray((s as any)?.years) && (s as any).years.length > 0 && typeof (s as any).years[(s as any).years.length - 1] === "string") ok[t] = s;
    else console.warn(`Skipping ${t}: no financial years on record`);
  }
  return { ...data, stocks: ok };
}

export default function App() {
  const [status, setStatus] = useState<"loading" | "authed" | "anon">("loading");
  const [themeState, setThemeState] = useState<Theme>(() => getTheme());
  const [bundle, setBundle] = useState<Bundle>(EMPTY);
  const [cloudRuns, setCloudRuns] = useState<Record<string, CloudRunEntry>>({});
  const setCloudRun = (screener: string, entry: CloudRunEntry) => setCloudRuns((prev) => ({ ...prev, [screener]: entry }));
  const navigate = useNavigate();

  async function reload() {
    const data = await api.getAll();
    setBundle(dropBrokenStocks(data));
    setStatus("authed");
  }

  useEffect(() => {
    api
      .getAll()
      .then((data) => {
        setBundle(dropBrokenStocks(data));
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
            <button
              onClick={() => {
                const next = getTheme() === "dark" ? "light" : "dark";
                setTheme(next);
                setThemeState(next);
              }}
              className="text-sm px-1.5 rounded border border-slate-300 hover:border-slate-400 flex-shrink-0"
              title="Switch between the TradingView-style dark theme and the light theme"
            >
              {themeState === "dark" ? "☀️" : "🌙"}
            </button>
            {/* 2026-09-06 — "headers are distorted make it display with
                no slider but fit in a single row": 13 nav items no
                longer fit at text-sm/gap-4 with full labels once
                Portfolio Allocation/Global Macro/Strategic Alpha were
                added — trimmed every label to its shortest
                unambiguous form (dropping repeated/generic words like
                "Tracker", "Screen(ers)", "Summary", "Allocation") and
                tightened text size/gaps rather than adding a scrollbar
                or wrapping to a second row. */}
            {/* 2026-10-24 ("group headers alot now to view") — 27 flat links
                became 4 dropdown groups plus the few used daily kept as
                direct links. Every route is unchanged; only the header
                changed. A group lights up when any page inside it is open. */}
            <nav className="flex items-center gap-3 text-xs whitespace-nowrap">
              <NavLink to="/" end className={({ isActive }) => navClass(isActive)}>
                Summary
              </NavLink>
              <NavGroup
                label="💼 Portfolio"
                items={[
                  { to: "/portfolio-allocation", label: "💼 Allocation" },
                  { to: "/portfolio-charts", label: "📈 Charts" },
                  { to: "/portfolio-performance", label: "📊 Performance" },
                  { to: "/mtf-calculator", label: "📐 MTF" },
                ]}
              />
              <NavLink to="/watchlist" className={({ isActive }) => navClass(isActive)}>
                ⭐ Watchlist
              </NavLink>
              <NavGroup
                label="🔎 Screens"
                items={[
                  { to: "/viraj-screen", label: "🎯 Viraj" },
                  { to: "/momentum-screeners", label: "📈 Momentum" },
                  { to: "/technical-summary", label: "🏆 Technical" },
                  { to: "/all-technicals", label: "🔬 All Technicals" },
                  { to: "/all-fundamentals", label: "📚 All Fundamentals" },
                  { to: "/fixed-asset-change", label: "🏗️ Fixed Asset Δ" },
                  // External link, not a route (2026-09-06, a market-breadth dashboard maintained on Chartink)
                  { to: "https://chartink.com/dashboard/163999", label: "🌬️ Breadth ↗", external: true },
                ]}
              />
              <NavGroup
                label="🌍 Market"
                items={[
                  { to: "/global-macro", label: "🌍 Macro" },
                  { to: "/market-pulse", label: "📟 Pulse" },
                  { to: "/fii-trend", label: "🌊 FII Trend" },
                  { to: "/strategic-alpha", label: "📡 Strategic" },
                  { to: "/top100-us-stocks", label: "🇺🇸 Top100 US" },
                  { to: "/sector-directory", label: "📚 Directory" },
                ]}
              />
              <NavLink to="/business-radar" className={({ isActive }) => navClass(isActive)}>
                🧭 Business
                <BusinessNavBadge />
              </NavLink>
              <NavGroup
                label="🧰 Research"
                items={[
                  { to: "/companies", label: "Companies" },
                  { to: "/guidance-tracker", label: "📋 Guidance" },
                  { to: "/reverse-dcf", label: "🔄 Rev DCF" },
                  { to: "/reverse-dcf-scan", label: "📋 DCF Scan" },
                  { to: "/turtle-wealth", label: "🐢 Turtle" },
                  { to: "/guide", label: "🧭 Guide" },
                ]}
              />
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
          {/* every page except the landing one is its own chunk (2026-10-04): the first load no longer pays for the charting library, the 20+ other pages... */}
          <Suspense fallback={<div className="text-sm text-slate-400 text-center py-16">Loading…</div>}>
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
            <Route path="/market-pulse" element={<MarketPulse />} />
            <Route path="/fii-trend" element={<FIITrend />} />
            <Route path="/sector-directory" element={<Directory />} />
            <Route path="/portfolio-charts" element={<PortfolioCharts />} />
            <Route path="/portfolio-charts/:symbol" element={<PortfolioCharts />} />
            <Route path="/business-radar" element={<Business />} />
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
          </Suspense>
        </main>
      </div>
    </Ctx.Provider>
  );
}

type NavItem = { to: string; label: string; external?: boolean };

// Dropdown group for the header nav — click to open, closes on outside click
// or when the route changes; highlighted while any page inside it is open.
function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const active = items.some((i) => !i.external && loc.pathname.startsWith(i.to));
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className={navClass(active)} aria-haspopup="menu" aria-expanded={open}>
        {label} <span className="text-[9px]">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 min-w-[180px] bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-30 flex flex-col" role="menu">
          {items.map((it) =>
            it.external ? (
              <a key={it.to} href={it.to} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100">
                {it.label}
              </a>
            ) : (
              <NavLink key={it.to} to={it.to} className={({ isActive }) => `px-3 py-1.5 text-xs hover:bg-slate-100 ${isActive ? "text-indigo-600 font-semibold" : "text-slate-600"}`}>
                {it.label}
              </NavLink>
            )
          )}
        </div>
      )}
    </div>
  );
}

function navClass(active: boolean) {
  return active ? "text-slate-900 font-medium" : "text-slate-500 hover:text-slate-800";
}
