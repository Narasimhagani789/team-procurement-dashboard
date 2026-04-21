import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fusionGet, HCM, FusionError } from "./_lib/fusion-client";
import type { Person } from "../src/lib/fusion-types";

/**
 * GET /api/reportees?managerId=<id>
 *
 * Fusion source: /hcmRestApi/resources/11.13.18.05/workers?q=ManagerId=<id>
 *
 * Returns direct reports. For subtree (skip-level managers), this needs to
 * recurse. Keep v1 simple — one level down.
 */

interface WorkerRow {
  PersonId: number;
  DisplayName: string;
  WorkEmail?: string;
  PrimaryJobTitle?: string;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  try {
    const managerId = req.query.managerId;
    if (!managerId || Array.isArray(managerId)) {
      return res.status(400).json({ error: "managerId required" });
    }

    const data = await fusionGet<{ items: WorkerRow[] }>(`${HCM}/workers`, {
      q: `ManagerId=${managerId}`,
      fields: "PersonId,DisplayName,WorkEmail,PrimaryJobTitle",
      limit: 100,
    });

    const reportees: Person[] = (data.items ?? []).map((w) => ({
      personId: w.PersonId,
      name: w.DisplayName,
      email: w.WorkEmail,
      title: w.PrimaryJobTitle,
    }));

    res.setHeader("Cache-Control", "private, max-age=600");
    return res.status(200).json(reportees);
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
