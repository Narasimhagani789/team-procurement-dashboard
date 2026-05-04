/**
 * Mappers: Fusion REST → frontend dashboard types.
 *
 * Updated to match the eewo-dev5.fa.us6.oraclecloud.com response shape.
 * Header-level fields only — lines come via expand=lines.
 */

import type {
  DocumentStatus,
  FundsStatus,
  Money,
  Person,
  PoStatus,
  PoSummary,
  ReceiptSummary,
  RequisitionSummary,
} from "../../src/lib/fusion-types";

// ---- Narrowly-typed views of Fusion responses ----

export interface FusionRequisitionLine {
  LineId?: number;
  LineNumber?: number;
  Item?: string;
  ItemDescription?: string;
  CategoryName?: string;
  Category?: string;
  RequesterId?: number;
  Requester?: string;
  RequestedDeliveryDate?: string;
  Quantity?: number;
  UOM?: string;
  Price?: number;
  Amount?: number;
  Supplier?: string;
  SupplierId?: number;
}

export interface FusionRequisitionRow {
  RequisitionHeaderId: number;
  Requisition: string;
  Description?: string;
  DocumentStatus?: string;
  DocumentStatusCode?: string;
  FundsStatus?: string;
  FundsStatusCode?: string;
  // Preparer/Requester at header level — pod returns "Preparer" not "PreparerName"
  PreparerId?: number;
  Preparer?: string;
  PreparerEmail?: string;
  // BU/ledger
  RequisitioningBUId?: number;
  RequisitioningBU?: string;
  SoldToLegalEntity?: string;
  // Currency lives in FunctionalCurrencyCode on the header
  FunctionalCurrencyCode?: string;
  // Dates
  CreationDate?: string;
  SubmissionDate?: string;
  ApprovedDate?: string;
  // Lines (when expand=lines is used)
  lines?: { items?: FusionRequisitionLine[] };
}

// ---- Status normalization ----

const DOC_STATUS_MAP: Record<string, DocumentStatus> = {
  INCOMPLETE: "Incomplete",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  RETURNED: "Returned",
  WITHDRAWN: "Withdrawn",
  CANCELED: "Canceled",
  CANCELLED: "Canceled",
};

export function normalizeDocStatus(s?: string): DocumentStatus {
  if (!s) return "Incomplete";
  const key = s.toUpperCase().replace(/ /g, "_");
  return DOC_STATUS_MAP[key] ?? "Incomplete";
}

const PO_STATUS_MAP: Record<string, PoStatus> = {
  OPEN: "Open",
  CLOSED_FOR_RECEIVING: "Closed for Receiving",
  CLOSED_FOR_INVOICING: "Closed for Invoicing",
  FINALLY_CLOSED: "Finally Closed",
  CANCELED: "Canceled",
  CANCELLED: "Canceled",
  FROZEN: "Frozen",
  ON_HOLD: "On Hold",
};

export function normalizePoStatus(s?: string): PoStatus {
  if (!s) return "Open";
  const key = s.toUpperCase().replace(/ /g, "_");
  return PO_STATUS_MAP[key] ?? "Open";
}

function normalizeFundsStatus(s?: string): FundsStatus {
  if (!s) return null;
  const key = s.toUpperCase();
  if (key === "RESERVED") return "Reserved";
  if (key === "LIQUIDATED") return "Liquidated";
  if (key === "FAILED") return "Failed";
  return null;
}

// ---- Builders ----

function money(value: number, currency: string): Money {
  return { value, currency };
}

function person(id: number | undefined, name: string | undefined): Person {
  return { personId: id ?? 0, name: name ?? "Unknown" };
}

