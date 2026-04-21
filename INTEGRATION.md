# Team Procurement Dashboard — Fusion Integration Guide

A procurement manager dashboard designed to sit in front of Oracle Fusion
Procurement. Ships with realistic mock data so you can run and iterate on it
standalone, then swap one file to connect to real Fusion.

## File layout

```
preview.tsx                         Main dashboard component
hooks/
  use-live-requisitions.ts          Polling hook + SSE swap point
lib/
  fusion-types.ts                   TS interfaces mirroring Fusion REST shapes
  fusion-utils.ts                   Pure helpers (aging, stage, CSV)
  fusion-service.ts                 THE SWAP POINT — mock today, BFF tomorrow
```

Drop these under your project with whatever folder convention you use. The
imports assume a `@/*` alias (same as the shadcn setup in the original file).
Path mappings (adjust `tsconfig.json` / `vite.config` / `next.config` as needed):

- `@/lib/*` → `lib/*`
- `@/hooks/*` → `hooks/*`
- `@/components/ui/*` → your shadcn directory (already set up)

## Prerequisites

The existing project dependencies cover everything here:

- `react`, `react-dom`
- `lucide-react`
- `recharts` (kept imported in the old preview; no longer required — the pie
  chart was replaced by the aging board, which is pure flex layout)
- `tailwindcss` with the amber / rose / emerald / violet palettes enabled
  (default in Tailwind v3+)
- shadcn `Card` and `Button`

No new npm installs, no new shadcn components.

## Running the mock

Just import and render `<Dashboard />` from `preview.tsx`. The service layer
returns canned data after a short simulated latency. Every ~3 polls a row
mutates to make the live indicator earn its keep.

## Connecting to real Fusion — the swap point

**Everything that talks to Fusion is in `lib/fusion-service.ts`.** Replace each
function body with a `fetch()` to your BFF. The shapes in `fusion-types.ts`
match Fusion REST responses, so no refactoring in the UI should be needed.

### Why a BFF is non-negotiable

You cannot call Fusion REST APIs directly from the browser:

1. **CORS** blocks any non-Fusion origin by default.
2. **Credentials** — Fusion auth (OAuth 2.0 via IDCS/IAM, or Basic) can't live
   in a SPA.
3. **Shape mismatch** — Fusion returns deeply nested REST with pagination
   (25 default, 500 max). One dashboard row is 3–4 API calls to hydrate.
4. **Performance** — OTBI aggregations belong on the server with caching.

### Recommended BFF endpoints

| Browser call                                    | BFF route                                        | Fusion source                                                  |
|-------------------------------------------------|--------------------------------------------------|----------------------------------------------------------------|
| `getCurrentUser()`                              | `GET /api/fusion/me`                             | Session + `/hcmRestApi/.../workers` self-lookup                |
| `getReportees(managerId)`                       | `GET /api/fusion/reportees/:id`                  | `/hcmRestApi/.../workers?q=managerId=<id>`                     |
| `getRequisitions(filter)`                       | `GET /api/fusion/requisitions?<query>`           | OTBI subject area **Procurement - Requisitions Real Time**     |
| `getRequisitionDetail(id)`                      | `GET /api/fusion/requisitions/:id`               | Composite: `/purchaseRequisitions/:id` + `/approvalTasks` + `/purchaseOrders` + `/receivingReceiptRequests` |
| `getFilterOptions()`                            | `GET /api/fusion/requisitions/options`           | LOV lookups                                                    |
| `getExceptions(filter)`                         | `GET /api/fusion/requisitions/exceptions`        | Same as `getRequisitions`, with server-side rules applied      |
| `approveRequisition(id, comment)`               | `POST /api/fusion/approvals/:taskId/approve`     | `/bpmservices/workflow/...`                                    |
| `rejectRequisition(id, comment)`                | `POST /api/fusion/approvals/:taskId/reject`      | `/bpmservices/workflow/...`                                    |
| `reassignApproval(id, to)`                      | `POST /api/fusion/approvals/:taskId/reassign`    | `/bpmservices/workflow/...`                                    |

### Auth on the BFF

OAuth 2.0 against IDCS / OCI IAM. The browser gets a BFF session cookie; the
BFF holds the Fusion token and refreshes it. Basic Auth still works for
server-to-server but is being deprecated for integrations — don't build on it.

### Strategy: OTBI for lists, REST for details and actions

- **Dashboard list (`getRequisitions`)** — OTBI is dramatically more efficient
  than REST for aggregated views. Build a subject-area query once, call as a
  web service, cache in the BFF for ~60s.
- **Drawer detail (`getRequisitionDetail`)** — REST is fine here; it's
  on-demand and single-record.
- **Actions (`approve`, `reject`, `reassign`)** — BPM workflow REST APIs.
  Return a task id + the post-state so the UI can optimistically update.

## Real-time strategy

### v1 — Polling (what's in the hook today)

`useLiveRequisitions` polls `getRequisitions` at a configurable interval
(default 30s). It diffs each poll against the previous snapshot, flashes rows
whose signature changed, and keeps a `lastUpdated` timestamp. The header strip
has play/pause, a cadence selector, and a manual refresh.

Characteristics:
- **Simple**: no persistent connection, no auth-refresh dance over time
- **Adequate**: 30–60s latency is invisible to a procurement workflow
- **Load-safe**: each user's browser hits the BFF, not Fusion — the BFF caches

### v2 — Server-Sent Events from the BFF

When polling cost or latency becomes a problem, swap the polling `useEffect`
in `use-live-requisitions.ts` for an `EventSource`. Sketch:

