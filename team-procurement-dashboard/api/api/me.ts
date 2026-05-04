import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { CurrentUser } from "../src/lib/fusion-types";

/**
 * GET /api/me
 *
 * SIMPLIFIED: returns a profile based on env vars only, no HCM lookup.
 * Avoids the case where the procurement service user has no HCM role.
 *
 * Once you wire HCM access, swap this back to looking up the worker.
 */
export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  const user: CurrentUser = {
    personId: 0,
    name: process.env.FUSION_USER ?? "Fusion User",
    roles: ["Procurement Viewer"],
    primaryBU: "—",
    ledger: "—",
    ledgerCurrency: "USD",
  };
  res.setHeader("Cache-Control", "private, max-age=300");
  return res.status(200).json(user);
}
