/**
 * Gaurav's Team Procurement — Fusion-backed dashboard template.
 *
 * Architecture:
 *   @/lib/fusion-types     — TS interfaces that mirror Fusion REST shapes
 *   @/lib/fusion-utils     — pure helpers (aging, stage derivation, CSV)
 *   @/lib/fusion-service   — THE SWAP POINT: mock functions today, fetch() to BFF tomorrow
 *   @/hooks/use-live-requisitions — polling + diff; swap for SSE when BFF is ready
 *
 * Real-time: polling every 30s by default. The indicator pulses while live,
 * changed rows flash amber for 4s, and manual refresh is always available.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import type * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  AlertTriangle,
  Briefcase,
  CheckCircle,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Filter as FilterIcon,
  Package,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Save,
  Search,
  Truck,
  Users,
  X,
} from "lucide-react";

import type {
  CurrentUser,
  DashboardStage,
  FilterState,
  Person,
  RequisitionDetail,
  RequisitionSummary,
  SavedView,
} from "@/lib/fusion-types";
import { EMPTY_FILTER } from "@/lib/fusion-types";
import {
  AGING_BUCKETS,
  AGING_BUCKET_COLOR,
  STAGE_META,
  STAGE_ORDER,
  agingDaysFor,
  bucketFor,
  downloadCsv,
  formatDate,
  formatMoney,
  formatRelative,
  receiptProgress,
  stageOf,
  toCsv,
} from "@/lib/fusion-utils";
import {
  approveRequisition,
  buildPoDeepLink,
  buildRequisitionDeepLink,
  getCurrentUser,
  getExceptions,
  getFilterOptions,
  getReportees,
  getRequisitionDetail,
  rejectRequisition,
} from "@/lib/fusion-service";
import { useLiveRequisitions } from "@/hooks/use-live-requisitions";

// ---- Saved views persistence (localStorage is appropriate in a real app) ----

const SAVED_VIEWS_KEY = "procurement-dashboard:saved-views:v1";

function loadSavedViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_VIEWS_KEY);
    return raw ? (JSON.parse(raw) as SavedView[]) : [];
  } catch {
    return [];
  }
}

function persistSavedViews(views: SavedView[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
  } catch {
    /* quota or disabled — ignore */
  }
}

// ---- Main component ----

