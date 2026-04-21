import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fusionGet, HCM, FusionError } from "./_lib/fusion-client";
import type { CurrentUser } from "../src/lib/fusion-types";

/**
 * GET /api/me
 *
 * Returns the currently authenticated user's dashboard-relevant profile.
 *
 * Fusion source: /hcmRestApi/resources/11.13.18.05/workers?q=Username=<user>
 * For now we look up by FUSION_USER env var (Basic Auth). With OAuth the
 * authenticated subject can be resolved from the token.
 */

interface WorkerRow {
  PersonId: number;
  DisplayName: string;
  BusinessUnitName?: string;
  LedgerName?: string;
  PrimaryLedgerCurrencyCode?: string;
}

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  try {
    const username = process.env.FUSION_USER;
    if (!username) throw new Error("FUSION_USER not set");

    const data = await fusionGet<{ items: WorkerRow[] }>(
      `${HCM}/workers`,
      {
        q: `Username='${username}'`,
        fields: "PersonId,DisplayName,BusinessUnitName,LedgerName,PrimaryLedgerCurrencyCode",
        limit: 1,
      },
    );

    const worker = data.items?.[0];
    if (!worker) {
      return res.status(404).json({ error: "User not found in HCM" });
    }

    const user: CurrentUser = {
      personId: worker.PersonId,
      name: worker.DisplayName,
      roles: ["Line Manager", "Requisition Approver"], // look up from roles API in v2
      primaryBU: worker.BusinessUnitName ?? "Unknown BU",
      ledger: worker.LedgerName ?? "Unknown Ledger",
      ledgerCurrency: worker.PrimaryLedgerCurrencyCode ?? "USD",
    };

    res.setHeader("Cache-Control", "private, max-age=300");
    return res.status(200).json(user);
  } catch (e) {
    return handleError(res, e);
  }
}

function handleError(res: VercelResponse, e: unknown) {
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
