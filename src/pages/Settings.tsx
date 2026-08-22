import { useData } from "../App";

export default function Settings() {
  const { bundle } = useData();
  const count = Object.keys(bundle.stocks).length;

  function downloadBackup() {
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `valuation-ledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-sm font-medium text-slate-700 mb-2">Data</h2>
        <p className="text-sm text-slate-500 mb-3">
          {count} companies tracked. All data (stocks, scenarios, guidance) lives in Postgres — no GitHub sync, no export/import
          dance needed to persist edits.
        </p>
        <button onClick={downloadBackup} className="text-xs px-3 py-1.5 rounded border border-slate-300 hover:border-slate-400">
          Download JSON backup
        </button>
      </div>
      <div>
        <h2 className="text-sm font-medium text-slate-700 mb-2">Fetching</h2>
        <p className="text-sm text-slate-500">
          Screener.in fundamentals/price fetch works fully anonymously — no session cookie needed.
        </p>
      </div>
    </div>
  );
}
