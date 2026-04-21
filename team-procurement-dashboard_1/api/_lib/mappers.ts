/**
 * Mappers: Fusion REST → frontend dashboard types.
 *
 * These are the fragile seams. Every Fusion environment has slightly
 * different field availability (custom DFFs, config-dependent enums). If a
 * field is missing at runtime, log + fall back to sensible defaults — never
 * crash the dashboard.
 *
 * The shapes below are what Fusion typically returns from:
 *   GET /fscmRestApi/resources/11.13.18.05/purchaseRequisitions
 *   GET /fscmRestApi/resources/11.13.18.05/purchaseOrders
 *   GET /fscmRestApi/resources/11.13.18.05/receivingReceiptRequests
 *   GET /hcmRestApi/resources/11.13.18.05/workers
 *
 * Reference a real response from your pod before trusting the field names.
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

export interface FusionRequisitionRow {
  RequisitionHeaderId: number;
  Requisition: string;
  Description?: string;
  DocumentStatus?: string;
  DocumentStatusCode?: string;
  FundsStatus?: string;
  OnHold?: "Y" | "N" | boolean;
  PreparerId?: number;
  PreparerName?: string;
  RequesterId?: number;
  RequesterName?: string;
  RequesterManagerId?: number;
  RequisitioningBUName?: string;
  SoldToLegalEntity?: string;
  LedgerName?: string;
  CurrencyCode?: string;
  LedgerCurrencyCode?: string;
  ApprovedAmount?: number;
  ApprovedAmountInLedgerCurrency?: number;
  CreationDate?: string;
  SubmittedDate?: string;
  ApprovedDate?: string;
  RequestedDeliveryDate?: string;
  LineCount?: number;
  CurrentApproverName?: string;
  CurrentApproverRole?: string;
  CurrentApproverAssignedDate?: string;
  TopCategoryName?: string;
}

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

function truthy(v: unknown): boolean {
  return v === true || v === "Y" || v === "Yes";
}

// ---- Builders ----

function money(value: number | undefined, currency: string | undefined): Money {
  return { value: value ?? 0, currency: currency ?? "USD" };
}

function person(id: number | undefined, name: string | undefined): Person {
  return { personId: id ?? 0, name: name ?? "Unknown" };
}

export function toRequisitionSummary(
  row: FusionRequisitionRow,
  po: PoSummary | null = null,
  receipt: ReceiptSummary | null = null,
): RequisitionSummary {
  const docStatus = normalizeDocStatus(row.DocumentStatusCode ?? row.DocumentStatus);
  const now = new Date().toISOString();

  // currentActor is a derivation — approver if pending, buyer if approved-no-PO,
  // supplier if PO out, receiver if receipts flowing. Refine once you see real
  // data from your pod and know which fields are reliably populated.
  const currentActor = deriveCurrentActor(row, po, receipt);

  return {
    requisitionHeaderId: row.RequisitionHeaderId,
    requisition: row.Requisition,
    description: row.Description ?? "",
    businessUnit: row.RequisitioningBUName ?? "Unknown BU",
    requisitioningBU: row.RequisitioningBUName ?? "Unknown BU",
    ledger: row.LedgerName ?? "Unknown Ledger",
    preparer: person(row.PreparerId, row.PreparerName),
    requester: person(row.RequesterId, row.RequesterName),
    managerId: row.RequesterManagerId ?? 0,
    documentStatus: docStatus,
    fundsStatus: normalizeFundsStatus(row.FundsStatus),
    onHold: truthy(row.OnHold),
    currentActor,
    amount: money(row.ApprovedAmount, row.CurrencyCode),
    amountInLedgerCurrency: money(
      row.ApprovedAmountInLedgerCurrency ?? row.ApprovedAmount,
      row.LedgerCurrencyCode ?? row.CurrencyCode,
    ),
    creationDate: row.CreationDate ?? now,
    submittedDate: row.SubmittedDate ?? null,
    approvedDate: row.ApprovedDate ?? null,
    needByDate: row.RequestedDeliveryDate ?? now,
    lineCount: row.LineCount ?? 1,
    topCategory: row.TopCategoryName ?? "Uncategorized",
    po,
    receipt,
  };
}

function deriveCurrentActor(
  row: FusionRequisitionRow,
  po: PoSummary | null,
  receipt: ReceiptSummary | null,
): RequisitionSummary["currentActor"] {
  const docStatus = normalizeDocStatus(row.DocumentStatusCode ?? row.DocumentStatus);

  if (docStatus === "Pending Approval") {
    return {
      type: "Approver",
      name: row.CurrentApproverName ?? "Pending Approver",
      roleLabel: row.CurrentApproverRole,
      sinceDate: row.CurrentApproverAssignedDate ?? row.SubmittedDate ?? row.CreationDate ?? "",
    };
  }
  if (docStatus === "Rejected" || docStatus === "Returned") {
    return {
      type: "Requester",
      name: row.RequesterName ?? "Requester",
      roleLabel: "Preparer",
      sinceDate: row.SubmittedDate ?? row.CreationDate ?? "",
    };
  }
  if (docStatus === "Approved" && !po) {
    return {
      type: "Buyer",
      name: "Unassigned Buyer",
      roleLabel: "Category Buyer",
      sinceDate: row.ApprovedDate ?? "",
    };
  }
  if (po && receipt && receipt.receivedQty < receipt.orderedQty) {
    return {
      type: po.status === "Open" ? "Supplier" : "Receiving",
      name: po.supplier.name,
      sinceDate: po.creationDate,
    };
  }
  if (po) {
    return {
      type: "Supplier",
      name: po.supplier.name,
      sinceDate: po.creationDate,
    };
  }
  return {
    type: "Approver",
    name: "Unknown",
    sinceDate: row.CreationDate ?? "",
  };
}

export function toPoSummary(row: FusionPoRow): PoSummary {
  return {
    purchaseOrder: row.OrderNumber,
    poHeaderId: row.POHeaderId,
    revision: row.Revision ?? 0,
    hasPendingChange: truthy(row.HasPendingChangeOrder),
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
    hasHold: truthy(row.HasHold),
  };
}
