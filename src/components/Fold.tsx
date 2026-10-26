import { useState } from "react";

// A section with a header that folds it away (2026-10-26, "add hide option to all sections"). The choice is remembered per
// browser under `id`; localStorage can be missing or throw (private windows), so the section just opens by default then.
const read = (id: string, dflt: boolean) => {
  try {
    const v = localStorage.getItem("fold:" + id);
    return v === null ? dflt : v === "1";
  } catch {
    return dflt;
  }
};

export function Fold({ id, title, note, right, defaultOpen = true, className = "mb-4", children }: { id: string; title: React.ReactNode; note?: string; right?: React.ReactNode; defaultOpen?: boolean; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(() => read(id, defaultOpen));
  const flip = () => {
    setOpen(!open);
    try {
      localStorage.setItem("fold:" + id, open ? "0" : "1");
    } catch {
      /* ignore */
    }
  };
  return (
    <section className={className}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
        <button onClick={flip} aria-expanded={open} className="flex items-center gap-1.5 text-left text-sm font-semibold text-slate-700 hover:text-slate-900">
          <span className="text-slate-400 text-xs w-3">{open ? "▾" : "▸"}</span>
          {title}
        </button>
        {note && <span className="text-xs text-slate-500">{note}</span>}
        {open && right}
        <button onClick={flip} className="ml-auto text-xs px-2 py-0.5 rounded border border-slate-300 text-slate-500 hover:bg-slate-100">{open ? "▲ hide" : "▼ show"}</button>
      </div>
      {open && children}
    </section>
  );
}
