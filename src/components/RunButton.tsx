import { useEffect, useRef, useState } from "react";
import { useData } from "../App";
import { api, ApiError } from "../lib/api";

// 2026-08-30, "refresh on click from any machine, not just the Mac" —
// these 4 now run natively on Vercel (see api/momentum_screeners.py's
// do_GET, proven live at full 750-ticker scale the same day), so their
// "Run now" can call that endpoint directly with the browser's own
// session cookie instead of going through the local-poller queue
// below. viraj_screen is deliberately NOT in this set — it needs
// Harish's own Screener.in/Chartink session cookies, which only live
// on his Mac, so it still queues for the local poller.
const CLOUD_SCREENERS = new Set(["myLongTermInvestingStrategy", "weekendInvesting", "quantBollinger", "Nifty500RelativeStrength"]);

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
  if (CLOUD_SCREENERS.has(screener)) return <CloudRunButton screener={screener} />;
  return <LocalRunButton screener={screener} />;
}

// Runs synchronously on Vercel, awaited directly — no queue, no
// polling, works from any machine/browser the user is logged into.
// Takes ~60-100s (a full 750-ticker yfinance pull), so the button
// stays disabled and shows progress for that whole span rather than
// pretending it's instant.
function CloudRunButton({ screener }: { screener: string }) {
  const { reload } = useData();
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [detail, setDetail] = useState<string | null>(null);

  async function onClick() {
    setState("running");
    setDetail(null);
    try {
      const result = await api.runScreenerCloud(screener);
      setDetail(`${result.pushed} pushed of ${result.scanned} scanned (${result.elapsed_s}s)`);
      setState("done");
      await reload();
    } catch (e) {
      setDetail(e instanceof ApiError ? e.message : "request failed");
      setState("error");
    }
  }

  const label =
    state === "running" ? "⚙️ Running… (~1-2 min)" : state === "error" ? "❌ Failed — retry" : state === "done" ? "✅ Done — run again" : "▶️ Run now";

  const title =
    state === "running"
      ? "Running live on Vercel right now — this tab needs to stay open until it finishes"
      : state === "error"
        ? detail || "Last run failed"
        : state === "done"
          ? detail || "Completed"
          : "Runs this screener live on Vercel now — works from any machine, no local poller needed";

  return (
    <button
      onClick={onClick}
      disabled={state === "running"}
      title={title}
      className={`text-xs px-2.5 py-1 rounded border font-medium disabled:opacity-70 ${
        state === "error" ? "border-red-300 text-red-600 hover:border-red-400" : "border-slate-300 text-slate-600 hover:border-indigo-400 hover:text-indigo-600"
      }`}
    >
      {label}
    </button>
  );
}

function LocalRunButton({ screener }: { screener: string }) {
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
