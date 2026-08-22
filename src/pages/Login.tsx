import { useState } from "react";
import { api, ApiError } from "../lib/api";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.login(password);
      onSuccess();
    } catch (e) {
      setError(e instanceof ApiError ? "Wrong password" : "Login failed — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4 px-6 py-8 bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🧮</div>
          <h1 className="text-lg font-semibold text-slate-900">Valuation Ledger</h1>
        </div>
        <input
          type="password"
          autoFocus
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded px-3 py-2 text-sm font-medium disabled:opacity-40"
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
