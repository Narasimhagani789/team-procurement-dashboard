/**
 * Fusion Service — THE SWAP POINT between mocks and real Oracle Fusion.
 *
 * Today every function returns canned data (occasionally mutated to make the
 * live-polling UI demonstrably update). Tomorrow replace each function body
 * with a fetch() to your BFF.
 *
 * DO NOT call Fusion REST APIs directly from the browser:
 *   - CORS will block you from any non-Fusion origin
 *   - Fusion credentials must not live in a SPA
 *   - OTBI / REST responses need caching + reshape + aggregation
 *
 * Recommended BFF surface (names are suggestions):
 *   GET  /api/fusion/me                              -> getCurrentUser()
 *   GET  /api/fusion/reportees/:managerId            -> getReportees()
 *   GET  /api/fusion/requisitions?<FilterState>      -> getRequisitions()
 *        (OTBI subject area: "Procurement - Requisitions Real Time")
 *   GET  /api/fusion/requisitions/:id                -> getRequisitionDetail()
 *        (composite: purchaseRequisitions + approvalTasks + receipts)
 *   POST /api/fusion/approvals/:taskId/approve       -> approveRequisition()
 *   POST /api/fusion/approvals/:taskId/reject        -> rejectRequisition()
 *   POST /api/fusion/approvals/:taskId/reassign      -> reassignApproval()
 *   GET  /api/fusion/requisitions/stream             -> SSE feed (Business
 *        Events fan-out on the BFF side — avoids polling Fusion REST)
 *
 * Auth: OAuth 2.0 via IDCS/IAM on the BFF. Browser never holds Fusion tokens.
 */

import type {
  CurrentUser,
  Person,
  RequisitionSummary,
  RequisitionDetail,
  FilterState,
  ExceptionItem,
} from "./fusion-types";
import { agingDaysFor, bucketFor, stageOf } from "./fusion-utils";

// ---- Mock seed data ----

const mockUser: CurrentUser = {
  personId: 1001,
  name: "Gaurav",
  roles: ["Line Manager", "Requisition Approver"],
  primaryBU: "India Operations BU",
  ledger: "India Primary Ledger",
  ledgerCurrency: "INR",
};

const reportees: Person[] = [
  { personId: 1101, name: "Harsh Patel", email: "harsh.patel@co.in", title: "Sr Engineer" },
  { personId: 1102, name: "Gani Subramanian", email: "gani.s@co.in", title: "Project Lead" },
  { personId: 1103, name: "Narasimha Rao", email: "narasimha.r@co.in", title: "Sr Engineer" },
  { personId: 1104, name: "Deepak Kulkarni", email: "deepak.k@co.in", title: "Engineer" },
  { personId: 1105, name: "Vishal Menon", email: "vishal.m@co.in", title: "Sr Engineer" },
];

const personById: Record<number, Person> = Object.fromEntries(
  reportees.map((p) => [p.personId, p]),
);

// Build mock requisitions. Dates are anchored to "today" = 2026-04-20 so the
// aging buckets line up with the rest of the template.
const NOW = new Date("2026-04-20T10:00:00Z");
function daysBefore(n: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}
function daysAfter(n: number): string {
  return daysBefore(-n).slice(0, 10); // date only for needBy
}