export function toRequisitionSummary(
  row: FusionRequisitionRow,
): RequisitionSummary {
  const docStatus = normalizeDocStatus(row.DocumentStatusCode ?? row.DocumentStatus);
  const lines = row.lines?.items ?? [];

  // Sum amount from lines (header doesn't have it on this pod).
  const totalAmount = lines.reduce(
    (sum, l) => sum + (l.Amount ?? (l.Quantity ?? 0) * (l.Price ?? 0)),
    0,
  );

  // Earliest need-by across lines (most urgent).
  const needBy =
    lines
      .map((l) => l.RequestedDeliveryDate)
      .filter(Boolean)
      .sort()[0] ?? row.CreationDate ?? new Date().toISOString();

  // Top category = first line's category (good enough for dashboard).
  const topCategory =
    lines[0]?.CategoryName ?? lines[0]?.Category ?? "Uncategorized";

  // Requester = first line's requester, fall back to preparer.
  const requesterId = lines[0]?.RequesterId ?? row.PreparerId;
  const requesterName = lines[0]?.Requester ?? row.Preparer;

  const currency = row.FunctionalCurrencyCode ?? "USD";

  return {
    requisitionHeaderId: row.RequisitionHeaderId,
    requisition: row.Requisition,
    description: row.Description ?? "",
    businessUnit: row.RequisitioningBU ?? "Unknown BU",
    requisitioningBU: row.RequisitioningBU ?? "Unknown BU",
    ledger: row.SoldToLegalEntity ?? "—",
    preparer: person(row.PreparerId, row.Preparer),
    requester: person(requesterId, requesterName),
    managerId: 0, // would need HCM lookup; not available on req header
    documentStatus: docStatus,
    fundsStatus: normalizeFundsStatus(row.FundsStatusCode ?? row.FundsStatus),
    onHold: false, // not on header in this pod
    currentActor: deriveCurrentActor(row, docStatus),
    amount: money(totalAmount, currency),
    amountInLedgerCurrency: money(totalAmount, currency),
    creationDate: row.CreationDate ?? new Date().toISOString(),
    submittedDate: row.SubmissionDate ?? null,
    approvedDate: row.ApprovedDate ?? null,
    needByDate: needBy,
    lineCount: lines.length || 1,
    topCategory,
    po: null, // separate fetch when we wire it
    receipt: null, // separate fetch when we wire it
  };
}

function deriveCurrentActor(
  row: FusionRequisitionRow,
  docStatus: DocumentStatus,
): RequisitionSummary["currentActor"] {
  if (docStatus === "Pending Approval") {
    return {
      type: "Approver",
      name: "Pending Approver",
      sinceDate: row.SubmissionDate ?? row.CreationDate ?? "",
    };
  }
  if (docStatus === "Rejected" || docStatus === "Returned") {
    return {
      type: "Requester",
      name: row.Preparer ?? "Requester",
      roleLabel: "Preparer",
      sinceDate: row.SubmissionDate ?? row.CreationDate ?? "",
    };
  }
  if (docStatus === "Approved") {
    return {
      type: "Buyer",
      name: "Unassigned Buyer",
      roleLabel: "Category Buyer",
      sinceDate: row.ApprovedDate ?? "",
    };
  }
  return {
    type: "Approver",
    name: "—",
    sinceDate: row.CreationDate ?? "",
  };
}

// ---- PO + Receipt mappers (kept for when we wire them) ----

export interface FusionPoRow {
  POHeaderId: number;
  OrderNumber: string;
  Revision?: number;
  HasPendingChangeOrder?: boolean;
  CreationDate?: string;
  StatusCode?: string;
  Status?: string;
  Supplier?: string;
  SupplierId?: number;
  SupplierSite?: string;
}

export interface FusionReceiptSummaryRow {
  OrderedQuantity?: number;
  ReceivedQuantity?: number;
  AcceptedQuantity?: number;
  ReturnedQuantity?: number;
  UOMCode?: string;
  LastReceiptNumber?: string;
  LastReceiptDate?: string;
  HasHold?: boolean;
}

export function toPoSummary(row: FusionPoRow): PoSummary {
  return {
    purchaseOrder: row.OrderNumber,
    poHeaderId: row.POHeaderId,
    revision: row.Revision ?? 0,
    hasPendingChange: !!row.HasPendingChangeOrder,
    creationDate: row.CreationDate ?? "",
    status: normalizePoStatus(row.StatusCode ?? row.Status),
    supplier: {
      id: row.SupplierId ?? 0,
      name: row.Supplier ?? "Unknown Supplier",
      site: row.SupplierSite ?? "",
    },
  };
}

export function toReceiptSummary(row: FusionReceiptSummaryRow): ReceiptSummary {
  return {
    orderedQty: row.OrderedQuantity ?? 0,
    receivedQty: row.ReceivedQuantity ?? 0,
    acceptedQty: row.AcceptedQuantity ?? 0,
    returnedQty: row.ReturnedQuantity ?? 0,
    uom: row.UOMCode ?? "Ea",
    lastReceiptNumber: row.LastReceiptNumber,
    lastReceiptDate: row.LastReceiptDate,
    hasHold: !!row.HasHold,
  };
}
