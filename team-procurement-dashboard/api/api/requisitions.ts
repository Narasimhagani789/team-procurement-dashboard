import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fusionGet, FSCM, FusionError } from "./_lib/fusion-client";
import {
  toRequisitionSummary,
  type FusionRequisitionRow,
} from "./_lib/mappers";

/**
 * GET /api/requisitions
 *
 * SIMPLIFIED VERSION:
 *  - Pulls requisitions with `expand=lines` so amounts + categories come inline
 *  - Skips PO + receipt hydration (those need their own mapper work)
 *  - Falls back gracefully when fields don't exist on this pod
 *
 * Once this returns real data on the dashboard, we'll layer back PO + receipt
 * fetches in a follow-up.
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
        ...(q ? { q } : {}),
        expand: "lines",
        limit: 50,
        orderBy: "CreationDate:desc",
      },
    );

    const headers = data.items ?? [];
    const summaries = headers.map(toRequisitionSummary);

    const filtered = applyResidualFilters(summaries, req.query);

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

function buildReqQuery(q: VercelRequest["query"]): string {
  const clauses: string[] = [];

  if (typeof q.businessUnit === "string" && q.businessUnit !== "all") {
    clauses.push(`RequisitioningBU='${escape(q.businessUnit)}'`);
  }

  return clauses.join(";");
}

function escape(s: string): string {
  return s.replace(/'/g, "''");
}

function applyResidualFilters(
  rows: ReturnType<typeof toRequisitionSummary>[],
  q: VercelRequest["query"],
) {
  let out = rows;

  if (typeof q.search === "string" && q.search.trim()) {
    const term = q.search.toLowerCase();
    out = out.filter((r) =>
      [r.requisition, r.description, r.requester.name]
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
