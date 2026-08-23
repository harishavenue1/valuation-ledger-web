import { useEffect, useRef, useState } from "react";
import { useData } from "../App";
import { api } from "../lib/api";

// "Run now" for a screener that can't execute inside Vercel (see
// api/run_requests.py) — queues a request that a local poller on the
// user's own Mac picks up and actually runs. While a request is
// pending/running, auto-polls reload() every 20s so the status pill
// updates without the user manually hitting Refresh, and stops once
// it lands on done/error (or after ~15 minutes, in case the local
// poller isn't running at all — no point polling forever).
const POLL_MS = 20_000;
const MAX_POLL_MS = 15 * 60_000;

export default function RunButton({ screener }: { screener: string }) {
  const { bundle, reload } = useData();
  const [requesting, setRequesting] = useState(false);
  const entry = bundle.run_requests[screener];
  const pollingSince = useRef<number | null>(null);

  const active = entry && (entry.status === "pending" || entry.status === "running");

  useEffect(() => {
    if (!active) {
      pollingSince.current = null;
      return;
    }
    if (pollingSince.current === null) pollingSince.current = Date.now();
    const id = setInterval(() => {
      if (pollingSince.current && Date.now() - pollingSince.current > MAX_POLL_MS) {
        clearInterval(id);
        return;
      }
      reload().catch(() => {});
    }, POLL_MS);
    return () => clearInterval(id);
  }, [active, reload]);

  async function onClick() {
    setRequesting(true);
    try {
      await api.requestRun(screener);
      await reload();
    } finally {
      setRequesting(false);
    }
  }

  const label =
    requesting || entry?.status === "pending"
      ? "⏳ Queued…"
      : entry?.status === "running"
        ? "⚙️ Running…"
        : entry?.status === "error"
          ? "❌ Failed — retry"
          : "▶️ Run now";

  const title =
    entry?.status === "pending"
      ? `Queued ${new Date(entry.requested_at).toLocaleString()} — waiting for the local poller on your Mac to pick it up`
      : entry?.status === "running"
        ? "The script is running locally right now"
        : entry?.status === "error"
          ? entry.error || "Last run failed"
          : entry?.status === "done"
            ? `Last completed ${new Date(entry.updated_at).toLocaleString()}`
            : "Queues a run request — a local poller on your Mac (not this webpage) actually executes it";

  return (
    <button
      onClick={onClick}
      disabled={requesting || active}
      title={title}
      className={`text-xs px-2.5 py-1 rounded border font-medium disabled:opacity-70 ${
        entry?.status === "error" ? "border-red-300 text-red-600 hover:border-red-400" : "border-slate-300 text-slate-600 hover:border-indigo-400 hover:text-indigo-600"
      }`}
    >
      {label}
    </button>
  );
}
