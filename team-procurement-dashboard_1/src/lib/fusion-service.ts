/**
 * Fusion Service — now calling the BFF under /api/*.
 *
 * Falls back to mock data if:
 *   - VITE_USE_MOCKS=true (set in .env.local for local dev)
 *   - /api/* returns an error (lets you preview the frontend on Vercel even
 *     before setting FUSION_* env vars on the backend)
 *
 * Every function maps 1:1 to an api/*.ts serverless function.
 */

import type {
  CurrentUser,
  Person,
  RequisitionSummary,
  RequisitionDetail,
  FilterState,
  ExceptionItem,
} from "./fusion-types";
import { agingDaysFor, bucketFor, stageOf } from "./fusion-utils";
import { getMockData } from "./fusion-mocks";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const USE_MOCKS =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_USE_MOCKS === "true";

// ---------------------------------------------------------------------------
// Shared fetch helper
// ---------------------------------------------------------------------------

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// Try the BFF; on any failure, fall back to mocks and log once.
let warnedOnceAboutFallback = false;
async function withFallback<T>(
  realCall: () => Promise<T>,
  mockCall: () => T | Promise<T>,
): Promise<T> {
  if (USE_MOCKS) return await mockCall();
  try {
    return await realCall();
  } catch (e) {
    if (!warnedOnceAboutFallback) {
      console.warn(
        "[fusion-service] BFF unavailable, falling back to mock data.",
        e,
      );
      warnedOnceAboutFallback = true;
    }
    return await mockCall();
  }
}

// ---------------------------------------------------------------------------
// Public API — same shape the UI already consumes
// ---------------------------------------------------------------------------

export async function getCurrentUser(): Promise<CurrentUser> {
  return withFallback(
    () => api<CurrentUser>("/api/me"),
    () => getMockData().user,
  );
}

export async function getReportees(managerId: number): Promise<Person[]> {
  return withFallback(
    () => api<Person[]>(`/api/reportees?managerId=${managerId}`),
    () => getMockData().reportees,
  );
}

export async function getRequisitions(
  filter: FilterState,
): Promise<RequisitionSummary[]> {
  return withFallback(
    () => {
      const qs = filterToQuery(filter);
      return api<RequisitionSummary[]>(`/api/requisitions?${qs}`);
    },
    () => applyMockFilter(filter),
  );
}

export async function getRequisitionDetail(
  requisitionHeaderId: number,
): Promise<RequisitionDetail> {
  return withFallback(
    () => api<RequisitionDetail>(`/api/requisitions/${requisitionHeaderId}`),
    () => getMockData().detail(requisitionHeaderId),
  );
}

export async function approveRequisition(
  requisitionHeaderId: number,
  comment?: string,
): Promise<void> {
  return withFallback(
    async () => {
      await api<{ ok: true }>(
        `/api/approvals/${requisitionHeaderId}/approve`,
        { method: "POST", body: JSON.stringify({ comment }) },
      );
    },
    () => getMockData().approve(requisitionHeaderId),
  );
}

export async function rejectRequisition(
  requisitionHeaderId: number,
  comment: string,
): Promise<void> {
  return withFallback(
    async () => {
      await api<{ ok: true }>(
        `/api/approvals/${requisitionHeaderId}/reject`,
        { method: "POST", body: JSON.stringify({ comment }) },
      );
    },
    () => getMockData().reject(requisitionHeaderId, comment),
  );
}

export async function reassignApproval(
  requisitionHeaderId: number,
  newApprover: string,
): Promise<void> {
  return withFallback(
    async () => {
      await api(`/api/approvals/${requisitionHeaderId}/reassign`, {
        method: "POST",
        body: JSON.stringify({ newApprover }),
      });
    },
    () => getMockData().reassign(requisitionHeaderId, newApprover),
  );
}

