import { useEffect, useRef, useState } from "react";
import { useData } from "../App";
import { api, ApiError } from "../lib/api";

// 2026-08-30, "refresh on click from any machine, not just the Mac" —
// every screener on the Momentum Screeners + Viraj Screen pages now
// runs natively on Vercel (see api/momentum_screeners.py's and
// api/viraj_screen.py's do_GET, all proven live), so "Run now" can
// call the endpoint directly with the browser's own session cookie
// instead of going through the local-poller queue below. viraj_screen
// was initially assumed to need Harish's own Screener.in/Chartink
// login cookies (same as the local script it's ported from insists
// on) — checked live and neither Screener.in's Quarterly Results
// table nor Chartink's ad-hoc scan_clause endpoint actually requires
// one; the cookie only gates saved/premium Chartink screens, not this.
// So it joined this set with zero stored credentials, no security
// trade-off to weigh. nseScreener/sectorAlpha/sectorStockAlpha were
// ported the same cloud-native way as the other 4 momentum screeners
// but initially missed being added here — the button quietly fell
// back to the local-poller path for those 3 even though their backend
// never needed it (caught 2026-08-30 while confirming "is everything
// actually reachable from any machine").
const CLOUD_SCREENERS = new Set([
  "myLongTermInvestingStrategy",
  "weekendInvesting",
  "quantBollinger",
  "Nifty500RelativeStrength",
  "nseScreener",
  "sectorAlpha",
  "sectorStockAlpha",
  "maBreakout",
  "valueRsiTurnaround",
  "grandfatherFatherSon",
  "viraj_screen",
  "52wHigh",
  "allTimeHigh",
  "momentumPersonal",
  // smeMomentum deliberately NOT here — confirmed live 2026-09-05 that
  // nseindia.com's Emerge feed (the only source for this data) times
  // out from Vercel's datacenter IP, so it can't run there at all. It
  // runs locally instead (~/.claude/skills/SmeMomentum), pushed the
  // same way every screener's script worked pre-Vercel-migration. See
  // LocalOnlyNote below — it gets its own component rather than falling
  // through to LocalRunButton, whose "queues a request... picked up by
  // a local poller" framing would be actively misleading here: no
  // poller exists (that path is dead code for every OTHER screener
  // too, per LocalRunButton's own comment), so a "Run now" click would
  // just sit queued forever with no explanation.
]);

// "Run now" for a screener that can't (or doesn't yet) execute inside
// Vercel (see api/run_requests.py) — queues a request that a local
// poller on the user's own Mac picks up and actually runs. Currently
// unreachable in practice (every screener CLOUD_SCREENERS doesn't
// cover), kept as the fallback path for any future local-only
// screener. While a request is pending/running, auto-polls reload()
// every 20s so the status pill updates without the user manually
// hitting Refresh, and stops once it lands on done/error (or after
// ~15 minutes, in case the local poller isn't running at all — no
// point polling forever).
const POLL_MS = 20_000;
const MAX_POLL_MS = 15 * 60_000;

export default function RunButton({ screener }: { screener: string }) {
  if (CLOUD_SCREENERS.has(screener)) return <CloudRunButton screener={screener} />;
  if (screener === "smeMomentum") return <LocalOnlyNote />;
  return <LocalRunButton screener={screener} />;
}

// smeMomentum has no Vercel path and no local poller watching
// run_requests (see the CLOUD_SCREENERS comment above) — a "Run now"
// button here would just queue a request nothing ever picks up. Says
// so plainly instead of pretending a click does something.
function LocalOnlyNote() {
  return (
    <span className="text-xs text-slate-400" title="nseindia.com's SME data feed times out from Vercel — refresh by asking Claude to run the SmeMomentum skill, or running its script directly on your Mac">
      Refreshed manually via the SmeMomentum skill, not on a schedule
    </span>
  );
}

// Runs synchronously on Vercel, awaited directly — no queue, no
// polling, works from any machine/browser the user is logged into.
// Takes ~60-100s (a full 750-ticker yfinance pull), so the button
// stays disabled and shows progress for that whole span rather than
// pretending it's instant.
//
// Status lives in the shared DataCtx (cloudRuns), keyed by screener —
// not local useState. This button remounts on every Momentum
// Screeners tab switch (see MomentumScreeners.tsx's key={tab}, added
// to stop one screener's status leaking onto another's tab); the
// underlying fetch to Vercel isn't tied to this component's lifetime
// and keeps running after unmount, so tracking status here alone made
// switching tabs mid-run look like the run itself had stopped. Lifting
// it to the provider fixes both: correct per-screener status AND it
// survives the remount.
function CloudRunButton({ screener }: { screener: string }) {
  const { reload, cloudRuns, setCloudRun } = useData();
  const { state = "idle", detail = null } = cloudRuns[screener] ?? {};

  async function onClick() {
    setCloudRun(screener, { state: "running", detail: null });
    try {
      const result = await api.runScreenerCloud(screener);
      setCloudRun(screener, { state: "done", detail: `${result.pushed} pushed of ${result.scanned} scanned (${result.elapsed_s}s)` });
      await reload();
    } catch (e) {
      setCloudRun(screener, { state: "error", detail: e instanceof ApiError ? e.message : "request failed" });
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