const requisitions: RequisitionSummary[] = [
  {
    requisitionHeaderId: 300000123456001,
    requisition: "REQ-10452",
    description: "Laptop for new joiner",
    businessUnit: "India Operations BU",
    requisitioningBU: "India Operations BU",
    ledger: "India Primary Ledger",
    preparer: personById[1101],
    requester: personById[1101],
    managerId: 1001,
    documentStatus: "Pending Approval",
    fundsStatus: "Reserved",
    onHold: false,
    currentActor: {
      type: "Approver",
      name: "Ravi Sharma",
      roleLabel: "Finance Approver",
      sinceDate: daysBefore(2),
    },
    amount: { value: 120000, currency: "INR" },
    amountInLedgerCurrency: { value: 120000, currency: "INR" },
    creationDate: daysBefore(3),
    submittedDate: daysBefore(2),
    approvedDate: null,
    needByDate: daysAfter(5),
    lineCount: 1,
    topCategory: "IT.Computer Equipment",
    po: null,
    receipt: null,
  },
  {
    requisitionHeaderId: 300000123456002,
    requisition: "REQ-10411",
    description: "Office chairs — 20 units",
    businessUnit: "India Operations BU",
    requisitioningBU: "India Operations BU",
    ledger: "India Primary Ledger",
    preparer: personById[1102],
    requester: personById[1102],
    managerId: 1001,
    documentStatus: "Approved",
    fundsStatus: "Reserved",
    onHold: false,
    currentActor: {
      type: "Buyer",
      name: "Neha Iyer",
      roleLabel: "Category Buyer",
      sinceDate: daysBefore(4),
    },
    amount: { value: 350000, currency: "INR" },
    amountInLedgerCurrency: { value: 350000, currency: "INR" },
    creationDate: daysBefore(7),
    submittedDate: daysBefore(7),
    approvedDate: daysBefore(5),
    needByDate: daysAfter(2),
    lineCount: 2,
    topCategory: "Facilities.Furniture",
    po: {
      purchaseOrder: "PO-88231",
      poHeaderId: 800000988231,
      revision: 0,
      hasPendingChange: false,
      creationDate: daysBefore(4),
      status: "Open",
      supplier: { id: 5001, name: "Featherlite Pvt Ltd", site: "MUM-01" },
    },
    receipt: {
      orderedQty: 20,
      receivedQty: 8,
      acceptedQty: 8,
      returnedQty: 0,
      uom: "Each",
      lastReceiptNumber: "RCPT-7782",
      lastReceiptDate: daysBefore(1),
      hasHold: false,
    },
  },
  {
    requisitionHeaderId: 300000123456003,
    requisition: "REQ-10387",
    description: "Developer workstations — 10 units",
    businessUnit: "India Operations BU",
    requisitioningBU: "India Operations BU",
    ledger: "India Primary Ledger",
    preparer: personById[1103],
    requester: personById[1103],
    managerId: 1001,
    documentStatus: "Approved",
    fundsStatus: "Reserved",
    onHold: false,
    currentActor: {
      type: "Supplier",
      name: "Dell India Pvt Ltd",
      sinceDate: daysBefore(9),
    },
    amount: { value: 985000, currency: "INR" },
    amountInLedgerCurrency: { value: 985000, currency: "INR" },
    creationDate: daysBefore(12),
    submittedDate: daysBefore(12),
    approvedDate: daysBefore(10),
    needByDate: daysAfter(0),
    lineCount: 1,
    topCategory: "IT.Computer Equipment",
    po: {
      purchaseOrder: "PO-87990",
      poHeaderId: 800000987990,
      revision: 1,
      hasPendingChange: true,
      creationDate: daysBefore(10),
      status: "Open",
      supplier: { id: 5002, name: "Dell India Pvt Ltd", site: "BLR-HQ" },
    },
    receipt: {
      orderedQty: 10,
      receivedQty: 7,
      acceptedQty: 7,
      returnedQty: 0,
      uom: "Each",
      lastReceiptNumber: "RCPT-7710",
      lastReceiptDate: daysBefore(3),
      hasHold: false,
    },
  },
  {
    requisitionHeaderId: 300000123456004,
    requisition: "REQ-10333",
    description: "Projector replacement — AVR Room",
    businessUnit: "India Operations BU",
    requisitioningBU: "India Operations BU",
    ledger: "India Primary Ledger",
    preparer: personById[1104],
    requester: personById[1104],
    managerId: 1001,
    documentStatus: "Rejected",
    fundsStatus: null,
    onHold: false,
    currentActor: {
      type: "Requester",
      name: "Deepak Kulkarni",
      roleLabel: "Preparer",
      sinceDate: daysBefore(6),
    },
    amount: { value: 75000, currency: "INR" },
    amountInLedgerCurrency: { value: 75000, currency: "INR" },
    creationDate: daysBefore(8),
    submittedDate: daysBefore(8),
    approvedDate: null,
    needByDate: daysAfter(8),
    lineCount: 1,
    topCategory: "IT.Audio Visual",
    po: null,
    receipt: null,
  },
  {
    requisitionHeaderId: 300000123456005,
    requisition: "REQ-10501",
    description: "Training subscriptions — Pluralsight (5 seats)",
    businessUnit: "India Operations BU",
    requisitioningBU: "India Operations BU",
    ledger: "India Primary Ledger",
    preparer: personById[1105],
    requester: personById[1105],
    managerId: 1001,
    documentStatus: "Pending Approval",
    fundsStatus: "Reserved",
    onHold: false,
    currentActor: {
      type: "Approver",
      name: "Gaurav",
      roleLabel: "Line Manager Approver",
      sinceDate: daysBefore(3),
    },
    amount: { value: 215000, currency: "INR" },
    amountInLedgerCurrency: { value: 215000, currency: "INR" },
    creationDate: daysBefore(5),
    submittedDate: daysBefore(3),
    approvedDate: null,
    needByDate: daysAfter(10),
    lineCount: 1,
    topCategory: "Services.Training",
    po: null,
    receipt: null,
  },
  {
    requisitionHeaderId: 300000123456006,
    requisition: "REQ-10508",
    description: "Monitors for delivery center — 15 units",
    businessUnit: "India Operations BU",
    requisitioningBU: "India Operations BU",
    ledger: "India Primary Ledger",
    preparer: personById[1101],
    requester: personById[1101],
    managerId: 1001,
    documentStatus: "Approved",
    fundsStatus: "Reserved",
    onHold: true,
    currentActor: {
      type: "Buyer",
      name: "Neha Iyer",
      roleLabel: "Category Buyer",
      sinceDate: daysBefore(5),
    },
    amount: { value: 555000, currency: "INR" },
    amountInLedgerCurrency: { value: 555000, currency: "INR" },
    creationDate: daysBefore(8),
    submittedDate: daysBefore(8),
    approvedDate: daysBefore(6),
    needByDate: daysAfter(4),
    lineCount: 1,
    topCategory: "IT.Computer Equipment",
    po: {
      purchaseOrder: "PO-88309",
      poHeaderId: 800000988309,
      revision: 0,
      hasPendingChange: false,
      creationDate: daysBefore(5),
      status: "On Hold",
      supplier: { id: 5003, name: "Lenovo India Pvt Ltd", site: "BLR-01" },
    },
    receipt: {
      orderedQty: 15,
      receivedQty: 2,
      acceptedQty: 2,
      returnedQty: 0,
      uom: "Each",
      lastReceiptNumber: "RCPT-7804",
      lastReceiptDate: daysBefore(2),
      hasHold: true,
    },
  },
  {
    requisitionHeaderId: 300000123456007,
    requisition: "REQ-10476",
    description: "Conference room accessories",
    businessUnit: "India Operations BU",
    requisitioningBU: "India Operations BU",
    ledger: "India Primary Ledger",
    preparer: personById[1102],
    requester: personById[1102],
    managerId: 1001,
    documentStatus: "Approved",
    fundsStatus: "Reserved",
    onHold: false,
    currentActor: {
      type: "Receiving",
      name: "Store Keeper",
      sinceDate: daysBefore(1),
    },
    amount: { value: 104000, currency: "INR" },
    amountInLedgerCurrency: { value: 104000, currency: "INR" },
    creationDate: daysBefore(10),
    submittedDate: daysBefore(10),
    approvedDate: daysBefore(9),
    needByDate: daysAfter(1),
    lineCount: 3,
    topCategory: "Facilities.Accessories",
    po: {
      purchaseOrder: "PO-88142",
      poHeaderId: 800000988142,
      revision: 0,
      hasPendingChange: false,
      creationDate: daysBefore(8),
      status: "Open",
      supplier: { id: 5004, name: "Croma Business", site: "MUM-02" },
    },
    receipt: {
      orderedQty: 12,
      receivedQty: 10,
      acceptedQty: 10,
      returnedQty: 0,
      uom: "Each",
      lastReceiptNumber: "RCPT-7791",
      lastReceiptDate: daysBefore(1),
      hasHold: false,
    },
  },
  {
    requisitionHeaderId: 300000123456008,
    requisition: "REQ-10466",
    description: "Software license renewal — JetBrains All Products Pack",
    businessUnit: "US Operations BU",
    requisitioningBU: "US Operations BU",
    ledger: "US Primary Ledger",
    preparer: personById[1103],
    requester: personById[1103],
    managerId: 1001,
    documentStatus: "Pending Approval",
    fundsStatus: "Reserved",
    onHold: false,
    currentActor: {
      type: "Approver",
      name: "Sameer Iyengar",
      roleLabel: "IT Approver",
      sinceDate: daysBefore(16),
    },
    amount: { value: 9800, currency: "USD" },
    amountInLedgerCurrency: { value: 820000, currency: "INR" },
    creationDate: daysBefore(20),
    submittedDate: daysBefore(16),
    approvedDate: null,
    needByDate: daysAfter(6),
    lineCount: 1,
    topCategory: "IT.Software Licenses",
    po: null,
    receipt: null,
  },
  {
    requisitionHeaderId: 300000123456009,
    requisition: "REQ-10429",
    description: "Printer cartridges — bulk order",
    businessUnit: "India Operations BU",
    requisitioningBU: "India Operations BU",
    ledger: "India Primary Ledger",
    preparer: personById[1104],
    requester: personById[1104],
    managerId: 1001,
    documentStatus: "Approved",
    fundsStatus: "Liquidated",
    onHold: false,
    currentActor: {
      type: "Supplier",
      name: "HP India Pvt Ltd",
      sinceDate: daysBefore(10),
    },
    amount: { value: 35000, currency: "INR" },
    amountInLedgerCurrency: { value: 35000, currency: "INR" },
    creationDate: daysBefore(13),
    submittedDate: daysBefore(13),
    approvedDate: daysBefore(11),
    needByDate: daysAfter(-1),
    lineCount: 2,
    topCategory: "Office.Consumables",
    po: {
      purchaseOrder: "PO-87864",
      poHeaderId: 800000987864,
      revision: 0,
      hasPendingChange: false,
      creationDate: daysBefore(11),
      status: "Closed for Receiving",
      supplier: { id: 5005, name: "HP India Pvt Ltd", site: "BLR-02" },
    },
    receipt: {
      orderedQty: 50,
      receivedQty: 50,
      acceptedQty: 50,
      returnedQty: 0,
      uom: "Each",
      lastReceiptNumber: "RCPT-7768",
      lastReceiptDate: daysBefore(2),
      hasHold: false,
    },
  },
  {
    requisitionHeaderId: 300000123456010,
    requisition: "REQ-10395",
    description: "Docking stations — 8 units",
    businessUnit: "India Operations BU",
    requisitioningBU: "India Operations BU",
    ledger: "India Primary Ledger",
    preparer: personById[1105],
    requester: personById[1105],
    managerId: 1001,
    documentStatus: "Returned",
    fundsStatus: null,
    onHold: false,
    currentActor: {
      type: "Requester",
      name: "Vishal Menon",
      roleLabel: "Preparer",
      sinceDate: daysBefore(2),
    },
    amount: { value: 176000, currency: "INR" },
    amountInLedgerCurrency: { value: 176000, currency: "INR" },
    creationDate: daysBefore(6),
    submittedDate: daysBefore(4),
    approvedDate: null,
    needByDate: daysAfter(7),
    lineCount: 1,
    topCategory: "IT.Accessories",
    po: null,
    receipt: null,
  },
  {
    requisitionHeaderId: 300000123456011,
    requisition: "REQ-10518",
    description: "Cloud infra — AWS reserved instances (Singapore)",
    businessUnit: "Singapore Services BU",
    requisitioningBU: "Singapore Services BU",
    ledger: "Singapore Primary Ledger",
    preparer: personById[1102],
    requester: personById[1102],
    managerId: 1001,
    documentStatus: "Pending Approval",
    fundsStatus: "Reserved",
    onHold: false,
    currentActor: {
      type: "Approver",
      name: "Gaurav",
      roleLabel: "Line Manager Approver",
      sinceDate: daysBefore(1),
    },
    amount: { value: 42000, currency: "SGD" },
    amountInLedgerCurrency: { value: 2625000, currency: "INR" },
    creationDate: daysBefore(2),
    submittedDate: daysBefore(1),
    approvedDate: null,
    needByDate: daysAfter(3),
    lineCount: 3,
    topCategory: "IT.Cloud Services",
    po: null,
    receipt: null,
  },
  {
    requisitionHeaderId: 300000123456012,
    requisition: "REQ-10488",
    description: "GPU server — ML training",
    businessUnit: "US Operations BU",
    requisitioningBU: "US Operations BU",
    ledger: "US Primary Ledger",
    preparer: personById[1103],
    requester: personById[1103],
    managerId: 1001,
    documentStatus: "Approved",
    fundsStatus: "Reserved",
    onHold: false,
    currentActor: {
      type: "Buyer",
      name: "Kevin Tan",
      roleLabel: "Category Buyer (US)",
      sinceDate: daysBefore(11),
    },
    amount: { value: 48500, currency: "USD" },
    amountInLedgerCurrency: { value: 4050000, currency: "INR" },
    creationDate: daysBefore(14),
    submittedDate: daysBefore(14),
    approvedDate: daysBefore(12),
    needByDate: daysAfter(12),
    lineCount: 1,
    topCategory: "IT.Computer Equipment",
    po: null,
    receipt: null,
  },
];

