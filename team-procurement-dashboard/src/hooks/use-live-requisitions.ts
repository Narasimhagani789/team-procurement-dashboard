import { useCallback, useEffect, useRef, useState } from "react";
import type { FilterState, RequisitionSummary } from "../lib/fusion-types";
import { getRequisitions } from "../lib/fusion-service";

export interface LiveState {
  data: RequisitionSummary[];
  isLoading: boolean;
  isFetching: boolean;    // true during refetch (after first load)
  error: Error | null;
  lastUpdated: Date | null;
  changedIds: Set<number>; // ids of rows that changed vs previous poll
}

export interface LiveControls {
  isLive: boolean;
  setLive: (v: boolean) => void;
  intervalMs: number;
  setIntervalMs: (ms: number) => void;
  refresh: () => void;
}

/**
 * useLiveRequisitions
 *
 * v1 (this file): polls getRequisitions() at `intervalMs` cadence. Diffs
 * each result against the previous snapshot and returns a set of changed
 * requisitionHeaderIds so the UI can flash them.
 *
 * v2 (swap): replace the polling useEffect with Server-Sent Events from
 * your BFF. Sketch:
 *
 *   useEffect(() => {
 *     const es = new EventSource("/api/fusion/requisitions/stream?...");
 *     es.addEventListener("snapshot", (e) => setData(JSON.parse(e.data)));
 *     es.addEventListener("update",   (e) => patchRow(JSON.parse(e.data)));
 *     return () => es.close();
 *   }, [filter]);
 *
 * The BFF subscribes to Fusion Business Events (or polls REST on your
 * behalf) and fans out a single stream per-user — so clients aren't
 * hammering Fusion directly.
 */
export function useLiveRequisitions(
  filter: FilterState,
  initialIntervalMs = 30_000,
): [LiveState, LiveControls] {
  const [data, setData] = useState<RequisitionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [changedIds, setChangedIds] = useState<Set<number>>(new Set());
  const [isLive, setIsLive] = useState(true);
  const [intervalMs, setIntervalMs] = useState(initialIntervalMs);

  const previousRef = useRef<Map<number, string>>(new Map());
  const firstLoadRef = useRef(true);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const fetchOnce = useCallback(async () => {
    if (firstLoadRef.current) {
      setIsLoading(true);
    } else {
      setIsFetching(true);
    }
    try {
      const rows = await getRequisitions(filterRef.current);

      // Diff against previous snapshot
      const next = new Map<number, string>();
      const changed = new Set<number>();
      for (const r of rows) {
        const signature = rowSignature(r);
        next.set(r.requisitionHeaderId, signature);
        const prev = previousRef.current.get(r.requisitionHeaderId);
        if (prev !== undefined && prev !== signature) {
          changed.add(r.requisitionHeaderId);
        }
      }
      previousRef.current = next;

      setData(rows);
      setError(null);
      setLastUpdated(new Date());
      if (!firstLoadRef.current) {
        setChangedIds(changed);
        // Clear highlight after 4s so the flash is momentary
        window.setTimeout(() => setChangedIds(new Set()), 4000);
      }
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      firstLoadRef.current = false;
      setIsLoading(false);
      setIsFetching(false);
    }
  }, []);

  // Initial + on-filter-change
  useEffect(() => {
    firstLoadRef.current = true;
    previousRef.current = new Map();
    void fetchOnce();
  }, [filter, fetchOnce]);

  // Polling loop
  useEffect(() => {
    if (!isLive) return;
    const id = window.setInterval(() => {
      void fetchOnce();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [isLive, intervalMs, fetchOnce]);

  const refresh = useCallback(() => {
    void fetchOnce();
  }, [fetchOnce]);

  return [
    { data, isLoading, isFetching, error, lastUpdated, changedIds },
    { isLive, setLive: setIsLive, intervalMs, setIntervalMs, refresh },
  ];
}

// A cheap way to detect row changes without deep-equal: stringify the fields
// we care about visually. Swap for a real hash if payloads grow.
function rowSignature(r: RequisitionSummary): string {
  return JSON.stringify({
    s: r.documentStatus,
    h: r.onHold,
    a: r.currentActor,
    p: r.po
      ? {
          n: r.po.purchaseOrder,
          s: r.po.status,
          r: r.po.revision,
          c: r.po.hasPendingChange,
        }
      : null,
    r: r.receipt
      ? {
          o: r.receipt.orderedQty,
          rc: r.receipt.receivedQty,
          h: r.receipt.hasHold,
        }
      : null,
  });
}
