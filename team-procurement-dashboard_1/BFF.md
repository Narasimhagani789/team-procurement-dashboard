# BFF — Connecting to Oracle Fusion

The dashboard now calls a backend-for-frontend (BFF) that lives in `api/*.ts`
and runs as Vercel serverless functions. On every request the BFF calls
Fusion REST with Basic Auth and reshapes responses into the dashboard's types.

## What runs where

```
Browser                       Vercel (same domain)              Fusion
─────────                      ─────────────────────             ─────────
preview.tsx        ────GET────► /api/requisitions   ────HTTPS───► /fscmRestApi/...
                                 (fusion-client.ts)
                                                    ◄───JSON─────
                   ◄──JSON────                     (Basic Auth)
```

No CORS. No credentials in the browser. One `git push` deploys both halves.

## Environment variables

Set all four in **Vercel → Project Settings → Environment Variables**. Mark
them for **Production** (and Preview if you use PR preview deploys).

| Variable            | Where used       | Example                                    |
|---------------------|------------------|--------------------------------------------|
| `FUSION_BASE_URL`   | BFF              | `https://ekta-dev1.fa.oraclecloud.com`     |
| `FUSION_USER`       | BFF              | `gaurav.rao@yourco.com`                    |
| `FUSION_PASS`       | BFF (secret)     | *Fusion password for that user*            |
| `VITE_FUSION_BASE`  | Browser (links)  | `https://ekta-dev1.fa.oraclecloud.com`     |
| `VITE_USE_MOCKS`    | Browser          | `false` (or `true` to bypass BFF for UI)   |

**Security reminders:**

- `FUSION_PASS` never appears in frontend code. The `VITE_*` prefix would
  expose it; we deliberately don't use that prefix for anything secret.
- Anyone with access to your Vercel project can read `FUSION_PASS` in the
  env vars UI. For production, swap to OAuth client credentials (one change
  in `api/_lib/fusion-client.ts` — the `authHeader()` function).
- Use a **dedicated service account** with scoped procurement read/approve
  permissions. Not a personal user. Not a privileged admin.

## First request — what to expect

The first time the dashboard hits real Fusion, at least one of these will
surface and need a small fix. Don't panic; the BFF is designed to keep
working on mocks when anything fails, so the UI stays up.

**Symptom: 502 error in browser dev tools, `Fusion upstream error`**
- Check the Vercel function logs (Project → Deployments → latest → Functions
  tab → click the endpoint). The full Fusion error body is logged.
- Most common: field name mismatch in `api/_lib/mappers.ts`. Your pod might
  return `DocumentStatus` instead of `DocumentStatusCode`, or `Requester`
  instead of `RequesterName`. Adjust the interface + mapper.

**Symptom: Dashboard shows mock data despite env being set**
- Check the browser console. If you see
  `[fusion-service] BFF unavailable, falling back to mock data`, the BFF
  returned an error. Click Network tab → look at `/api/requisitions` →
  inspect the response body for the real Fusion error.

**Symptom: 401 Unauthorized from Fusion**
- Basic Auth credentials are wrong, or the user doesn't have REST access.
  Confirm by making the same request with `curl`:
  ```
  curl -u "$FUSION_USER:$FUSION_PASS" \
       "$FUSION_BASE_URL/fscmRestApi/resources/11.13.18.05/purchaseRequisitions?limit=1"
  ```

**Symptom: Empty result set**
- Your user's Fusion data security might not grant visibility to the
  requisitions you expect. Log in to Fusion as that user in a browser and
  confirm what they can see.

## Known gaps the BFF needs before production

1. **Approval task lookup** — The frontend passes `requisitionHeaderId` to
   approve/reject, but Fusion BPM expects a `taskId`. Right now the BFF uses
   the requisition id directly, which will fail. Fix: in
   `api/approvals/[taskId]/approve.ts`, first call
   `/bpmservices/workflow/tasks?q=taskPayload.documentNumber='<req>'` to
   resolve the taskId.

2. **OTBI for list queries** — `api/requisitions.ts` does N+1 fetches
   (header + per-req PO + per-PO receipt). Fine for <100 rows; terrible at
   scale. Replace with an OTBI subject-area query ("Procurement -
   Requisitions Real Time") that returns joined data in one call.

3. **Attachments, change orders, receipt transactions** — The detail
   endpoint returns empty arrays for these. Add three more Fusion calls
   in `api/requisitions/[id].ts` when you need them.

4. **OAuth instead of Basic Auth** — Before production. Swap the
   `authHeader()` function in `api/_lib/fusion-client.ts` to fetch + cache
   a bearer token via client credentials grant against IDCS/IAM.

5. **Rate limiting / caching** — Vercel gives you `Cache-Control` headers
   (already set) but real protection against a runaway polling loop needs
   an actual cache layer (KV, Redis, or `@vercel/kv`).

## Testing the wiring without a real Fusion call

Set `VITE_USE_MOCKS=true` in Vercel and redeploy. The browser bypasses the
BFF entirely and runs on mock data. Useful for:
- Demoing to colleagues without exposing your Fusion pod
- UI changes while the BFF is being debugged
- E2E tests (set `VITE_USE_MOCKS=true` for deterministic data)

Flip back to `false` for real integration testing.
