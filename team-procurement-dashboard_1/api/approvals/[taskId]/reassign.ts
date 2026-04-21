import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fusionPost, FusionError } from "../../_lib/fusion-client";

/**
 * POST /api/approvals/:taskId/reassign
 *
 * Body: { newApprover: string }   // username or personId, pod-dependent
 *
 * Fusion target: /bpmservices/workflow/tasks/:taskId/actions/REASSIGN
 * (exact action verb varies: REASSIGN, DELEGATE, ROUTE — check your pod).
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const taskId = String(req.query.taskId ?? "");
    if (!taskId) return res.status(400).json({ error: "taskId required" });

    const newApprover =
      typeof req.body === "object" && req.body && "newApprover" in req.body
        ? String((req.body as { newApprover?: string }).newApprover ?? "")
        : "";

    if (!newApprover) {
      return res.status(400).json({ error: "newApprover required" });
    }

    await fusionPost(
      `/bpmservices/workflow/tasks/${taskId}/actions/REASSIGN`,
      { assignee: newApprover },
    );

    return res.status(200).json({ ok: true });
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
