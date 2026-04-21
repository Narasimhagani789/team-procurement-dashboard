/**
 * Types aligned to Oracle Fusion Procurement REST resource shapes.
 *
 * When you move from mocks to real Fusion, these shapes should map 1:1 to
 * the JSON returned by:
 *   /fscmRestApi/resources/11.13.18.05/purchaseRequisitions
 *   /fscmRestApi/resources/11.13.18.05/purchaseOrders
 *   /fscmRestApi/resources/11.13.18.05/receivingReceiptRequests
 *   /hcmRestApi/resources/11.13.18.05/workers
 *   /bpmservices/workflow (for approval tasks)
 *
 * Dates are ISO strings. Amounts are always a {value, currency} pair.
 */

// ---- Status enums (match Fusion exactly) ----

export type DocumentStatus =
  | "Incomplete"
  | "Pending Approval"
  | "Approved"
  | "Rejected"
  | "Returned"
  | "Withdrawn"
  | "Canceled";

export type PoStatus =
  | "Open"
  | "Closed for Receiving"
  | "Closed for Invoicing"
  | "Finally Closed"
  | "Canceled"
  | "Frozen"
  | "On Hold";

export type FundsStatus = "Reserved" | "Liquidated" | "Failed" | null;

// The coarse lens the dashboard uses. Derived from the fields above.
export type DashboardStage =
  | "Pending"     // documentStatus = Pending Approval
  | "NeedsFix"    // documentStatus = Rejected | Returned
  | "Buyer"       // Approved, no PO yet (or PO not communicated)
  | "Receiving"   // PO Open, receipts in progress
  | "Complete";   // Received or Finally Closed

export type ActorType =
  | "Approver"
  | "Buyer"
  | "Supplier"
  | "Receiving"
  | "Requester";

// ---- Shared value objects ----

export interface Money {
  value: number;
  currency: string; // ISO-4217 (INR, USD, EUR, ...)
}

export interface Person {
  personId: number;
  name: string;
  email?: string;
  title?: string;
}

export interface CurrentActor {
  type: ActorType;
  name: string;
  roleLabel?: string; // e.g. "Finance Approver"
  sinceDate: string;  // ISO — used to compute aging
}

// ---- Downstream (PO + Receipts) ----

export interface PoSummary {
  purchaseOrder: string;        // "PO-88231"
  poHeaderId: number;
  revision: number;
  hasPendingChange: boolean;
  creationDate: string;
  status: PoStatus;
  supplier: { id: number; name: string; site: string };
}

export interface ReceiptSummary {
  orderedQty: number;
  receivedQty: number;
  acceptedQty: number;
  returnedQty: number;
  uom: string;
  lastReceiptNumber?: string;
  lastReceiptDate?: string;
  hasHold?: boolean;
}

// ---- Requisition ----

export interface RequisitionSummary {
  // Identity
  requisitionHeaderId: number;
  requisition: string;              // human-readable number
  description: string;

  // Business context
  businessUnit: string;
  requisitioningBU: string;
  ledger: string;

  // People
  preparer: Person;
  requester: Person;
  managerId: number;                // for hierarchy filtering

  // Status
  documentStatus: DocumentStatus;
  fundsStatus: FundsStatus;
  onHold: boolean;

  // Current owner + aging source
  currentActor: CurrentActor;

  // Amounts
  amount: Money;                    // transactional currency
  amountInLedgerCurrency: Money;    // ledger currency for rollups

  // Lifecycle dates
  creationDate: string;
  submittedDate: string | null;
  approvedDate: string | null;
  needByDate: string;

  // Lines summary
  lineCount: number;
  topCategory: string;

  // Downstream
  po: PoSummary | null;
  receipt: ReceiptSummary | null;
}

// Full detail includes expensive relations — fetched lazily on drawer open
export interface ApprovalStep {
  stepNumber: number;
  approver: Person;
  role: string;
  status: "Pending" | "Approved" | "Rejected" | "Skipped";
  actionDate?: string;
  comments?: string;
}

export interface ChangeOrderSummary {
  changeOrderNumber: string;
  revision: number;
  status: string;
  submittedDate: string;
  description: string;
  submittedBy: string;
}

export interface ReceiptTransaction {
  receiptNumber: string;
  receivedDate: string;
  quantity: number;
  uom: string;
  status: string;
  receiver: string;
}

export interface Attachment {
  name: string;
  category: string;
  uploadedBy: string;
  uploadedDate: string;
  size?: string;
}

export interface RequisitionDetail extends RequisitionSummary {
  approvalChain: ApprovalStep[];
  changeOrders: ChangeOrderSummary[];
  receipts: ReceiptTransaction[];
  attachments: Attachment[];
  comments: Array<{
    author: string;
    date: string;
    text: string;
  }>;
}

// ---- UI state types ----

export type AgingBucket = "0-3" | "4-7" | "8-14" | "15+";

export interface FilterState {
  reporteeId: number | "all";
  stage: DashboardStage | "all";
  businessUnit: string | "all";
  agingBucket: AgingBucket | "all";
  category: string | "all";
  supplier: string | "all";
  minAmount: number | null;         // in ledger currency
  maxAmount: number | null;
  search: string;
  onHoldOnly: boolean;
}

export const EMPTY_FILTER: FilterState = {
  reporteeId: "all",
  stage: "all",
  businessUnit: "all",
  agingBucket: "all",
  category: "all",
  supplier: "all",
  minAmount: null,
  maxAmount: null,
  search: "",
  onHoldOnly: false,
};

export interface ExceptionItem {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  count: number;
  filterPatch: Partial<FilterState>;
}

export interface SavedView {
  id: string;
  name: string;
  filter: FilterState;
  createdAt: string;
}

export interface CurrentUser {
  personId: number;
  name: string;
  roles: string[];
  primaryBU: string;
  ledger: string;
  ledgerCurrency: string;
}