export default function Dashboard() {
  // Reference data
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [reportees, setReportees] = useState<Person[]>([]);
  const [options, setOptions] = useState<{
    businessUnits: string[];
    categories: string[];
    suppliers: string[];
  }>({ businessUnits: [], categories: [], suppliers: [] });

  // Filter state
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Live data
  const [liveState, liveControls] = useLiveRequisitions(filter, 30_000);
  const { data: rows, isLoading, isFetching, lastUpdated, changedIds, error } =
    liveState;

  // Exceptions (computed server-side in real life)
  const [exceptions, setExceptions] = useState<
    Awaited<ReturnType<typeof getExceptions>>
  >([]);

  // Saved views
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);

  // Drawer (detail panel)
  const [drawerReqId, setDrawerReqId] = useState<number | null>(null);

  // ---- Boot ----
  useEffect(() => {
    void getCurrentUser().then(setUser);
    void getFilterOptions().then(setOptions);
    setSavedViews(loadSavedViews());
  }, []);

  useEffect(() => {
    if (!user) return;
    void getReportees(user.personId).then(setReportees);
  }, [user]);

  useEffect(() => {
    void getExceptions(filter).then(setExceptions);
  }, [filter, rows]);

  // ---- Derived ----

  const counts = useMemo(() => {
    const base: Record<DashboardStage, number> = {
      Pending: 0,
      NeedsFix: 0,
      Buyer: 0,
      Receiving: 0,
      Complete: 0,
    };
    for (const r of rows) base[stageOf(r)] += 1;
    return base;
  }, [rows]);

  // Stage × aging matrix for the aging bar
  const agingMatrix = useMemo(() => {
    const matrix: Record<DashboardStage, Record<string, number>> = {
      Pending: { "0-3": 0, "4-7": 0, "8-14": 0, "15+": 0 },
      NeedsFix: { "0-3": 0, "4-7": 0, "8-14": 0, "15+": 0 },
      Buyer: { "0-3": 0, "4-7": 0, "8-14": 0, "15+": 0 },
      Receiving: { "0-3": 0, "4-7": 0, "8-14": 0, "15+": 0 },
      Complete: { "0-3": 0, "4-7": 0, "8-14": 0, "15+": 0 },
    };
    for (const r of rows) {
      const s = stageOf(r);
      const b = bucketFor(agingDaysFor(r));
      matrix[s][b] += 1;
    }
    return matrix;
  }, [rows]);

  const pendingApprovalAmountLedger = useMemo(() => {
    return rows
      .filter((r) => stageOf(r) === "Pending")
      .reduce((sum, r) => sum + r.amountInLedgerCurrency.value, 0);
  }, [rows]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filter.reporteeId !== "all") n++;
    if (filter.stage !== "all") n++;
    if (filter.businessUnit !== "all") n++;
    if (filter.agingBucket !== "all") n++;
    if (filter.category !== "all") n++;
    if (filter.supplier !== "all") n++;
    if (filter.minAmount !== null || filter.maxAmount !== null) n++;
    if (filter.search.trim()) n++;
    if (filter.onHoldOnly) n++;
    return n;
  }, [filter]);

  // ---- Handlers ----

  const patchFilter = useCallback((patch: Partial<FilterState>) => {
    setFilter((f) => ({ ...f, ...patch }));
  }, []);

  const resetFilter = useCallback(() => setFilter(EMPTY_FILTER), []);

  const handleExportCsv = useCallback(() => {
    const csv = toCsv(rows);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    downloadCsv(`requisitions-${stamp}.csv`, csv);
  }, [rows]);

  const handleSaveView = useCallback(() => {
    const name = window.prompt("Name this view");
    if (!name || !name.trim()) return;
    const view: SavedView = {
      id: String(Date.now()),
      name: name.trim(),
      filter,
      createdAt: new Date().toISOString(),
    };
    const next = [...savedViews, view];
    setSavedViews(next);
    persistSavedViews(next);
  }, [filter, savedViews]);

  const applySavedView = useCallback((v: SavedView) => {
    setFilter(v.filter);
  }, []);

  const deleteSavedView = useCallback(
    (id: string) => {
      const next = savedViews.filter((v) => v.id !== id);
      setSavedViews(next);
      persistSavedViews(next);
    },
    [savedViews],
  );

  // ---- Render ----

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-7xl">
          <SkeletonBar />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <DemoBanner />

        <HeaderStrip
          user={user}
          lastUpdated={lastUpdated}
          isLive={liveControls.isLive}
          isFetching={isFetching}
          intervalMs={liveControls.intervalMs}
          onToggleLive={() => liveControls.setLive(!liveControls.isLive)}
          onRefresh={liveControls.refresh}
          onChangeInterval={liveControls.setIntervalMs}
        />

        <FilterBar
          filter={filter}
          reportees={reportees}
          options={options}
          ledgerCurrency={user.ledgerCurrency}
          showAdvanced={showAdvanced}
          activeCount={activeFilterCount}
          savedViews={savedViews}
          onToggleAdvanced={() => setShowAdvanced((v) => !v)}
          onPatch={patchFilter}
          onReset={resetFilter}
          onSaveView={handleSaveView}
          onApplySavedView={applySavedView}
          onDeleteSavedView={deleteSavedView}
          onExportCsv={handleExportCsv}
        />

        {exceptions.length > 0 && (
          <ExceptionStrip
            items={exceptions}
            onClick={(patch) => patchFilter(patch)}
          />
        )}

        <StageTiles
          counts={counts}
          total={rows.length}
          activeStage={filter.stage}
          pendingApprovalAmount={pendingApprovalAmountLedger}
          ledgerCurrency={user.ledgerCurrency}
          onPick={(stage) =>
            patchFilter({ stage: filter.stage === stage ? "all" : stage })
          }
        />

        <AgingBoard
          matrix={agingMatrix}
          activeStage={filter.stage}
          activeBucket={filter.agingBucket}
          onCellClick={(stage, bucket) =>
            patchFilter({
              stage: filter.stage === stage ? "all" : stage,
              agingBucket: filter.agingBucket === bucket ? "all" : bucket,
            })
          }
        />

        {error ? (
          <ErrorCard error={error} onRetry={liveControls.refresh} />
        ) : isLoading ? (
          <SkeletonRows />
        ) : rows.length === 0 ? (
          <EmptyState onReset={resetFilter} />
        ) : (
          <RequisitionList
            rows={rows}
            changedIds={changedIds}
            currentUserName={user.name}
            onOpen={(id) => setDrawerReqId(id)}
          />
        )}
      </div>

      {drawerReqId !== null && (
        <RequisitionDrawer
          requisitionHeaderId={drawerReqId}
          currentUserName={user.name}
          onClose={() => setDrawerReqId(null)}
          onMutated={liveControls.refresh}
        />
      )}
    </div>
  );
}

// ============================================================================
// Header strip — user context, live indicator, refresh, interval
// ============================================================================

