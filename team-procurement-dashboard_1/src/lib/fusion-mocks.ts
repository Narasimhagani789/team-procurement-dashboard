/**
 * Mock seed data used as fallback when the BFF isn't reachable or when
 * VITE_USE_MOCKS=true is set for local dev.
 *
 * Same data as the original standalone dashboard so the demo experience is
 * preserved with zero backend config.
 */

import type {
  CurrentUser,
  Person,
  RequisitionSummary,
  RequisitionDetail,
} from "./fusion-types";

const NOW = new Date("2026-04-20T10:00:00Z");
function daysBefore(n: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}
function daysAfter(n: number): string {
  return daysBefore(-n).slice(0, 10);
}

const user: CurrentUser = {
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
    currentActor: { type: "Approver", name: "Ravi Sharma", roleLabel: "Finance Approver", sinceDate: daysBefore(2) },
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
    currentActor: { type: "Buyer", name: "Neha Iyer", roleLabel: "Category Buyer", sinceDate: daysBefore(4) },
    amount: { value: 350000, currency: "INR" },
    amountInLedgerCurrency: { value: 350000, currency: "INR" },
    creationDate: daysBefore(7),
    submittedDate: daysBefore(7),
    approvedDate: daysBefore(5),
    needByDate: daysAfter(2),
    lineCount: 2,
    topCategory: "Facilities.Furniture",
    po: {
      purchaseOrder: "PO-88231", poHeaderId: 800000988231, revision: 0,
      hasPendingChange: false, creationDate: daysBefore(4), status: "Open",
      supplier: { id: 5001, name: "Featherlite Pvt Ltd", site: "MUM-01" },
    },
    receipt: {
      orderedQty: 20, receivedQty: 8, acceptedQty: 8, returnedQty: 0,
      uom: "Each", lastReceiptNumber: "RCPT-7782", lastReceiptDate: daysBefore(1), hasHold: false,
    },
  },
  {
    requisitionHeaderId: 300000123456003,
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
    currentActor: { type: "Approver", name: "Gaurav", roleLabel: "Line Manager Approver", sinceDate: daysBefore(3) },
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
    requisitionHeaderId: 300000123456004,
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
    currentActor: { type: "Buyer", name: "Neha Iyer", roleLabel: "Category Buyer", sinceDate: daysBefore(5) },
    amount: { value: 555000, currency: "INR" },
    amountInLedgerCurrency: { value: 555000, currency: "INR" },
    creationDate: daysBefore(8),
    submittedDate: daysBefore(8),
    approvedDate: daysBefore(6),
    needByDate: daysAfter(4),
    lineCount: 1,
    topCategory: "IT.Computer Equipment",
    po: {
      purchaseOrder: "PO-88309", poHeaderId: 800000988309, revision: 0,
      hasPendingChange: false, creationDate: daysBefore(5), status: "On Hold",
      supplier: { id: 5003, name: "Lenovo India Pvt Ltd", site: "BLR-01" },
    },
    receipt: {
      orderedQty: 15, receivedQty: 2, acceptedQty: 2, returnedQty: 0,
      uom: "Each", lastReceiptNumber: "RCPT-7804", lastReceiptDate: daysBefore(2), hasHold: true,
    },
  },
  {
    requisitionHeaderId: 300000123456005,
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
    currentActor: { type: "Approver", name: "Sameer Iyengar", roleLabel: "IT Approver", sinceDate: daysBefore(16) },
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
    requisitionHeaderId: 300000123456006,
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
    currentActor: { type: "Supplier", name: "HP India Pvt Ltd", sinceDate: daysBefore(10) },
    amount: { value: 35000, currency: "INR" },
    amountInLedgerCurrency: { value: 35000, currency: "INR" },
    creationDate: daysBefore(13),
    submittedDate: daysBefore(13),
    approvedDate: daysBefore(11),
    needByDate: daysAfter(-1),
    lineCount: 2,
    topCategory: "Office.Consumables",
    po: {
      purchaseOrder: "PO-87864", poHeaderId: 800000987864, revision: 0,
      hasPendingChange: false, creationDate: daysBefore(11), status: "Closed for Receiving",
      supplier: { id: 5005, name: "HP India Pvt Ltd", site: "BLR-02" },
    },
    receipt: {
      orderedQty: 50, receivedQty: 50, acceptedQty: 50, returnedQty: 0,
      uom: "Each", lastReceiptNumber: "RCPT-7768", lastReceiptDate: daysBefore(2), hasHold: false,
    },
  },
  {
    requisitionHeaderId: 300000123456007,
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
    currentActor: { type: "Buyer", name: "Kevin Tan", roleLabel: "Category Buyer (US)", sinceDate: daysBefore(11) },
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

function detail(id: number): RequisitionDetail {
  const r = requisitions.find((x) => x.requisitionHeaderId === id);
  if (!r) throw new Error("Requisition not found");
  return {
    ...r,
    approvalChain: [
      {
        stepNumber: 1,
        approver: { personId: 1001, name: "Gaurav" },
        role: "Line Manager",
        status: "Approved",
        actionDate: r.submittedDate ?? r.creationDate,
        comments: "Looks good from people manager side.",
      },
      {
        stepNumber: 2,
        approver: { personId: 2001, name: r.currentActor.name },
        role: r.currentActor.roleLabel ?? "Approver",
        status: r.documentStatus === "Pending Approval" ? "Pending" : "Approved",
        actionDate: r.approvedDate ?? undefined,
      },
    ],
    changeOrders: [],
    receipts: r.receipt
      ? [{
          receiptNumber: r.receipt.lastReceiptNumber ?? "RCPT-0000",
          receivedDate: r.receipt.lastReceiptDate ?? new Date().toISOString(),
          quantity: r.receipt.receivedQty,
          uom: r.receipt.uom,
          status: r.receipt.hasHold ? "On Hold" : "Accepted",
          receiver: "Store Keeper",
        }]
      : [],
    attachments: [{
      name: "Quotation-" + r.requisition + ".pdf",
      category: "To Buyer",
      uploadedBy: r.requester.name,
      uploadedDate: r.creationDate,
      size: "142 KB",
    }],
    comments: [{ author: r.requester.name, date: r.creationDate, text: "Requisition raised per approved capex plan." }],
  };
}

export function getMockData() {
  return {
    user,
    reportees,
    requisitions,
    detail,
    approve: (id: number) => {
      const r = requisitions.find((x) => x.requisitionHeaderId === id);
      if (!r) return;
      r.documentStatus = "Approved";
      r.approvedDate = new Date().toISOString();
    },
    reject: (id: number, _comment: string) => {
      const r = requisitions.find((x) => x.requisitionHeaderId === id);
      if (!r) return;
      r.documentStatus = "Rejected";
    },
    reassign: (id: number, newApprover: string) => {
      const r = requisitions.find((x) => x.requisitionHeaderId === id);
      if (!r) return;
      r.currentActor = { ...r.currentActor, name: newApprover, sinceDate: new Date().toISOString() };
    },
  };
}
