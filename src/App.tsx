import { useEffect, useState, createContext, useContext } from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { api, ApiError, Bundle } from "./lib/api";
import Login from "./pages/Login";
import Summary from "./pages/Summary";
import Companies from "./pages/Companies";
import Detail from "./pages/Detail";
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

const EMPTY: Bundle = { stocks: {}, scenarios: {}, guidance: {}, guidance_tracker: {}, last_refresh: {} };

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
      <div className="min-h-screen flex items-center justify-center text-neutral-500 text-sm">
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
        <header className="border-b border-neutral-800 sticky top-0 bg-neutral-950/90 backdrop-blur z-20">
          <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center gap-6">
            <span className="font-semibold tracking-tight text-lg">🧮 Valuation Ledger</span>
            <nav className="flex gap-4 text-sm">
              <NavLink to="/" end className={({ isActive }) => navClass(isActive)}>
                Summary
              </NavLink>
              <NavLink to="/companies" className={({ isActive }) => navClass(isActive)}>
                Companies
              </NavLink>
              <NavLink to="/settings" className={({ isActive }) => navClass(isActive)}>
                Settings
              </NavLink>
            </nav>
            <button
              className="ml-auto text-xs text-neutral-500 hover:text-neutral-300"
              onClick={async () => {
                await api.logout();
                setStatus("anon");
              }}
            >
              Log out
            </button>
          </div>
        </header>
        <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<Summary />} />
            <Route path="/companies" element={<Companies onAdded={(t) => navigate(`/company/${t}`)} />} />
            <Route path="/company/:ticker" element={<Detail />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </Ctx.Provider>
  );
}

function navClass(active: boolean) {
  return active ? "text-neutral-100 font-medium" : "text-neutral-500 hover:text-neutral-300";
}
