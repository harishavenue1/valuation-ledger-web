import { useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../App";
import { api } from "../lib/api";
import { bulkAddCompanies } from "../lib/bulkAdd";

export default function Companies({ onAdded }: { onAdded: (ticker: string) => void }) {
  const { bundle, setBundle } = useData();
  const [ticker, setTicker] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  async function addCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setBusy(true);
    setStatus(null);
    const { successes, failures } = await bulkAddCompanies(ticker, (stock) => {
      setBundle((b) => ({ ...b, stocks: { ...b.stocks, [stock.ticker]: stock } }));
    });
    setBusy(false);
    if (successes.length === 0) {
      setStatus({ kind: "error", text: `Couldn't fetch: ${failures.map((f) => `${f.ticker}: ${f.error}`).join("; ")}` });
      return;
    }
    setTicker("");
    // Only jump straight to the Detail page for the single-ticker,
    // no-failures case — jumping anywhere specific doesn't make sense
    // once multiple companies just got added at once.
    if (successes.length === 1 && failures.length === 0) {
      onAdded(successes[0].ticker);
      return;
    }
    let text = `Added: ${successes.map((s) => `${s.name} (${s.ticker})`).join(", ")}.`;
    if (failures.length > 0) text += ` Couldn't fetch: ${failures.map((f) => `${f.ticker}: ${f.error}`).join("; ")}`;
    setStatus({ kind: failures.length > 0 ? "error" : "info", text });
  }

  async function remove(t: string) {
    if (!confirm(`Remove ${t} from the ledger? This deletes its saved scenarios too.`)) return;
    await api.deleteCompany(t);
    setBundle((b) => {
      const stocks = { ...b.stocks };
      const scenarios = { ...b.scenarios };
      delete stocks[t];
      delete scenarios[t];
      return { ...b, stocks, scenarios };
    });
  }

  const tickers = Object.keys(bundle.stocks).sort((a, b) => bundle.stocks[a].name.localeCompare(bundle.stocks[b].name));

  return (
    <div className="max-w-2xl">
      <form onSubmit={addCompany} className="flex gap-2 mb-6">
        <input
          placeholder="e.g. TITAN, or MTAR, WINDLAS, MCX for several at once"
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-neutral-500"
        />
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 rounded bg-neutral-100 text-neutral-900 text-sm font-medium disabled:opacity-50"
        >
          {busy ? "Fetching…" : "Fetch & Add"}
        </button>
      </form>
      {status && (
        <p className={`text-sm mb-4 ${status.kind === "error" ? "text-red-400" : "text-emerald-400"}`}>{status.text}</p>
      )}

      <h2 className="text-sm text-neutral-400 mb-2">In the ledger ({tickers.length})</h2>
      <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded">
        {tickers.map((t) => (
          <li key={t} className="flex items-center gap-3 px-3 py-2 text-sm">
            <Link to={`/company/${t}`} className="hover:underline flex-1">
              <span className="font-medium">{bundle.stocks[t].name}</span>{" "}
              <span className="text-neutral-500 text-xs">{t}</span>
            </Link>
            <button onClick={() => remove(t)} className="text-xs text-neutral-500 hover:text-red-400">
              Remove
            </button>
          </li>
        ))}
        {tickers.length === 0 && <li className="px-3 py-8 text-center text-neutral-500">No companies yet.</li>}
      </ul>
    </div>
  );
}
