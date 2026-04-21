/**
 * Shared Fusion HTTP client for the BFF.
 *
 * Auth strategy:
 *   - DEV: Basic Auth from FUSION_USER + FUSION_PASS env vars.
 *   - PROD (later): swap `authHeader()` for an OAuth 2.0 token acquired from
 *     IDCS/IAM using a client credentials grant. The rest of the file does
 *     not change — only authHeader().
 *
 * Environment variables (set in Vercel → Project Settings → Environment Vars):
 *   FUSION_BASE_URL   e.g. https://ekta-dev1.fa.oraclecloud.com
 *   FUSION_USER       Fusion username (dev only)
 *   FUSION_PASS       Fusion password (dev only)
 *
 * Never log the password. Never return it from an API response.
 */

type Json = Record<string, unknown> | unknown[];

export class FusionError extends Error {
  constructor(
    public status: number,
    public fusionMessage: string,
    public url: string,
  ) {
    super(`Fusion ${status} at ${url}: ${fusionMessage}`);
    this.name = "FusionError";
  }
}

function baseUrl(): string {
  const url = process.env.FUSION_BASE_URL;
  if (!url) throw new Error("FUSION_BASE_URL is not set");
  return url.replace(/\/+$/, "");
}

function authHeader(): string {
  // Basic auth for dev. To move to OAuth:
  //   1. Acquire token via client_credentials against IDCS/IAM once per hour
  //   2. Cache in module-level variable with expiry
  //   3. Return `Bearer <token>` here
  const user = process.env.FUSION_USER;
  const pass = process.env.FUSION_PASS;
  if (!user || !pass) {
    throw new Error("FUSION_USER / FUSION_PASS not set");
  }
  const b64 = Buffer.from(`${user}:${pass}`).toString("base64");
  return `Basic ${b64}`;
}

export async function fusionGet<T = Json>(
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : baseUrl() + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
      "REST-Framework-Version": "4",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new FusionError(res.status, text.slice(0, 500), url.pathname);
  }
  return (await res.json()) as T;
}

export async function fusionPost<T = Json>(
  path: string,
  body: Json,
): Promise<T> {
  const url = path.startsWith("http") ? path : baseUrl() + path;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
      "Content-Type": "application/json",
      "REST-Framework-Version": "4",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new FusionError(res.status, text.slice(0, 500), path);
  }
  return (await res.json()) as T;
}

/** Standard REST resource versions we use. */
export const FSCM = "/fscmRestApi/resources/11.13.18.05";
export const HCM = "/hcmRestApi/resources/11.13.18.05";
