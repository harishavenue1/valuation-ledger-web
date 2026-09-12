import { useNavigate } from "react-router-dom";
import { useData } from "../App";
import RunButton from "../components/RunButton";
import { Col, GenericTable, MethodologyNote, PriceLink } from "../components/ScreenerTable";

// Added 2026-09-12 ("may be new page we need to add is bulk and block
// deal and comment on each stock in list with a summary from page,
// like mgmt change, big order or transition") — NSE bulk + block
// deals, each row cross-matched against a BSE corporate announcement
// filed in the days before the deal, to explain WHY: a management
// change, a big order win, or a corporate transition (merger/demerger/
// scheme of arrangement). See
// ~/.claude/skills/BulkBlockDeals/scripts/bulk_block_deals.py for the
// fetch/match logic — this runs locally (like SmeMomentum), not on
// Vercel, since nseindia.com's live API times out from Vercel's
// datacenter IP.
const COLS: Col[] = [
  { key: "date", label: "Date", align: "left" },
  {
    key: "deal_type",
    label: "Type",
    align: "left",
    render: (r) => (
      <span
        className={`text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${
          r.deal_type === "Block" ? "bg-indigo-50 text-indigo-700 border-indigo-300" : "bg-slate-100 text-slate-600 border-slate-300"
        }`}
      >
        {r.deal_type}
      </span>
    ),
  },
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "name", label: "Name", align: "left" },
  {
    key: "side",
    label: "Side",
    align: "left",
    render: (r) => (
      <span
        className={`text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${
          r.side === "BUY" ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-red-50 text-red-600 border-red-300"
        }`}
      >
        {r.side}
      </span>
    ),
  },
  { key: "client_name", label: "Client / Counterparty", align: "left" },
  { key: "quantity", label: "Quantity", render: (r) => (r.quantity != null ? r.quantity.toLocaleString("en-IN") : "—") },
  { key: "price", label: "Price", render: (r) => <PriceLink symbol={r.symbol} value={r.price} /> },
  {
    key: "comment_category",
    label: "Reason",
    align: "left",
    render: (r) =>
      r.comment_category ? (
        <span
          className={`text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${
            r.comment_category === "Order Win"
              ? "bg-emerald-50 text-emerald-700 border-emerald-300"
              : r.comment_category === "Management Change"
                ? "bg-amber-50 text-amber-700 border-amber-300"
                : "bg-purple-50 text-purple-700 border-purple-300"
          }`}
        >
          {r.comment_category}
        </span>
      ) : (
        <span className="text-xs text-slate-400">—</span>
      ),
  },
  {
    key: "comment",
    label: "Comment (from BSE filing)",
    align: "left",
    render: (r) =>
      r.comment ? (
        <span className="text-xs text-slate-700" title={r.comment_date ? `Filed ${r.comment_date}` : undefined}>
          {r.comment}
        </span>
      ) : (
        <span className="text-xs text-slate-400">—</span>
      ),
  },
];

export default function BulkBlockDeals() {
  const { bundle } = useData();
  const navigate = useNavigate();
  const entry = bundle.momentum_screeners["bulkBlockDeals"];

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">📦 Bulk &amp; Block Deals</h1>
        <span className="ml-auto">
          <RunButton screener="bulkBlockDeals" />
        </span>
      </div>
      {entry?.as_of && <div className="text-xs text-slate-400 mb-2">as of {entry.as_of}</div>}
      <p className="text-xs text-slate-500 mb-4">
        Large single-trade transactions on NSE (Bulk: ≥0.5% of a company's equity in one trade; Block: a pre-negotiated large trade in a
        special window), each cross-matched against BSE's corporate announcements for a material reason filed in the days before the deal.
      </p>
      <MethodologyNote>
        <b>Reason</b> / <b>Comment</b> come from scanning BSE's own filed announcements (not NSE's) for the ~10 days before each deal date,
        matched to the deal's stock by company name. Only 3 categories are surfaced — <b>Order Win</b> (a big contract/order), <b>Management
        Change</b> (a director/KMP appointment, resignation, or change-in-management filing), and <b>Transition</b> (a merger, demerger,
        scheme of arrangement, amalgamation, or acquisition) — anything else, or no matching filing at all, shows as "—" rather than a
        guessed reason. The comment text is the real filed headline verbatim, not an AI-written summary — this keeps the whole pipeline
        scriptable and unattended, run on request via the BulkBlockDeals skill (not on a daily schedule — nseindia.com's live API times out
        from Vercel, the same reason SME Momentum runs locally). Company-name matching between NSE's and BSE's own spelling of a company
        name is best-effort (normalized, not exact) — a genuine miss just leaves the row blank rather than showing a wrong match.
      </MethodologyNote>
      <GenericTable
        rows={entry?.rows ?? []}
        cols={COLS}
        navigate={(t) => navigate(`/company/${t}`)}
        emptyMessage="No Bulk & Block Deals data yet — ask Claude to run the BulkBlockDeals skill, or run its script directly."
      />
    </div>
  );
}