export async function getExceptions(
  filter: FilterState,
): Promise<ExceptionItem[]> {
  const rows = await getRequisitions(filter);
  const out: ExceptionItem[] = [];
  const NOW = new Date();

  const overdue = rows.filter(
    (r) => stageOf(r) !== "Complete" && new Date(r.needByDate) < NOW,
  );
  if (overdue.length)
    out.push({ id: "overdue", severity: "critical", title: "Past need-by date", count: overdue.length, filterPatch: {} });

  const stuck = rows.filter(
    (r) => agingDaysFor(r, NOW) >= 15 && stageOf(r) !== "Complete",
  );
  if (stuck.length)
    out.push({ id: "stuck", severity: "critical", title: "Stuck 15+ days", count: stuck.length, filterPatch: { agingBucket: "15+" } });

  const onHold = rows.filter((r) => r.onHold);
  if (onHold.length)
    out.push({ id: "hold", severity: "warning", title: "On hold", count: onHold.length, filterPatch: { onHoldOnly: true } });

  const rejected = rows.filter((r) => stageOf(r) === "NeedsFix");
  if (rejected.length)
    out.push({ id: "rejected", severity: "warning", title: "Rejected / Returned — needs requester action", count: rejected.length, filterPatch: { stage: "NeedsFix" } });

  const changeOrders = rows.filter((r) => r.po?.hasPendingChange);
  if (changeOrders.length)
    out.push({ id: "change-orders", severity: "info", title: "POs with pending change orders", count: changeOrders.length, filterPatch: {} });

  return out;
}

export async function getFilterOptions(): Promise<{
  businessUnits: string[];
  categories: string[];
  suppliers: string[];
}> {
  const rows = await getRequisitions({
    reporteeId: "all", stage: "all", businessUnit: "all", agingBucket: "all",
    category: "all", supplier: "all", minAmount: null, maxAmount: null,
    search: "", onHoldOnly: false,
  });
  return {
    businessUnits: Array.from(new Set(rows.map((r) => r.businessUnit))).sort(),
    categories: Array.from(new Set(rows.map((r) => r.topCategory))).sort(),
    suppliers: Array.from(
      new Set(rows.map((r) => r.po?.supplier.name).filter(Boolean) as string[]),
    ).sort(),
  };
}

const FUSION_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_FUSION_BASE ??
  (typeof window !== "undefined" && (window as Window & { FUSION_BASE?: string }).FUSION_BASE) ??
  "https://your-fusion-env.fa.oraclecloud.com";

export function buildRequisitionDeepLink(r: RequisitionSummary): string {
  return `${FUSION_BASE}/fscmUI/faces/FuseOverview?fndGlobalItemNodeId=itemNode_procurement_self_service_procurement&fndTaskItemNodeId=MSC_N_MANAGE_REQS&action=manage&requisitionHeaderId=${r.requisitionHeaderId}`;
}

export function buildPoDeepLink(poHeaderId: number): string {
  return `${FUSION_BASE}/fscmUI/faces/FuseOverview?fndGlobalItemNodeId=itemNode_procurement_purchase_orders&action=manage&poHeaderId=${poHeaderId}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filterToQuery(f: FilterState): string {
  const params = new URLSearchParams();
  if (f.reporteeId !== "all") params.set("reporteeId", String(f.reporteeId));
  if (f.stage !== "all") params.set("stage", f.stage);
  if (f.businessUnit !== "all") params.set("businessUnit", f.businessUnit);
  if (f.agingBucket !== "all") params.set("agingBucket", f.agingBucket);
  if (f.category !== "all") params.set("category", f.category);
  if (f.supplier !== "all") params.set("supplier", f.supplier);
  if (f.minAmount !== null) params.set("minAmount", String(f.minAmount));
  if (f.maxAmount !== null) params.set("maxAmount", String(f.maxAmount));
  if (f.search.trim()) params.set("search", f.search);
  if (f.onHoldOnly) params.set("onHoldOnly", "true");
  return params.toString();
}

function applyMockFilter(f: FilterState): RequisitionSummary[] {
  const rows = getMockData().requisitions;
  return rows.filter((r) => {
    if (f.reporteeId !== "all" && r.requester.personId !== f.reporteeId) return false;
    if (f.stage !== "all" && stageOf(r) !== f.stage) return false;
    if (f.businessUnit !== "all" && r.businessUnit !== f.businessUnit) return false;
    if (f.agingBucket !== "all" && bucketFor(agingDaysFor(r)) !== f.agingBucket) return false;
    if (f.category !== "all" && r.topCategory !== f.category) return false;
    if (f.supplier !== "all" && (!r.po || r.po.supplier.name !== f.supplier)) return false;
    if (f.minAmount !== null && r.amountInLedgerCurrency.value < f.minAmount) return false;
    if (f.maxAmount !== null && r.amountInLedgerCurrency.value > f.maxAmount) return false;
    if (f.onHoldOnly && !r.onHold) return false;
    if (f.search.trim()) {
      const q = f.search.toLowerCase();
      const h = [r.requisition, r.description, r.requester.name, r.po?.purchaseOrder, r.po?.supplier.name]
        .filter(Boolean).join(" ").toLowerCase();
      if (!h.includes(q)) return false;
    }
    return true;
  });
}