function HeaderStrip(props: {
  user: CurrentUser;
  lastUpdated: Date | null;
  isLive: boolean;
  isFetching: boolean;
  intervalMs: number;
  onToggleLive: () => void;
  onRefresh: () => void;
  onChangeInterval: (ms: number) => void;
}) {
  const { user, lastUpdated, isLive, isFetching, intervalMs } = props;
  const [, tick] = useState(0);

  // Retick every 10s so "12s ago" keeps ticking even when no new data
  useEffect(() => {
    const id = window.setInterval(() => tick((t) => t + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {user.name}&apos;s Team Procurement
          </h1>
          <span className="text-xs text-slate-400">
            {user.primaryBU} · {user.ledger}
          </span>
        </div>
        <p className="text-sm text-slate-500">
          Approvals, POs, receipts — everything reporting up to you.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${
              isLive ? "bg-emerald-500" : "bg-slate-400"
            }`}
          >
            {isLive && (
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-60" />
            )}
          </span>
          <span>
            {lastUpdated ? `Updated ${formatRelative(lastUpdated.toISOString())}` : "Connecting…"}
          </span>
          {isFetching && (
            <RefreshCw className="h-3 w-3 animate-spin text-slate-400" />
          )}
        </div>

        <select
          value={intervalMs}
          onChange={(e) => props.onChangeInterval(Number(e.target.value))}
          className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700"
          aria-label="Poll interval"
        >
          <option value={10_000}>Every 10s</option>
          <option value={30_000}>Every 30s</option>
          <option value={60_000}>Every 1m</option>
          <option value={300_000}>Every 5m</option>
        </select>

        <Button
          size="sm"
          variant="outline"
          onClick={props.onToggleLive}
          className="gap-1.5"
        >
          {isLive ? (
            <>
              <PauseCircle className="h-4 w-4" />
              Pause
            </>
          ) : (
            <>
              <PlayCircle className="h-4 w-4" />
              Go live
            </>
          )}
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={props.onRefresh}
          className="gap-1.5"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Filter bar — reportee + search always visible, advanced panel collapsible
// ============================================================================

function FilterBar(props: {
  filter: FilterState;
  reportees: Person[];
  options: { businessUnits: string[]; categories: string[]; suppliers: string[] };
  ledgerCurrency: string;
  showAdvanced: boolean;
  activeCount: number;
  savedViews: SavedView[];
  onToggleAdvanced: () => void;
  onPatch: (p: Partial<FilterState>) => void;
  onReset: () => void;
  onSaveView: () => void;
  onApplySavedView: (v: SavedView) => void;
  onDeleteSavedView: (id: string) => void;
  onExportCsv: () => void;
}) {
  const {
    filter,
    reportees,
    options,
    ledgerCurrency,
    showAdvanced,
    activeCount,
    savedViews,
  } = props;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <Users className="h-4 w-4" />
            Reportee
          </div>

          <select
            value={filter.reporteeId}
            onChange={(e) =>
              props.onPatch({
                reporteeId:
                  e.target.value === "all" ? "all" : Number(e.target.value),
              })
            }
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="all">All reportees</option>
            {reportees.map((p) => (
              <option key={p.personId} value={p.personId}>
                {p.name}
              </option>
            ))}
          </select>

          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={filter.search}
              onChange={(e) => props.onPatch({ search: e.target.value })}
              placeholder="Search req number, description, PO, supplier…"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400"
            />
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={props.onToggleAdvanced}
            className="gap-1.5"
          >
            <FilterIcon className="h-4 w-4" />
            {showAdvanced ? "Hide filters" : "More filters"}
            {activeCount > 0 && (
              <span className="rounded-full bg-slate-900 px-1.5 py-0.5 text-xs text-white">
                {activeCount}
              </span>
            )}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={props.onSaveView}
            className="gap-1.5"
          >
            <Save className="h-4 w-4" />
            Save view
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={props.onExportCsv}
            className="gap-1.5"
          >
            <Download className="h-4 w-4" />
            CSV
          </Button>
        </div>

        {savedViews.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">Saved views:</span>
            {savedViews.map((v) => (
              <span
                key={v.id}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white py-0.5 pl-3 pr-1 text-xs text-slate-700"
              >
                <button
                  onClick={() => props.onApplySavedView(v)}
                  className="hover:text-slate-900"
                >
                  {v.name}
                </button>
                <button
                  onClick={() => props.onDeleteSavedView(v.id)}
                  className="rounded-full p-0.5 hover:bg-slate-100"
                  aria-label={`Delete view ${v.name}`}
                >
                  <X className="h-3 w-3 text-slate-400" />
                </button>
              </span>
            ))}
          </div>
        )}

        {showAdvanced && (
          <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 md:grid-cols-2 lg:grid-cols-4">
            <LabeledSelect
              label="Business Unit"
              value={filter.businessUnit}
              onChange={(v) => props.onPatch({ businessUnit: v })}
              options={["all", ...options.businessUnits]}
              displayAll="All BUs"
            />
            <LabeledSelect
              label="Category"
              value={filter.category}
              onChange={(v) => props.onPatch({ category: v })}
              options={["all", ...options.categories]}
              displayAll="All categories"
            />
            <LabeledSelect
              label="Supplier"
              value={filter.supplier}
              onChange={(v) => props.onPatch({ supplier: v })}
              options={["all", ...options.suppliers]}
              displayAll="All suppliers"
            />
            <LabeledSelect
              label="Aging"
              value={filter.agingBucket}
              onChange={(v) =>
                props.onPatch({ agingBucket: v as FilterState["agingBucket"] })
              }
              options={["all", ...AGING_BUCKETS]}
              displayAll="Any age"
              displayValue={(v) => (v === "all" ? "Any age" : `${v} days`)}
            />

            <div className="md:col-span-2">
              <label className="block text-xs text-slate-500">
                Amount (in {ledgerCurrency})
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  placeholder="Min"
                  value={filter.minAmount ?? ""}
                  onChange={(e) =>
                    props.onPatch({
                      minAmount: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                />
                <span className="text-slate-400">–</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={filter.maxAmount ?? ""}
                  onChange={(e) =>
                    props.onPatch({
                      maxAmount: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={filter.onHoldOnly}
                onChange={(e) => props.onPatch({ onHoldOnly: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              On-hold items only
            </label>

            <div className="flex items-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={props.onReset}
                disabled={activeCount === 0}
                className="gap-1.5 text-slate-600"
              >
                <X className="h-4 w-4" />
                Clear all
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LabeledSelect(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  displayAll: string;
  displayValue?: (v: string) => string;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-500">{props.label}</label>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
      >
        {props.options.map((o) => (
          <option key={o} value={o}>
            {o === "all"
              ? props.displayAll
              : props.displayValue
                ? props.displayValue(o)
                : o}
          </option>
        ))}
      </select>
    </div>
  );
}

// ============================================================================
// Exception strip — rule-based "pay attention" items, clickable to filter
// ============================================================================

function ExceptionStrip(props: {
  items: Awaited<ReturnType<typeof getExceptions>>;
  onClick: (patch: Partial<FilterState>) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {props.items.map((it) => {
        const tone =
          it.severity === "critical"
            ? "border-rose-200 bg-rose-50 text-rose-900"
            : it.severity === "warning"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-slate-200 bg-white text-slate-700";
        const iconTone =
          it.severity === "critical"
            ? "text-rose-600"
            : it.severity === "warning"
              ? "text-amber-600"
              : "text-slate-500";
        return (
          <button
            key={it.id}
            onClick={() => props.onClick(it.filterPatch)}
            className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-shadow hover:shadow-sm ${tone}`}
          >
            <AlertTriangle className={`h-4 w-4 ${iconTone}`} />
            <div className="flex-1">
              <div className="text-xs">{it.title}</div>
              <div className="text-lg font-semibold">{it.count}</div>
            </div>
            <ChevronRight className="h-4 w-4 opacity-60" />
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Stage tiles — replaces old KPI grid. "All" tile is gone; pending-$ banner
// is folded in as the tile caption.
// ============================================================================

const STAGE_ICON: Record<DashboardStage, typeof Clock> = {
  Pending: Clock,
  NeedsFix: AlertCircle,
  Buyer: Briefcase,
  Receiving: Truck,
  Complete: CheckCircle,
};

function StageTiles(props: {
  counts: Record<DashboardStage, number>;
  total: number;
  activeStage: FilterState["stage"];
  pendingApprovalAmount: number;
  ledgerCurrency: string;
  onPick: (s: DashboardStage) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {STAGE_ORDER.map((s) => {
        const Icon = STAGE_ICON[s];
        const meta = STAGE_META[s];
        const count = props.counts[s];
        const isActive = props.activeStage === s;
        const caption =
          s === "Pending" && props.pendingApprovalAmount > 0
            ? `${formatMoney(props.pendingApprovalAmount, props.ledgerCurrency)} waiting`
            : s === "NeedsFix" && count > 0
              ? "Requires requester action"
              : s === "Buyer" && count > 0
                ? "With procurement"
                : s === "Receiving" && count > 0
                  ? "Goods in transit"
                  : s === "Complete"
                    ? "Delivered & closed"
                    : "All clear";
        return (
          <button
            key={s}
            onClick={() => props.onPick(s)}
            aria-pressed={isActive}
            className={`rounded-xl border bg-white p-4 text-left transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${
              isActive
                ? "border-slate-900 ring-2 ring-slate-900"
                : "border-slate-200"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500">{meta.label}</div>
              <Icon className="h-4 w-4" style={{ color: meta.color }} />
            </div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{count}</div>
            <div className="mt-1 truncate text-xs text-slate-400">{caption}</div>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Aging board — stage × aging-bucket grid. Click a cell to filter.
// ============================================================================

function AgingBoard(props: {
  matrix: Record<DashboardStage, Record<string, number>>;
  activeStage: FilterState["stage"];
  activeBucket: FilterState["agingBucket"];
  onCellClick: (stage: DashboardStage, bucket: "0-3" | "4-7" | "8-14" | "15+") => void;
}) {
  const maxInRow = (s: DashboardStage) =>
    Math.max(1, ...AGING_BUCKETS.map((b) => props.matrix[s][b]));

  const totalPerStage = (s: DashboardStage) =>
    AGING_BUCKETS.reduce((sum, b) => sum + props.matrix[s][b], 0);

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="font-medium text-slate-900">Where time is piling up</div>
            <div className="text-sm text-slate-500">
              Requisition count by stage and days-at-current-stage. Click any cell
              to drill in.
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {AGING_BUCKETS.map((b) => (
              <span key={b} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: AGING_BUCKET_COLOR[b] }}
                />
                {b} days
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {STAGE_ORDER.map((s) => {
            const total = totalPerStage(s);
            const max = maxInRow(s);
            return (
              <div key={s} className="grid grid-cols-[140px_1fr_40px] items-center gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: STAGE_META[s].color }}
                  />
                  <span className="text-slate-700">{STAGE_META[s].label}</span>
                </div>
                <div className="flex items-center gap-1">
                  {AGING_BUCKETS.map((b) => {
                    const count = props.matrix[s][b];
                    const width = count === 0 ? 4 : (count / max) * 100;
                    const isActive =
                      props.activeStage === s && props.activeBucket === b;
                    return (
                      <button
                        key={b}
                        onClick={() => props.onCellClick(s, b)}
                        className={`relative h-7 rounded-md transition-opacity ${
                          count === 0 ? "opacity-30" : "hover:opacity-80"
                        } ${isActive ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
                        style={{
                          backgroundColor: AGING_BUCKET_COLOR[b],
                          flexBasis: `${width}%`,
                          minWidth: count === 0 ? 20 : 28,
                        }}
                        title={`${STAGE_META[s].label} · ${b} days · ${count}`}
                      >
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-slate-900">
                          {count > 0 ? count : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="text-right text-sm font-semibold text-slate-900">
                  {total}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Requisition list + row
// ============================================================================

function RequisitionList(props: {
  rows: RequisitionSummary[];
  changedIds: Set<number>;
  currentUserName: string;
  onOpen: (id: number) => void;
}) {
  // Sort: onHold + overdue first, then by aging desc
  const sorted = useMemo(() => {
    const withScore = props.rows.map((r) => {
      const aging = agingDaysFor(r);
      const isOverdue =
        stageOf(r) !== "Complete" &&
        new Date(r.needByDate).getTime() < Date.now();
      let score = aging;
      if (r.onHold) score += 100;
      if (isOverdue) score += 50;
      return { r, score };
    });
    return withScore.sort((a, b) => b.score - a.score).map((x) => x.r);
  }, [props.rows]);

  return (
    <div className="space-y-3">
      {sorted.map((r) => (
        <RequisitionRow
          key={r.requisitionHeaderId}
          r={r}
          wasChanged={props.changedIds.has(r.requisitionHeaderId)}
          currentUserName={props.currentUserName}
          onOpen={() => props.onOpen(r.requisitionHeaderId)}
        />
      ))}
    </div>
  );
}

function RequisitionRow(props: {
  r: RequisitionSummary;
  wasChanged: boolean;
  currentUserName: string;
  onOpen: () => void;
}) {
  const { r, wasChanged } = props;
  const stage = stageOf(r);
  const meta = STAGE_META[stage];
  const aging = agingDaysFor(r);
  const bucket = bucketFor(aging);
  const daysToNeedBy = Math.floor(
    (new Date(r.needByDate).getTime() - Date.now()) / 86400000,
  );
  const isOverdue = stage !== "Complete" && daysToNeedBy < 0;
  const isTight = !isOverdue && stage !== "Complete" && daysToNeedBy <= 2;
  const progress = receiptProgress(r);
  const isPendingOnCurrentUser =
    r.currentActor.type === "Approver" &&
    r.currentActor.name === props.currentUserName;

  return (
    <Card
      className={`transition-all ${
        wasChanged ? "ring-2 ring-amber-400" : "hover:shadow-md"
      }`}
    >
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-900">
                {r.requisition} · {r.description}
              </span>

              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${meta.badge}`}
              >
                {meta.label}
              </span>

              {r.onHold && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                  On hold
                </span>
              )}

              {isOverdue && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800 ring-1 ring-inset ring-rose-200">
                  <AlertTriangle className="h-3 w-3" />
                  Overdue
                </span>
              )}

              {r.po?.hasPendingChange && (
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 ring-1 ring-inset ring-violet-200">
                  Change order pending
                </span>
              )}

              {isPendingOnCurrentUser && (
                <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">
                  You&apos;re the approver
                </span>
              )}
            </div>

            <div className="text-sm text-slate-500">
              Requester: {r.requester.name} · {r.businessUnit} · Category:{" "}
              {r.topCategory}
            </div>

            <div className="text-xs text-slate-500">
              With <span className="font-medium text-slate-700">{r.currentActor.name}</span>
              {r.currentActor.roleLabel ? ` (${r.currentActor.roleLabel})` : ""} ·{" "}
              <span
                className={
                  bucket === "15+"
                    ? "font-medium text-rose-600"
                    : bucket === "8-14"
                      ? "font-medium text-orange-600"
                      : bucket === "4-7"
                        ? "font-medium text-amber-600"
                        : ""
                }
              >
                {aging} day{aging === 1 ? "" : "s"}
              </span>{" "}
              at current stage
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            <a
              href={buildRequisitionDeepLink(r)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in Fusion
            </a>
            <Button size="sm" variant="outline" onClick={props.onOpen} className="gap-1">
              Details
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          <Tile label="Amount">
            <span>{formatMoney(r.amount.value, r.amount.currency)}</span>
            {r.amount.currency !== r.amountInLedgerCurrency.currency && (
              <span className="block text-xs text-slate-400">
                ≈{" "}
                {formatMoney(
                  r.amountInLedgerCurrency.value,
                  r.amountInLedgerCurrency.currency,
                )}
              </span>
            )}
          </Tile>
          <Tile label="Created">{formatDate(r.creationDate)}</Tile>
          <Tile
            label="Need By"
            tone={isOverdue ? "rose" : isTight ? "amber" : "neutral"}
          >
            {formatDate(r.needByDate)}
            {isOverdue && (
              <span className="block text-xs font-medium text-rose-700">
                {Math.abs(daysToNeedBy)}d overdue
              </span>
            )}
            {isTight && (
              <span className="block text-xs font-medium text-amber-700">
                in {daysToNeedBy}d
              </span>
            )}
          </Tile>
          <Tile label="Lines">{r.lineCount}</Tile>
          <Tile label="PO Number">
            {r.po ? (
              <a
                href={buildPoDeepLink(r.po.poHeaderId)}
                target="_blank"
                rel="noreferrer"
                className="text-slate-900 underline-offset-2 hover:underline"
              >
                {r.po.purchaseOrder}
                {r.po.revision > 0 ? ` (rev ${r.po.revision})` : ""}
              </a>
            ) : (
              "—"
            )}
          </Tile>
          <Tile label="Supplier">{r.po?.supplier.name ?? "—"}</Tile>
          <Tile label="Funds">{r.fundsStatus ?? "—"}</Tile>
          <Tile label="Progress">
            {r.receipt ? (
              <>
                <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-2 rounded-full ${
                      r.receipt.hasHold ? "bg-amber-500" : "bg-slate-900"
                    }`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                  <Package className="h-3 w-3" />
                  {r.receipt.receivedQty}/{r.receipt.orderedQty} {r.receipt.uom}
                </div>
              </>
            ) : (
              "—"
            )}
          </Tile>
        </div>
      </CardContent>
    </Card>
  );
}

function Tile(props: {
  label: string;
  children: React.ReactNode;
  tone?: "neutral" | "rose" | "amber";
}) {
  const tone =
    props.tone === "rose"
      ? "bg-rose-50 ring-1 ring-rose-200"
      : props.tone === "amber"
        ? "bg-amber-50 ring-1 ring-amber-200"
        : "bg-slate-50";
  return (
    <div className={`rounded-xl p-3 ${tone}`}>
      <div className="text-xs text-slate-400">{props.label}</div>
      <div className="text-sm font-medium text-slate-900">{props.children}</div>
    </div>
  );
}

// ============================================================================
// Drawer — lazy-loads full detail; supports approve / reject inline
// ============================================================================

type DrawerTab = "approval" | "receipts" | "changes" | "attachments" | "activity";

function RequisitionDrawer(props: {
  requisitionHeaderId: number;
  currentUserName: string;
  onClose: () => void;
  onMutated: () => void;
}) {
  const [detail, setDetail] = useState<RequisitionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tab, setTab] = useState<DrawerTab>("approval");
  const [acting, setActing] = useState(false);
  const [comment, setComment] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getRequisitionDetail(props.requisitionHeaderId)
      .then((d) => {
        if (alive) {
          setDetail(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [props.requisitionHeaderId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  const handleApprove = async () => {
    if (!detail) return;
    setActing(true);
    try {
      await approveRequisition(detail.requisitionHeaderId, comment);
      props.onMutated();
      props.onClose();
    } finally {
      setActing(false);
    }
  };

  const handleReject = async () => {
    if (!detail) return;
    if (!comment.trim()) {
      window.alert("Please add a comment explaining the rejection.");
      return;
    }
    setActing(true);
    try {
      await rejectRequisition(detail.requisitionHeaderId, comment);
      props.onMutated();
      props.onClose();
    } finally {
      setActing(false);
    }
  };

  const canAct =
    detail &&
    detail.documentStatus === "Pending Approval" &&
    detail.currentActor.type === "Approver" &&
    detail.currentActor.name === props.currentUserName;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div
        className="flex-1 bg-slate-900/40"
        onClick={props.onClose}
        aria-hidden="true"
      />
      <div className="flex w-full max-w-2xl flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 p-4">
          <div className="min-w-0">
            {detail ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900">
                    {detail.requisition}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                      STAGE_META[stageOf(detail)].badge
                    }`}
                  >
                    {STAGE_META[stageOf(detail)].label}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-sm text-slate-600">
                  {detail.description}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {detail.businessUnit} ·{" "}
                  {formatMoney(detail.amount.value, detail.amount.currency)} ·
                  Need by {formatDate(detail.needByDate)}
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-500">Loading…</div>
            )}
          </div>
          <button
            onClick={props.onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error ? (
          <div className="p-6 text-sm text-rose-700">
            Couldn&apos;t load details. {error.message}
          </div>
        ) : loading || !detail ? (
          <div className="space-y-3 p-4">
            <SkeletonBar />
            <SkeletonBar />
            <SkeletonBar />
          </div>
        ) : (
          <>
            <div className="flex border-b border-slate-200 px-4">
              {(
                [
                  ["approval", "Approval"],
                  ["receipts", "Receipts"],
                  ["changes", "Changes"],
                  ["attachments", "Files"],
                  ["activity", "Activity"],
                ] as Array<[DrawerTab, string]>
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`border-b-2 px-3 py-2 text-sm transition-colors ${
                    tab === k
                      ? "border-slate-900 text-slate-900"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {tab === "approval" && <ApprovalTab detail={detail} />}
              {tab === "receipts" && <ReceiptsTab detail={detail} />}
              {tab === "changes" && <ChangesTab detail={detail} />}
              {tab === "attachments" && <AttachmentsTab detail={detail} />}
              {tab === "activity" && <ActivityTab detail={detail} />}
            </div>

            <div className="border-t border-slate-200 p-4">
              {canAct ? (
                <div className="space-y-2">
                  <label className="block text-xs text-slate-500">
                    Comment {canAct ? "(required for reject)" : ""}
                  </label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-700"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <a
                      href={buildRequisitionDeepLink(detail)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open in Fusion
                    </a>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleReject}
                        disabled={acting}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleApprove}
                        disabled={acting}
                        className="bg-slate-900 text-white hover:bg-slate-800"
                      >
                        Approve
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-500">
                    {detail.documentStatus !== "Pending Approval"
                      ? "No pending action for you on this item."
                      : "This item is waiting with someone else."}
                  </div>
                  <a
                    href={buildRequisitionDeepLink(detail)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open in Fusion
                  </a>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ApprovalTab({ detail }: { detail: RequisitionDetail }) {
  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-wide text-slate-400">
        Approval chain
      </div>
      {detail.approvalChain.map((step) => (
        <div
          key={step.stepNumber}
          className="flex items-start gap-3 rounded-lg border border-slate-200 p-3"
        >
          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-700">
            {step.stepNumber}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-900">
                {step.approver.name}
              </span>
              <span className="text-xs text-slate-500">{step.role}</span>
            </div>
            {step.comments && (
              <div className="mt-1 text-sm text-slate-600">{step.comments}</div>
            )}
            {step.actionDate && (
              <div className="mt-1 text-xs text-slate-400">
                {formatDate(step.actionDate)}
              </div>
            )}
          </div>
          <StepBadge status={step.status} />
        </div>
      ))}
    </div>
  );
}

function StepBadge({ status }: { status: "Pending" | "Approved" | "Rejected" | "Skipped" }) {
  const cls =
    status === "Approved"
      ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
      : status === "Rejected"
        ? "bg-rose-100 text-rose-800 ring-rose-200"
        : status === "Pending"
          ? "bg-amber-100 text-amber-800 ring-amber-200"
          : "bg-slate-100 text-slate-600 ring-slate-200";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      {status}
    </span>
  );
}

function ReceiptsTab({ detail }: { detail: RequisitionDetail }) {
  if (!detail.receipt) {
    return <EmptyTab text="No receipts yet for this requisition." />;
  }
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-slate-50 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Ordered</span>
          <span className="font-medium">
            {detail.receipt.orderedQty} {detail.receipt.uom}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Received</span>
          <span className="font-medium">
            {detail.receipt.receivedQty} {detail.receipt.uom}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Accepted</span>
          <span className="font-medium">
            {detail.receipt.acceptedQty} {detail.receipt.uom}
          </span>
        </div>
        {detail.receipt.returnedQty > 0 && (
          <div className="flex justify-between">
            <span className="text-slate-500">Returned</span>
            <span className="font-medium text-rose-700">
              {detail.receipt.returnedQty} {detail.receipt.uom}
            </span>
          </div>
        )}
      </div>
      <div className="text-xs uppercase tracking-wide text-slate-400">
        Transactions
      </div>
      {detail.receipts.map((t) => (
        <div
          key={t.receiptNumber}
          className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm"
        >
          <div>
            <div className="font-medium text-slate-900">{t.receiptNumber}</div>
            <div className="text-xs text-slate-500">
              {t.quantity} {t.uom} · {t.receiver}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">{formatDate(t.receivedDate)}</div>
            <div className="text-xs text-slate-700">{t.status}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ChangesTab({ detail }: { detail: RequisitionDetail }) {
  if (detail.changeOrders.length === 0) {
    return <EmptyTab text="No change orders on this requisition." />;
  }
  return (
    <div className="space-y-3">
      {detail.changeOrders.map((c) => (
        <div
          key={c.changeOrderNumber}
          className="rounded-lg border border-slate-200 p-3"
        >
          <div className="flex items-center justify-between">
            <div className="font-medium text-slate-900">
              {c.changeOrderNumber} (rev {c.revision})
            </div>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 ring-1 ring-inset ring-violet-200">
              {c.status}
            </span>
          </div>
          <div className="mt-1 text-sm text-slate-600">{c.description}</div>
          <div className="mt-1 text-xs text-slate-500">
            Submitted by {c.submittedBy} · {formatDate(c.submittedDate)}
          </div>
        </div>
      ))}
    </div>
  );
}

function AttachmentsTab({ detail }: { detail: RequisitionDetail }) {
  if (detail.attachments.length === 0) {
    return <EmptyTab text="No attachments." />;
  }
  return (
    <div className="space-y-2">
      {detail.attachments.map((a) => (
        <div
          key={a.name}
          className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm"
        >
          <div>
            <div className="font-medium text-slate-900">{a.name}</div>
            <div className="text-xs text-slate-500">
              {a.category} · {a.uploadedBy} · {formatDate(a.uploadedDate)}
              {a.size ? ` · ${a.size}` : ""}
            </div>
          </div>
          <ExternalLink className="h-4 w-4 text-slate-400" />
        </div>
      ))}
    </div>
  );
}

function ActivityTab({ detail }: { detail: RequisitionDetail }) {
  if (detail.comments.length === 0) {
    return <EmptyTab text="No activity recorded." />;
  }
  return (
    <div className="space-y-3">
      {detail.comments.map((c, i) => (
        <div key={i} className="rounded-lg border border-slate-200 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-900">{c.author}</span>
            <span className="text-xs text-slate-500">{formatDate(c.date)}</span>
          </div>
          <div className="mt-1 text-sm text-slate-600">{c.text}</div>
        </div>
      ))}
    </div>
  );
}

function EmptyTab({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}

// ============================================================================
// Placeholder states
// ============================================================================

function EmptyState(props: { onReset: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
        <FilterIcon className="h-6 w-6 text-slate-400" />
        <div className="font-medium text-slate-700">
          No requisitions match this filter
        </div>
        <div className="text-sm text-slate-500">
          Try a different status or clear your filters.
        </div>
        <Button variant="outline" size="sm" className="mt-2" onClick={props.onReset}>
          Clear filters
        </Button>
      </CardContent>
    </Card>
  );
}

function ErrorCard(props: { error: Error; onRetry: () => void }) {
  return (
    <Card className="border-rose-200 bg-rose-50">
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <div className="font-medium text-rose-900">
            Couldn&apos;t load requisitions
          </div>
          <div className="text-sm text-rose-700">{props.error.message}</div>
        </div>
        <Button size="sm" variant="outline" onClick={props.onRetry}>
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardContent className="space-y-3 p-4">
            <SkeletonBar />
            <SkeletonBar />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SkeletonBar() {
  return <div className="h-4 w-full animate-pulse rounded bg-slate-200" />;
}

// ============================================================================
// Demo banner — makes it obvious to pilot users that data is mocked.
// Remove this component (and its usage in Dashboard) once fusion-service.ts
// is wired to a real BFF.
// ============================================================================

function DemoBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <span className="rounded-full bg-amber-900 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-50">
        Demo
      </span>
      <span className="flex-1">
        This dashboard is running on mock data. Values change every few seconds
        to show the live-update indicator working — nothing here is from Fusion
        yet.
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="rounded-md p-1 text-amber-700 hover:bg-amber-100"
        aria-label="Dismiss demo notice"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
