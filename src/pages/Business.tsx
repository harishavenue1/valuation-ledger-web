import { Suspense, lazy } from "react";
import { useSearchParams } from "react-router-dom";

const BusinessRadar = lazy(() => import("./BusinessRadar"));
const SectorTailwinds = lazy(() => import("./SectorTailwinds"));
const CompanyProfile = lazy(() => import("./CompanyProfile"));
const Tweets = lazy(() => import("./Tweets"));

const TABS = [
  { key: "radar", label: "Radar", hint: "Company-by-company catalysts" },
  { key: "sectors", label: "Sector tailwinds", hint: "Which sectors are collecting orders and capex" },
  { key: "company", label: "Company", hint: "One company's business, growth record and catalysts" },
  { key: "tweets", label: "Tweets", hint: "The accounts you follow, in one feed" },
];

export default function Business() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "radar";
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h1 className="text-xl font-semibold">🧭 Business</h1>
        <span className="text-slate-500 text-sm">What companies and sectors are doing — the qualitative side</span>
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            title={t.hint}
            onClick={() => (t.key === "radar" ? setParams({}) : setParams({ tab: t.key }))}
            className={`text-sm px-3 py-1.5 rounded-full border whitespace-nowrap ${
              tab === t.key ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600 hover:border-slate-400"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Suspense fallback={<div className="text-sm text-slate-500">Loading…</div>}>
        {tab === "sectors" ? <SectorTailwinds /> : tab === "company" ? <CompanyProfile /> : tab === "tweets" ? <Tweets /> : <BusinessRadar />}
      </Suspense>
    </div>
  );
}
