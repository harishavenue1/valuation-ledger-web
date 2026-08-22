import { useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../App";
import { api, ApiError } from "../lib/api";

export default function Companies({ onAdded }: { onAdded: (ticker: string) => void }) {
  const { bundle, setBundle } = useData();
  const [ticker, setTicker] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function addCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setBusy(true);
    setError("");
    try {
      const { stock } = await api.fetchCompany(ticker.trim());
      setBundle((b) => ({ ...b, stocks: { ...b.stocks, [stock.ticker]: stock } }));
      setTicker("");
      onAdded(stock.ticker);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Fetch failed — try again");
    } finally {
      setBusy(false);
    }
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
          placeholder="Ticker or company name (e.g. TITAN, Yash Highvoltage)"
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
      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

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