```ts
useEffect(() => {
  const es = new EventSource(`/api/fusion/requisitions/stream?${query}`);
  es.addEventListener("snapshot", (e) => setData(JSON.parse(e.data)));
  es.addEventListener("update",   (e) => patchRow(JSON.parse(e.data)));
  es.addEventListener("remove",   (e) => removeRow(JSON.parse(e.data).id));
  return () => es.close();
}, [filter]);
```

On the BFF side, the stream endpoint:
1. Subscribes to the relevant **Fusion Business Events** (documented at
   `/fscmRestApi/resources/11.13.18.05/businessEvents`)
2. Or, if Business Events aren't available in your environment, polls Fusion
   itself on a tighter loop and fans out updates to connected users
3. Pushes `snapshot` on connect and `update` / `remove` events as they happen

One BFF↔Fusion connection, N BFF↔browser streams. Cost scales with users,
not requests.

### v3 — WebSockets

Only if you need bidirectional channels (e.g. collaborative editing or
presence). For a read-mostly dashboard with action buttons that are
fire-and-forget HTTP POSTs, SSE is sufficient and much simpler.

## Fusion field mapping

The interfaces in `fusion-types.ts` use Fusion's own field names wherever
possible. A few notes on things that aren't obvious:

- `requisitionHeaderId` is the primary key for `/purchaseRequisitions`. Deep
  links use it; so does the approval task. Keep it as a number — it exceeds
  JavaScript's safe-integer range only for very large tenants (if yours does,
  use `bigint` or keep it as a string).
- `documentStatus` takes a narrow string enum, but Fusion will surface more
  values than we handle here (e.g. `Pending Cancellation`). Treat unknown
  values as `Incomplete` in `stageOf()` or extend the enum.
- `fundsStatus` only appears if Budgetary Control is enabled in your pod. The
  UI treats `null` as "not applicable" — safe to leave untouched.
- `amountInLedgerCurrency` is not a native Fusion field. Compute it on the BFF
  using `/generalLedgerCurrencies` + primary ledger definition, or add it as
  an OTBI-level conversion.
- `currentActor` is derived: it's the approver from BPM if pending, the buyer
  from PO agent assignment if approved-no-PO, the supplier from PO
  communication status if ordered, the receiver if in receiving. This
  collapse happens on the BFF.

## Hierarchy and the reportee picker

`getReportees` currently returns five hardcoded names. In real Fusion, call:

```
GET /hcmRestApi/resources/11.13.18.05/workers
    ?q=managerId=<currentUserPersonId>
    &fields=PersonId,DisplayName,WorkEmail,PrimaryJobTitle
```

Decide early whether you want **direct reports only** or the **full subtree**.
Procurement dashboards almost always want the subtree — a skip-level manager
still cares about everything beneath them. Walk the tree on the BFF
recursively, then cache per manager for ~10 minutes.

Also handle **delegation**: if Gaurav is OOO and delegated to Priya via BPM,
Priya should see Gaurav's dashboard. Call `/bpmservices/workflow/delegations`
and union the reportee lists.

## Deep links

`buildRequisitionDeepLink` and `buildPoDeepLink` construct URLs to the actual
Fusion UI. Set `window.FUSION_BASE` (or wire through a real config) to your
pod's base URL:

```html
<script>
  window.FUSION_BASE = "https://ekta-dev1.fa.oraclecloud.com";
</script>
```

Every row has an "Open in Fusion" link, and the drawer has one in the action
area. This is your escape hatch for anything you haven't built yet in the
dashboard — never reach feature parity, always provide the link.

## Saved views

Stored in `localStorage` under `procurement-dashboard:saved-views:v1`. Fine as
v1. To sync across devices, extend the BFF with:

```
GET  /api/me/preferences/dashboard-views
POST /api/me/preferences/dashboard-views
```

...and swap `loadSavedViews` / `persistSavedViews` in `preview.tsx`.

## CSV export

Client-side, via `Blob` + download anchor. For large datasets (10k+ rows) move
this to the BFF — generate the CSV server-side from an OTBI query stream, and
have the browser open the download URL.

## What's intentionally not in this template

Honest list so you know what's left:

- **Approval reassignment UI** — the service function exists; wire it to a
  dialog when you need it
- **Bulk approve** — requires list-multiselect UI; straightforward to add on
  top of the current row component
- **Pagination / virtualization** — fine for a manager view (usually <200
  rows). For org-wide views add `react-virtual` over `RequisitionList`
- **Real-time presence** — nobody needs it on a procurement dashboard
- **Audit / compliance log** — belongs on the BFF, not the UI
- **Budget / accounting drilldowns** — separate dashboard, not this one
- **Supplier scorecards** — separate product, don't squeeze into here
- **i18n** — English-only strings throughout; wrap in `useTranslation()` when
  needed
- **Dark mode** — the palette is light-only by design. Procurement folks look
  at this in office light; dark mode adds complexity without benefit

## Opinionated subtractions from the previous version

- The "All Requests" KPI tile is gone — redundant with the list below it and
  made the row feel busy
- The pie chart is gone — replaced by the aging board, which tells you
  *where time is piling up*, not just *what exists*
- The `pendingDays` field is gone from the data model — it's now computed
  from `currentActor.sinceDate`, so it can never go stale
- Scalar `receipt: 70` is gone — replaced with a real quantity object
  (`orderedQty`, `receivedQty`, `uom`)
- String amounts are gone — everything is `Money { value, currency }` with a
  separate ledger-currency field for rollups
