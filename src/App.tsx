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
import Settings from "./pages/Settings";

interface DataCtx {
  bundle: Bundle;
  setBundle: React.Dispatch<React.SetStateAction<Bundle>>;
  reload: () => Promise<void>;
}
const Ctx = createContext<DataCtx | null>(null);
export function useData() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData outside provider");
  return ctx;
}

const EMPTY: Bundle = {
  stocks: {},
  scenarios: {},
  guidance: {},
  guidance_tracker: { quarters: [], tracked: [], cells: {} },
  viraj_screen: { as_of: null, rows: [] },
  momentum_screeners: {},
  run_requests: {},
  last_refresh: {},
};

export default function App() {
  const [status, setStatus] = useState<"loading" | "authed" | "anon">("loading");
  const [bundle, setBundle] = useState<Bundle>(EMPTY);
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
    <Ctx.Provider value={{ bundle, setBundle, reload }}>
      <div className="min-h-screen flex flex-col">
        <header className="border-b border-slate-200 sticky top-0 bg-white/90 backdrop-blur z-20">
          <div className="max-w-[1800px] mx-auto px-4 py-3 flex items-center gap-6">
            <span className="font-semibold tracking-tight text-lg text-indigo-600">🧮 Valuation Ledger</span>
            <nav className="flex gap-4 text-sm">
              <NavLink to="/" end className={({ isActive }) => navClass(isActive)}>
                Summary
              </NavLink>
              <NavLink to="/companies" className={({ isActive }) => navClass(isActive)}>
                Companies
              </NavLink>
              <NavLink to="/guidance-tracker" className={({ isActive }) => navClass(isActive)}>
                📋 Guidance Tracker
              </NavLink>
              <NavLink to="/viraj-screen" className={({ isActive }) => navClass(isActive)}>
                🎯 Viraj Screen
              </NavLink>
              <NavLink to="/momentum-screeners" className={({ isActive }) => navClass(isActive)}>
                📈 Momentum Screeners
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
        <main className="flex-1 max-w-[1800px] w-full mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<Summary />} />
            <Route path="/companies" element={<Companies onAdded={(t) => navigate(`/company/${t}`)} />} />
            <Route path="/company/:ticker" element={<Detail />} />
            <Route path="/guidance-tracker" element={<GuidanceTracker />} />
            <Route path="/viraj-screen" element={<VirajScreen />} />
            <Route path="/momentum-screeners" element={<MomentumScreeners />} />
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