// ---- Helpers ----

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Apply FilterState to a list. In the real BFF this is an OTBI WHERE clause.
function applyFilter(
  rows: RequisitionSummary[],
  filter: FilterState,
): RequisitionSummary[] {
  return rows.filter((r) => {
    if (filter.reporteeId !== "all" && r.requester.personId !== filter.reporteeId) {
      return false;
    }
    if (filter.stage !== "all" && stageOf(r) !== filter.stage) return false;
    if (filter.businessUnit !== "all" && r.businessUnit !== filter.businessUnit) {
      return false;
    }
    if (filter.agingBucket !== "all" && bucketFor(agingDaysFor(r)) !== filter.agingBucket) {
      return false;
    }
    if (filter.category !== "all" && r.topCategory !== filter.category) return false;
    if (
      filter.supplier !== "all" &&
      (!r.po || r.po.supplier.name !== filter.supplier)
    ) {
      return false;
    }
    if (
      filter.minAmount !== null &&
      r.amountInLedgerCurrency.value < filter.minAmount
    ) {
      return false;
    }
    if (
      filter.maxAmount !== null &&
      r.amountInLedgerCurrency.value > filter.maxAmount
    ) {
      return false;
    }
    if (filter.onHoldOnly && !r.onHold) return false;
    if (filter.search.trim()) {
      const q = filter.search.toLowerCase();
      const haystack = [
        r.requisition,
        r.description,
        r.requester.name,
        r.po?.purchaseOrder,
        r.po?.supplier.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

// Occasional mutation so live polling visibly updates rows in demo mode.
// REMOVE when you swap to real BFF — real updates come from real changes.
let tickCount = 0;
function maybeSimulateChange(): void {
  tickCount += 1;
  if (tickCount % 3 !== 0) return; // every ~third poll

  // Rotate which row we touch so something changes each time
  const idx = tickCount % requisitions.length;
  const r = requisitions[idx];

  if (r.receipt && r.receipt.receivedQty < r.receipt.orderedQty) {
    r.receipt.receivedQty = Math.min(
      r.receipt.orderedQty,
      r.receipt.receivedQty + 1,
    );
    r.receipt.acceptedQty = r.receipt.receivedQty;
    r.receipt.lastReceiptDate = new Date().toISOString();
  } else {
    // Bump aging marker forward slightly so the "just now" indicator moves
    r.currentActor = {
      ...r.currentActor,
      sinceDate: r.currentActor.sinceDate,
    };
  }
}

// ---- Public API ----

export async function getCurrentUser(): Promise<CurrentUser> {
  await sleep(40);
  return mockUser;
}

export async function getReportees(_managerId: number): Promise<Person[]> {
  // Real: GET /hcmRestApi/resources/11.13.18.05/workers?q=managerId=<id>
  await sleep(40);
  return reportees;
}

export async function getRequisitions(
  filter: FilterState,
): Promise<RequisitionSummary[]> {
  // Real: call your BFF which wraps an OTBI subject-area query.
  // Aim for server-side filtering + pagination; keep payload slim.
  await sleep(180);
  maybeSimulateChange();
  return applyFilter(requisitions, filter);
}

export async function getRequisitionDetail(
  requisitionHeaderId: number,
): Promise<RequisitionDetail> {
  // Real: composite endpoint that joins:
  //   /purchaseRequisitions/:id
  //   /approvalTasks?q=taskPayload.documentNumber='REQ-xxxx'
  //   /purchaseOrders?q=sourceHeaderId=:id
  //   /receivingReceiptRequests?q=documentNumber='PO-xxxx'
  //   attachments from UCM
  await sleep(250);
  const base = requisitions.find(
    (r) => r.requisitionHeaderId === requisitionHeaderId,
  );
  if (!base) throw new Error("Requisition not found");

  return {
    ...base,
    approvalChain: buildMockApprovalChain(base),
    changeOrders: base.po?.hasPendingChange
      ? [
          {
            changeOrderNumber: `CO-${base.po.purchaseOrder.replace("PO-", "")}-01`,
            revision: 1,
            status: "Pending Approval",
            submittedDate: daysBefore(2),
            description: "Quantity increase from 10 to 12",
            submittedBy: "Neha Iyer",
          },
        ]
      : [],
    receipts: base.receipt
      ? [
          {
            receiptNumber: base.receipt.lastReceiptNumber ?? "RCPT-0000",
            receivedDate: base.receipt.lastReceiptDate ?? daysBefore(1),
            quantity: base.receipt.receivedQty,
            uom: base.receipt.uom,
            status: base.receipt.hasHold ? "On Hold" : "Accepted",
            receiver: "Store Keeper",
          },
        ]
      : [],
    attachments: [
      {
        name: "Quotation-" + base.requisition + ".pdf",
        category: "To Buyer",
        uploadedBy: base.requester.name,
        uploadedDate: base.creationDate,
        size: "142 KB",
      },
    ],
    comments: buildMockComments(base),
  };
}

function buildMockApprovalChain(
  r: RequisitionSummary,
): RequisitionDetail["approvalChain"] {
  const ds = r.documentStatus;
  const pending = ds === "Pending Approval";
  const rejected = ds === "Rejected" || ds === "Returned";

  return [
    {
      stepNumber: 1,
      approver: { personId: 1001, name: "Gaurav" },
      role: "Line Manager",
      status: pending || rejected ? "Approved" : "Approved",
      actionDate: r.submittedDate ?? r.creationDate,
      comments: "Looks good from people manager side.",
    },
    {
      stepNumber: 2,
      approver: { personId: 2001, name: r.currentActor.name },
      role: r.currentActor.roleLabel ?? "Approver",
      status: rejected ? "Rejected" : pending ? "Pending" : "Approved",
      actionDate: pending ? undefined : r.approvedDate ?? undefined,
      comments: rejected
        ? "Budget line item mismatch. Please rework against cost center code."
        : undefined,
    },
    {
      stepNumber: 3,
      approver: { personId: 2002, name: "CFO Office" },
      role: "Finance Head",
      status: rejected ? "Skipped" : pending ? "Pending" : "Approved",
    },
  ];
}

function buildMockComments(
  r: RequisitionSummary,
): RequisitionDetail["comments"] {
  const out: RequisitionDetail["comments"] = [
    {
      author: r.requester.name,
      date: r.creationDate,
      text: "Requisition raised per approved capex plan.",
    },
  ];
  if (r.documentStatus === "Rejected" || r.documentStatus === "Returned") {
    out.push({
      author: r.currentActor.name,
      date: r.currentActor.sinceDate,
      text: "Returning for correction — check cost center mapping.",
    });
  }
  return out;
}

export async function approveRequisition(
  requisitionHeaderId: number,
  comment?: string,
): Promise<void> {
  // Real: POST /bpmservices/workflow/.../approve with taskId payload
  await sleep(300);
  const r = requisitions.find(
    (x) => x.requisitionHeaderId === requisitionHeaderId,
  );
  if (!r) throw new Error("Not found");
  r.documentStatus = "Approved";
  r.approvedDate = new Date().toISOString();
  r.currentActor = {
    type: "Buyer",
    name: "Unassigned Buyer",
    roleLabel: "Category Buyer",
    sinceDate: new Date().toISOString(),
  };
  void comment;
}

export async function rejectRequisition(
  requisitionHeaderId: number,
  comment: string,
): Promise<void> {
  await sleep(300);
  const r = requisitions.find(
    (x) => x.requisitionHeaderId === requisitionHeaderId,
  );
  if (!r) throw new Error("Not found");
  r.documentStatus = "Rejected";
  r.currentActor = {
    type: "Requester",
    name: r.requester.name,
    roleLabel: "Preparer",
    sinceDate: new Date().toISOString(),
  };
  void comment;
}

export async function reassignApproval(
  requisitionHeaderId: number,
  newApprover: string,
): Promise<void> {
  await sleep(250);
  const r = requisitions.find(
    (x) => x.requisitionHeaderId === requisitionHeaderId,
  );
  if (!r) throw new Error("Not found");
  r.currentActor = {
    ...r.currentActor,
    name: newApprover,
    sinceDate: new Date().toISOString(),
  };
}

// Deep link back into the actual Fusion UI. Set FUSION_BASE via env in real use.
const FUSION_BASE =
  (typeof window !== "undefined" && (window as any).FUSION_BASE) ||
  "https://your-fusion-env.fa.oraclecloud.com";

export function buildRequisitionDeepLink(r: RequisitionSummary): string {
  return `${FUSION_BASE}/fscmUI/faces/FuseOverview?fndGlobalItemNodeId=itemNode_procurement_self_service_procurement&fndTaskItemNodeId=MSC_N_MANAGE_REQS&action=manage&requisitionHeaderId=${r.requisitionHeaderId}`;
}

export function buildPoDeepLink(poHeaderId: number): string {
  return `${FUSION_BASE}/fscmUI/faces/FuseOverview?fndGlobalItemNodeId=itemNode_procurement_purchase_orders&action=manage&poHeaderId=${poHeaderId}`;
}

// ---- Exceptions (server-side rules, surfaced to UI) ----

export async function getExceptions(
  filter: FilterState,
): Promise<ExceptionItem[]> {
  await sleep(80);
  const rows = applyFilter(requisitions, filter);
  const out: ExceptionItem[] = [];

  const overdue = rows.filter(
    (r) =>
      stageOf(r) !== "Complete" &&
      new Date(r.needByDate).getTime() < NOW.getTime(),
  );
  if (overdue.length) {
    out.push({
      id: "overdue",
      severity: "critical",
      title: "Past need-by date",
      count: overdue.length,
      filterPatch: { agingBucket: "all" },
    });
  }

  const stuck = rows.filter(
    (r) => agingDaysFor(r, NOW) >= 15 && stageOf(r) !== "Complete",
  );
  if (stuck.length) {
    out.push({
      id: "stuck",
      severity: "critical",
      title: "Stuck 15+ days",
      count: stuck.length,
      filterPatch: { agingBucket: "15+" },
    });
  }

  const onHold = rows.filter((r) => r.onHold);
  if (onHold.length) {
    out.push({
      id: "hold",
      severity: "warning",
      title: "On hold",
      count: onHold.length,
      filterPatch: { onHoldOnly: true },
    });
  }

  const rejected = rows.filter((r) => stageOf(r) === "NeedsFix");
  if (rejected.length) {
    out.push({
      id: "rejected",
      severity: "warning",
      title: "Rejected / Returned — needs requester action",
      count: rejected.length,
      filterPatch: { stage: "NeedsFix" },
    });
  }

  const changeOrders = rows.filter((r) => r.po?.hasPendingChange);
  if (changeOrders.length) {
    out.push({
      id: "change-orders",
      severity: "info",
      title: "POs with pending change orders",
      count: changeOrders.length,
      filterPatch: {},
    });
  }

  return out;
}

// ---- Option lists (for filter dropdowns) ----

export async function getFilterOptions(): Promise<{
  businessUnits: string[];
  categories: string[];
  suppliers: string[];
}> {
  await sleep(20);
  return {
    businessUnits: Array.from(new Set(requisitions.map((r) => r.businessUnit))).sort(),
    categories: Array.from(new Set(requisitions.map((r) => r.topCategory))).sort(),
    suppliers: Array.from(
      new Set(requisitions.map((r) => r.po?.supplier.name).filter(Boolean) as string[]),
    ).sort(),
  };
}
