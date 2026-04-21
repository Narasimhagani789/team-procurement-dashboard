import type {
  AgingBucket,
  DashboardStage,
  RequisitionSummary,
  DocumentStatus,
  PoStatus,
} from "./fusion-types";

// ---- Date + aging ----

export function daysBetween(fromIso: string, toIso: string | Date): number {
  const a = new Date(fromIso).getTime();
  const b = toIso instanceof Date ? toIso.getTime() : new Date(toIso).getTime();
  return Math.floor((b - a) / 86400000);
}

export function daysAgo(iso: string, now: Date = new Date()): number {
  return daysBetween(iso, now);
}

export function daysUntil(iso: string, now: Date = new Date()): number {
  return daysBetween(now.toISOString(), iso);
}

export function agingDaysFor(r: RequisitionSummary, now: Date = new Date()): number {
  // Aging = time the item has been waiting with its current actor
  return daysAgo(r.currentActor.sinceDate, now);
}

export function bucketFor(days: number): AgingBucket {
  if (days <= 3) return "0-3";
  if (days <= 7) return "4-7";
  if (days <= 14) return "8-14";
  return "15+";
}

export const AGING_BUCKETS: AgingBucket[] = ["0-3", "4-7", "8-14", "15+"];

export const AGING_BUCKET_COLOR: Record<AgingBucket, string> = {
  "0-3": "#cbd5e1",   // slate-300
  "4-7": "#fcd34d",   // amber-300
  "8-14": "#fb923c",  // orange-400
  "15+": "#ef4444",   // red-500
};

// ---- Stage derivation ----

// Single source of truth for collapsing Fusion's multi-field status into one
// coarse bucket that drives KPIs, filter tabs, and the aging chart.
export function stageOf(r: RequisitionSummary): DashboardStage {
  const ds: DocumentStatus = r.documentStatus;

  if (ds === "Rejected" || ds === "Returned") return "NeedsFix";
  if (ds === "Pending Approval" || ds === "Incomplete") return "Pending";

  if (ds === "Approved") {
    if (!r.po) return "Buyer";

    const poStatus: PoStatus = r.po.status;
    if (poStatus === "Finally Closed" || poStatus === "Closed for Invoicing") {
      return "Complete";
    }
    if (r.receipt) {
      const { orderedQty, receivedQty } = r.receipt;
      if (orderedQty > 0 && receivedQty >= orderedQty) return "Complete";
    }
    return "Receiving";
  }

  // Withdrawn / Canceled fall through to Complete visually (they're done)
  return "Complete";
}

// ---- Display helpers ----

export function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("en")}`;
  }
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const seconds = Math.floor((now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function receiptProgress(r: RequisitionSummary): number {
  if (!r.receipt || r.receipt.orderedQty === 0) return 0;
  return Math.min(
    100,
    Math.round((r.receipt.receivedQty / r.receipt.orderedQty) * 100),
  );
}

// ---- CSV export ----

export function toCsv(rows: RequisitionSummary[]): string {
  const headers = [
    "Requisition",
    "Description",
    "Requester",
    "Business Unit",
    "Stage",
    "Doc Status",
    "Current Actor",
    "Waiting (days)",
    "Amount",
    "Currency",
    "Amount (Ledger)",
    "Ledger Currency",
    "Need By",
    "Created",
    "PO Number",
    "Supplier",
    "Received %",
  ];

  const lines = rows.map((r) => {
    const cells = [
      r.requisition,
      r.description,
      r.requester.name,
      r.businessUnit,
      stageOf(r),
      r.documentStatus,
      r.currentActor.name,
      String(agingDaysFor(r)),
      String(r.amount.value),
      r.amount.currency,
      String(r.amountInLedgerCurrency.value),
      r.amountInLedgerCurrency.currency,
      r.needByDate,
      r.creationDate,
      r.po?.purchaseOrder ?? "",
      r.po?.supplier.name ?? "",
      String(receiptProgress(r)),
    ];
    return cells.map(csvCell).join(",");
  });

  return [headers.join(","), ...lines].join("\n");
}

function csvCell(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Stage presentation metadata ----

export const STAGE_META: Record<
  DashboardStage,
  { label: string; color: string; badge: string }
> = {
  Pending: {
    label: "Pending Approval",
    color: "#f59e0b",
    badge: "bg-amber-100 text-amber-800 ring-amber-200",
  },
  NeedsFix: {
    label: "Needs Fix",
    color: "#ef4444",
    badge: "bg-rose-100 text-rose-800 ring-rose-200",
  },
  Buyer: {
    label: "With Buyer",
    color: "#3b82f6",
    badge: "bg-blue-100 text-blue-800 ring-blue-200",
  },
  Receiving: {
    label: "In Receiving",
    color: "#8b5cf6",
    badge: "bg-violet-100 text-violet-800 ring-violet-200",
  },
  Complete: {
    label: "Complete",
    color: "#10b981",
    badge: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  },
};

export const STAGE_ORDER: DashboardStage[] = [
  "Pending",
  "NeedsFix",
  "Buyer",
  "Receiving",
  "Complete",
];
