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
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4 px-6">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🧮</div>
          <h1 className="text-lg font-semibold">Valuation Ledger</h1>
        </div>
        <input
          type="password"
          autoFocus
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-neutral-500"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full bg-neutral-100 text-neutral-900 rounded px-3 py-2 text-sm font-medium disabled:opacity-40"
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
