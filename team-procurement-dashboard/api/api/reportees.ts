import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Person } from "../src/lib/fusion-types";

/**
 * GET /api/reportees?managerId=<id>
 *
 * SIMPLIFIED: returns empty list. Wire HCM lookup later when you confirm
 * the user has access to /hcmRestApi/.../workers.
 */
export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  const reportees: Person[] = [];
  res.setHeader("Cache-Control", "private, max-age=600");
  return res.status(200).json(reportees);
}
