import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../App";
import type { GuidanceTag, GuidanceTracker as GuidanceTrackerData } from "../lib/api";
import { api } from "../lib/api";
import { bulkAddCompanies } from "../lib/bulkAdd";

const GUIDANCE_TAGS: GuidanceTag[] = ["", "Beat", "Neutral", "Miss"];
const TAG_CLASS: Record<GuidanceTag, string> = {
  "": "",
  Beat: "bg-emerald-950 text-emerald-400 border-emerald-800",
  Neutral: "bg-neutral-800 text-neutral-300 border-neutral-700",
  Miss: "bg-red-950 text-red-400 border-red-800",
};

export default function GuidanceTracker() {
  const { bundle, setBundle } = useData();
  const tracker = bundle.guidance_tracker;
  const [ticker, setTicker] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  const saveTimer = useRef<any>(null);
  function commit(next: GuidanceTrackerData, immediate = false) {
    setBundle((b) => ({ ...b, guidance_tracker: next }));
    clearTimeout(saveTimer.current);
    if (immediate) {
      api.saveGuidanceTracker(next).catch(() => {});
    } else {
      saveTimer.current = setTimeout(() => api.saveGuidanceTracker(next).catch(() => {}), 500);
    }
  }

  async function addCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setBusy(true);
    setStatus(null);
    let nextTracked = tracker.tracked;
    const { successes, failures } = await bulkAddCompanies(ticker, (stock) => {
      setBundle((b) => ({ ...b, stocks: { ...b.stocks, [stock.ticker]: stock } }));
      if (!nextTracked.includes(stock.ticker)) nextTracked = [...nextTracked, stock.ticker];
    });
    setBusy(false);
    if (nextTracked !== tracker.tracked) commit({ ...tracker, tracked: nextTracked }, true);
    if (successes.length === 0) {
      setStatus({ kind: "error", text: `Couldn't fetch: ${failures.map((f) => `${f.ticker}: ${f.error}`).join("; ")}` });
      return;
    }
    setTicker("");
    let text = `Added: ${successes.map((s) => `${s.name} (${s.ticker})`).join(", ")}.`;
    if (failures.length > 0) text += ` Couldn't fetch: ${failures.map((f) => `${f.ticker}: ${f.error}`).join("; ")}`;
    setStatus({ kind: failures.length > 0 ? "error" : "info", text });
  }

  function removeCompany(t: string) {
    commit({ ...tracker, tracked: tracker.tracked.filter((x) => x !== t) }, true);
  }

  function addQuarter() {
    let n = tracker.quarters.length + 1;
    let label = `Quarter ${n}`;
    while (tracker.quarters.includes(label)) {
      n += 1;
      label = `Quarter ${n}`;
    }
    commit({ ...tracker, quarters: [...tracker.quarters, label] }, true);
  }

  function removeQuarter(q: string) {
    const cells = { ...tracker.cells };
    for (const t of Object.keys(cells)) {
      if (cells[t][q]) {
        const { [q]: _drop, ...rest } = cells[t];
        cells[t] = rest;
      }
    }
    commit({ ...tracker, quarters: tracker.quarters.filter((x) => x !== q), cells }, true);
  }

  function renameQuarter(oldLabel: string, newLabel: string) {
    newLabel = newLabel.trim();
    if (!newLabel || newLabel === oldLabel || tracker.quarters.includes(newLabel)) return;
    const cells = { ...tracker.cells };
    for (const t of Object.keys(cells)) {
      if (cells[t][oldLabel]) {
        const { [oldLabel]: cell, ...rest } = cells[t];
        cells[t] = { ...rest, [newLabel]: cell };
      }
    }
    commit({ ...tracker, quarters: tracker.quarters.map((x) => (x === oldLabel ? newLabel : x)), cells }, true);
  }

  function setCell(t: string, q: string, patch: Partial<{ note: string; tag: GuidanceTag }>, immediate = false) {
    const existing = tracker.cells[t]?.[q] ?? { note: "", tag: "" as GuidanceTag };
    const cells = { ...tracker.cells, [t]: { ...tracker.cells[t], [q]: { ...existing, ...patch } } };
    commit({ ...tracker, cells }, immediate);
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">📋 Management Guidance Tracker</h1>
      </div>
      <p className="text-sm text-neutral-500 mb-4">Company (left) × Quarter (grows rightward — + at the end adds another).</p>

      <form onSubmit={addCompany} className="flex gap-2 mb-2 max-w-xl">
        <input
          placeholder="e.g. TITAN, or MTAR, WINDLAS, MCX for several at once"
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-neutral-500"
        />
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 rounded bg-neutral-100 text-neutral-900 text-sm font-medium disabled:opacity-50 whitespace-nowrap"
        >
          {busy ? "Fetching…" : "Add"}
        </button>
      </form>
      {status && (
        <p className={`text-sm mb-4 ${status.kind === "error" ? "text-red-400" : "text-emerald-400"}`}>{status.text}</p>
      )}

      {tracker.tracked.length === 0 ? (
        <div className="text-neutral-500 text-sm py-8 text-center border border-neutral-800 rounded">
          No companies tracked here yet — add one above.
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="text-sm border-collapse">
            <thead>
              <tr className="bg-neutral-900 text-neutral-400 text-xs">
                <th className="text-left px-3 py-2 align-top sticky left-0 bg-neutral-900 w-56 min-w-56">Company</th>
                {tracker.quarters.map((q) => (
                  <th key={q} className="px-2 py-2 align-top w-48 min-w-48">
                    <input
                      defaultValue={q}
                      onBlur={(e) => renameQuarter(q, e.target.value)}
                      className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs font-medium text-center"
                    />
                    <button
                      onClick={() => removeQuarter(q)}
                      className="block mx-auto mt-1 text-[10px] text-neutral-500 hover:text-red-400"
                      title={`Remove the "${q}" column (all companies)`}
                    >
                      ✕ remove
                    </button>
                  </th>
                ))}
                <th className="px-2 py-2 align-top w-12">
                  <button
                    onClick={addQuarter}
                    className="w-8 h-8 rounded border border-neutral-700 hover:border-neutral-500 text-lg leading-none"
                    title="Add a new quarter column"
                  >
                    +
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {tracker.tracked.map((t) => {
                const stock = bundle.stocks[t];
                return (
                  <tr key={t} className="border-t border-neutral-800 align-top">
                    <td className="px-3 py-2 sticky left-0 bg-neutral-950">
                      <Link to={`/company/${t}`} className="font-medium hover:underline block">
                        {stock ? stock.name : t}
                      </Link>
                      <span className="text-neutral-500 text-xs">{t}</span>
                      <button
                        onClick={() => removeCompany(t)}
                        className="block mt-1 text-[11px] text-neutral-500 hover:text-red-400"
                        title={`Remove ${t} from this tracker only (doesn't touch the main company list)`}
                      >
                        🗑️ remove
                      </button>
                    </td>
                    {tracker.quarters.map((q) => {
                      const cell = tracker.cells[t]?.[q] ?? { note: "", tag: "" as GuidanceTag };
                      return (
                        <td key={q} className="px-2 py-2">
                          <select
                            value={cell.tag}
                            onChange={(e) => setCell(t, q, { tag: e.target.value as GuidanceTag }, true)}
                            className={`w-full mb-1 rounded border px-2 py-1 text-xs ${TAG_CLASS[cell.tag] || "bg-neutral-900 border-neutral-800"}`}
                          >
                            {GUIDANCE_TAGS.map((tag) => (
                              <option key={tag} value={tag}>
                                {tag || "—"}
                              </option>
                            ))}
                          </select>
                          <textarea
                            defaultValue={cell.note}
                            onChange={(e) => setCell(t, q, { note: e.target.value })}
                            placeholder="Guidance / commentary…"
                            rows={5}
                            className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs focus:outline-none focus:border-neutral-500"
                          />
                        </td>
                      );
                    })}
                    <td />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
