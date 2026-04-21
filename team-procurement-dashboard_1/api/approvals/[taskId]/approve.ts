import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fusionPost, FusionError } from "../../_lib/fusion-client";

/**
 * POST /api/approvals/:taskId/approve
 *
 * Body: { comment?: string }
 *
 * Fusion target: BPM Workflow Services.
 * Typical path: /bpmservices/workflow/tasks/:taskId/actions/APPROVE
 *
 * The exact endpoint varies by pod / version. If this fails, inspect:
 *   /bpmservices/workflow/tasks?q=taskNumber=<n>
 * to confirm the task id format expected.
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

    const comment =
      typeof req.body === "object" && req.body && "comment" in req.body
        ? String((req.body as { comment?: string }).comment ?? "")
        : "";

    await fusionPost(`/bpmservices/workflow/tasks/${taskId}/actions/APPROVE`, {
      comment,
    });

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
