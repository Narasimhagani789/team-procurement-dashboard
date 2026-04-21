import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fusionGet, FSCM, FusionError } from "../_lib/fusion-client";
import {
  toRequisitionSummary,
  toPoSummary,
  toReceiptSummary,
  type FusionRequisitionRow,
  type FusionPoRow,
  type FusionReceiptSummaryRow,
} from "../_lib/mappers";
import type { RequisitionDetail } from "../../src/lib/fusion-types";

/**
 * GET /api/requisitions/:id
 *
 * Composite response used by the drawer. Fetches header + PO + receipts +
 * approval chain + attachments in parallel.
 *
 * Endpoints pulled:
 *   /purchaseRequisitions/:id
 *   /purchaseRequisitions/:id/child/approvalHistory    (if exposed on your pod)
 *   /purchaseOrders?q=SourceHeaderId=:id
 *   /receivingReceiptRequests?q=POHeaderId=:po
 */

interface ApprovalRow {
  StepNumber: number;
  ApproverId: number;
  ApproverName: string;
  Role?: string;
  Status?: string;
  ActionDate?: string;
  Comments?: string;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  try {
    const id = String(req.query.id ?? "");
    if (!id) return res.status(400).json({ error: "id required" });

    const header = await fusionGet<FusionRequisitionRow>(
      `${FSCM}/purchaseRequisitions/${id}`,
    );

    // Parallel hydration
    const [po, approvals] = await Promise.all([
      fetchPo(header.RequisitionHeaderId).catch(() => null),
      fetchApprovalHistory(id).catch(() => []),
    ]);

    const receipt = po
      ? await fetchReceipt(po.poHeaderId).catch(() => null)
      : null;

    const summary = toRequisitionSummary(header, po, receipt);

    const detail: RequisitionDetail = {
      ...summary,
      approvalChain: approvals.map((a) => ({
        stepNumber: a.StepNumber,
        approver: { personId: a.ApproverId, name: a.ApproverName },
        role: a.Role ?? "Approver",
        status: normalizeApprovalStatus(a.Status),
        actionDate: a.ActionDate,
        comments: a.Comments,
      })),
      changeOrders: po?.hasPendingChange ? [] : [], // wire to /changeOrders endpoint
      receipts: [],                                  // wire to receipt transactions
      attachments: [],                               // UCM attachments endpoint
      comments: [],
    };

    res.setHeader("Cache-Control", "private, max-age=15");
    return res.status(200).json(detail);
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

function normalizeApprovalStatus(
  s?: string,
): "Pending" | "Approved" | "Rejected" | "Skipped" {
  const k = (s ?? "").toUpperCase();
  if (k.includes("APPROVED")) return "Approved";
  if (k.includes("REJECT")) return "Rejected";
  if (k.includes("SKIP")) return "Skipped";
  return "Pending";
}

async function fetchPo(reqHeaderId: number) {
  const data = await fusionGet<{ items: FusionPoRow[] }>(
    `${FSCM}/purchaseOrders`,
    { q: `SourceHeaderId=${reqHeaderId}`, limit: 1 },
  );
  const row = data.items?.[0];
  return row ? toPoSummary(row) : null;
}

async function fetchReceipt(poHeaderId: number) {
  const data = await fusionGet<{ items: FusionReceiptSummaryRow[] }>(
    `${FSCM}/receivingReceiptRequests`,
    { q: `POHeaderId=${poHeaderId}`, limit: 1 },
  );
  const row = data.items?.[0];
  return row ? toReceiptSummary(row) : null;
}

async function fetchApprovalHistory(reqId: string): Promise<ApprovalRow[]> {
  // Fusion exposes approval history differently across pods. One common path:
  //   /purchaseRequisitions/:id/child/approvalHistory
  // Another: /bpmservices/workflow/.../taskHistory. Try header child first.
  try {
    const data = await fusionGet<{ items: ApprovalRow[] }>(
      `${FSCM}/purchaseRequisitions/${reqId}/child/approvalHistory`,
    );
    return data.items ?? [];
  } catch {
    return [];
  }
}
