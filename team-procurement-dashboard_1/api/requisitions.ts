import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fusionGet, FSCM, FusionError } from "./_lib/fusion-client";
import {
  toRequisitionSummary,
  toPoSummary,
  toReceiptSummary,
  type FusionRequisitionRow,
  type FusionPoRow,
  type FusionReceiptSummaryRow,
} from "./_lib/mappers";
import type { RequisitionSummary } from "../src/lib/fusion-types";

/**
 * GET /api/requisitions
 *
 * Query params (mirror FilterState on the frontend):
 *   reporteeId, stage, businessUnit, agingBucket, category, supplier,
 *   minAmount, maxAmount, search, onHoldOnly
 *
 * Fusion sources:
 *   /fscmRestApi/resources/11.13.18.05/purchaseRequisitions
 *   /fscmRestApi/resources/11.13.18.05/purchaseOrders
 *   /fscmRestApi/resources/11.13.18.05/receivingReceiptRequests
 *
 * Strategy:
 *   1. Pull requisition headers filtered by manager's subtree + status.
 *   2. For each req with an associated PO, hydrate PO + receipt summary.
 *   3. Map to frontend shape.
 *
 * PRODUCTION NOTE: This performs N+1 fetches in the naive form. Before going
 * to real volume, switch to an OTBI subject-area query joining requisitions +
 * POs + receipts in one call — dramatically fewer round-trips.
 */

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  try {
    const q = buildReqQuery(req.query);

    const data = await fusionGet<{ items: FusionRequisitionRow[] }>(
      `${FSCM}/purchaseRequisitions`,
      {
        q,
        // Ask for the fields mapper expects. Tune to your pod's availability.
        fields: [
          "RequisitionHeaderId",
          "Requisition",
          "Description",
          "DocumentStatus",
          "DocumentStatusCode",
          "FundsStatus",
          "OnHold",
          "PreparerId",
          "PreparerName",
          "RequesterId",
          "RequesterName",
          "RequesterManagerId",
          "RequisitioningBUName",
          "LedgerName",
          "CurrencyCode",
          "LedgerCurrencyCode",
          "ApprovedAmount",
          "ApprovedAmountInLedgerCurrency",
          "CreationDate",
          "SubmittedDate",
          "ApprovedDate",
          "RequestedDeliveryDate",
          "LineCount",
          "CurrentApproverName",
          "CurrentApproverRole",
          "CurrentApproverAssignedDate",
          "TopCategoryName",
        ].join(","),
        limit: 200,
        orderBy: "CreationDate:desc",
      },
    );

    const headers = data.items ?? [];

    // Hydrate PO + receipt for reqs that have them. In parallel; capped at 10
    // concurrent fetches to avoid drowning Fusion.
    const enriched = await parallelLimit(headers, 10, async (h) => {
      const po = await fetchPoForReq(h.RequisitionHeaderId).catch(() => null);
      const receipt = po
        ? await fetchReceiptForPo(po.poHeaderId).catch(() => null)
        : null;
      return toRequisitionSummary(h, po, receipt);
    });

    const filtered = applyFiltersServerSide(enriched, req.query);

    res.setHeader("Cache-Control", "private, max-age=30");
    return res.status(200).json(filtered);
  } catch (e) {
    if (e instanceof FusionError) {
      return res.status(502).json({
        error: "Fusion upstream error",
        status: e.status,
        detail: e.fusionMessage,
      });
    }
    return res.status(500).json({
      error: "Internal error",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

// ---- Query construction ----

function buildReqQuery(q: VercelRequest["query"]): string {
  const clauses: string[] = [];

  if (typeof q.reporteeId === "string" && q.reporteeId !== "all") {
    clauses.push(`RequesterId=${q.reporteeId}`);
  }
  if (typeof q.businessUnit === "string" && q.businessUnit !== "all") {
    clauses.push(`RequisitioningBUName='${escape(q.businessUnit)}'`);
  }
  if (typeof q.onHoldOnly === "string" && q.onHoldOnly === "true") {
    clauses.push(`OnHold='Y'`);
  }

  return clauses.join(";");
}

function escape(s: string): string {
  return s.replace(/'/g, "''");
}

// ---- PO + Receipt hydration ----

async function fetchPoForReq(reqHeaderId: number) {
  const data = await fusionGet<{ items: FusionPoRow[] }>(
    `${FSCM}/purchaseOrders`,
    {
      q: `SourceHeaderId=${reqHeaderId}`,
      fields:
        "POHeaderId,OrderNumber,Revision,HasPendingChangeOrder,CreationDate,StatusCode,Status,Supplier,SupplierId,SupplierSite",
      limit: 1,
    },
  );
  const row = data.items?.[0];
  return row ? toPoSummary(row) : null;
}

async function fetchReceiptForPo(poHeaderId: number) {
  const data = await fusionGet<{ items: FusionReceiptSummaryRow[] }>(
    `${FSCM}/receivingReceiptRequests`,
    {
      q: `POHeaderId=${poHeaderId}`,
      fields:
        "OrderedQuantity,ReceivedQuantity,AcceptedQuantity,ReturnedQuantity,UOMCode,LastReceiptNumber,LastReceiptDate,HasHold",
      limit: 1,
    },
  );
  const row = data.items?.[0];
  return row ? toReceiptSummary(row) : null;
}

// ---- Client-side-style residual filters ----

function applyFiltersServerSide(
  rows: RequisitionSummary[],
  q: VercelRequest["query"],
): RequisitionSummary[] {
  let out = rows;

  if (typeof q.search === "string" && q.search.trim()) {
    const term = q.search.toLowerCase();
    out = out.filter((r) =>
      [
        r.requisition,
        r.description,
        r.requester.name,
        r.po?.purchaseOrder,
        r.po?.supplier.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }
  if (typeof q.minAmount === "string") {
    const min = Number(q.minAmount);
    out = out.filter((r) => r.amountInLedgerCurrency.value >= min);
  }
  if (typeof q.maxAmount === "string") {
    const max = Number(q.maxAmount);
    out = out.filter((r) => r.amountInLedgerCurrency.value <= max);
  }

  return out;
}

// ---- Concurrency helper ----

async function parallelLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
