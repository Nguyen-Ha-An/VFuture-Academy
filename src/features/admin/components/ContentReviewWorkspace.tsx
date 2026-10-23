"use client";
import { ReviewDependencies, ReviewHistory } from '@/features/content-review/ReviewMetadata';
import { ReviewSourcePreview } from '@/features/content-review/ReviewSourcePreview';
import { ContentWorkflowPanel, type ContentWorkflow } from '@/features/content-review/ContentWorkflowPanel';

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataCard } from "@/features/staff-ui/components/DataCard";
import { DataPagination } from "@/features/staff-ui/components/DataPagination";
import { DataToolbar, useUrlParamUpdater } from "@/features/staff-ui/components/DataToolbar";
import { EmptyState } from "@/features/staff-ui/components/EmptyState";
import { RowActions, type RowAction } from "@/features/staff-ui/components/RowActions";
import { StatusBadge } from "@/features/staff-ui/components/StatusBadge";
import { StatCard } from "@/features/staff-ui/components/StatCard";
import { StatGrid } from "@/features/staff-ui/components/StatGrid";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StaffPageHeader } from "@/features/workspace/ui/StaffPageHeader";
import { contentEditorHref } from "@/features/content-review/lifecycle";
import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { CONTENT_STAGES, STAGE_TONES, isContentStage, localizedTitle, rowStage } from "@/features/studio/ui/home/stages";
import { PUBLISH_CHECKLIST_KEYS, emptyPublishChecklist, isPublishChecklistComplete, type PublishChecklist } from "@/features/studio/publish-checklist";
import { cn } from "@/lib/ui-cn";
import { ConfirmationDialog, scopedUrl } from "./member-admin-ui";
import type { AdminScope } from "@/lib/admin-scope";


export type ContentRow = {
  content_type: string;
  content_id: string;
  title?: unknown;
  audience?: unknown;
  status: string;
  ownership_kind: "central" | "branch";
  owner_branch_id: string | null;
  updated_at: string;
  revision_key: string;
  review_status: string | null;
  studio_href: string;
};
export type ReviewRow = {
  id: string;
  content_type: string;
  content_id: string;
  status: string;
  owner_branch_id: string | null;
  submitted_at: string;
  decision_note: string | null;
  self_review: boolean;
  revision_key: string;
  checksum: string;
  dependencies: unknown[];
  /** Returned by cms_list_reviews; resolved to a name through the optional `submitters` map. */
  submitted_by?: string | null;
};
type ReviewPreview = {
  resolvedBankQuestions?: Record<string,unknown>;
  review: Pick<ReviewRow, "id" | "content_type" | "content_id" | "status">;
  snapshot: {
    revision_key: string;
    ownership_kind: string;
    owner_branch_id: string | null;
    audience: unknown;
    dependencies: unknown[];
  };
  reviewed_source: unknown;
  published_snapshot: { source: unknown; revision_key: string } | null;
};
type ScopeProps = {
  scope: AdminScope;
  actorId: string;
  branches: { id: string; name: string }[];
};

const localized = localizedTitle;
function fieldValues(
  value: unknown,
  prefix = "",
  result = new Map<string, string>(),
  depth = 0,
): Map<string, string> {
  if (result.size >= 5000 || depth > 32) return result;
  if (value && typeof value === "object" && Object.keys(value).length) {
    for (const [key, child] of Object.entries(value))
      fieldValues(child, prefix ? `${prefix}.${key}` : key, result, depth + 1);
  } else
    result.set(
      prefix,
      typeof value === "string" ? value : (JSON.stringify(value) ?? ""),
    );
  return result;
}
export function reviewChanges(before: unknown, after: unknown) {
  const left = fieldValues(before),
    right = fieldValues(after);
  return [...new Set([...left.keys(), ...right.keys()])]
    .sort()
    .filter((key) => left.get(key) !== right.get(key))
    .map((key) => ({
      field: key,
      before: left.get(key) ?? "—",
      after: right.get(key) ?? "—",
    }));
}
async function readData<T>(
  url: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload?.error?.message ?? "Request failed");
  return payload.data as T;
}
function audienceLabel(
  value: unknown,
  branches: ScopeProps["branches"],
  globalLabel: string,
) {
  if (!value || typeof value !== "object") return "—";
  const audience = value as { scope?: string; branchIds?: string[] };
  return audience.scope === "global"
    ? globalLabel
    : audience.branchIds
        ?.map((id) => branches.find((branch) => branch.id === id)?.name ?? id)
        .join(", ") || "—";
}
function validDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
const errorNotice = "rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-normal text-destructive-soft-foreground";
const LIBRARY_PAGE_SIZE = 25;
/** Search, filters and the CMS deep link (`?id=`) reset the page; `id` also clears once any filter changes. */
const LIBRARY_RESET_PARAMS = ["page", "id"];

type WorkflowOverride = { reviewStatus: string | null; status: string };

/**
 * /studio/library. Search, type, stage and page live in the URL (`q`, `type`, `status`, `page`;
 * CMS links add `id`). Every row is loaded, so paging is client side and the footer's total is real.
 * The review workflow opens in a right-hand Sheet from the row's "…" menu.
 */
export function ContentInventory({
  rows,
  scope,
  actorId,
  branches,
  creatableTypes,
  requestableKeys,
  pageSize = LIBRARY_PAGE_SIZE,
  title,
  description,
}: ScopeProps & {
  rows: ContentRow[];
  creatableTypes: string[];
  requestableKeys: string[];
  pageSize?: number;
  /** When given, the inventory renders the page header itself so "Create" is its one primary action. */
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const updateParams = useUrlParamUpdater(LIBRARY_RESET_PARAMS);
  const t = useTranslations("cmsAdmin");
  const library = useTranslations("staffUi.studio.library");
  const home = useTranslations("staffUi.studio.home");
  const format = useFormatter();
  const locale = useLocale();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workflowKey, setWorkflowKey] = useState<string | null>(null);
  const [workflowOverrides, setWorkflowOverrides] = useState<Record<string, WorkflowOverride>>({});
  const query = searchParams?.get("q") ?? "";
  const type = searchParams?.get("type") ?? "";
  const stage = searchParams?.get("status") ?? "";
  const focusId = searchParams?.get("id") ?? "";
  const requestedPage = Number.parseInt(searchParams?.get("page") ?? "1", 10);
  const central = home("central");
  const ownerName = (kind: ContentRow["ownership_kind"], branchId: string | null) =>
    kind === "central"
      ? central
      : (branches.find((branch) => branch.id === branchId)?.name ?? branchId ?? "—");
  const owner = scope.kind === "central" ? central : ownerName("branch", scope.branchId);
  const creation = [
    ["course", "/studio/courses"],
    ["resource", "/studio/resources/new"],
    ["opportunity", "/studio/opportunities/new"],
    ["project", "/studio/projects/new"],
    ["bank_question", "/studio/bank"],
    ["media_asset", "/studio/media"],
  ];
  const url = (path: string) => scopedUrl(path, scope, { actorId });
  async function requestReview(row: ContentRow) {
    if (busy) return;
    setBusy(`${row.content_type}:${row.content_id}`);
    setError(null);
    try {
      await readData(
        url(
          `/api/v1/studio/content/${encodeURIComponent(row.content_type)}/${encodeURIComponent(row.content_id)}/reviews`,
        ),
        { expectedRevision: row.revision_key },
      );
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("failed"));
    } finally {
      setBusy(null);
    }
  }
  const rowsWithWorkflow = rows.map((row) => {
    const override = workflowOverrides[`${row.content_type}:${row.content_id}`];
    return override ? { ...row, review_status: override.reviewStatus, status: override.status } : row;
  });
  const needle = query.trim().toLocaleLowerCase();
  const filtered = rowsWithWorkflow.filter(
    (row) =>
      (!focusId || row.content_id === focusId) &&
      (!type || row.content_type === type) &&
      (!stage || (isContentStage(stage) ? rowStage(row) === stage : row.status === stage)) &&
      (!needle || `${localized(row.title, locale)} ${row.content_id}`.toLocaleLowerCase().includes(needle)),
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, Number.isFinite(requestedPage) ? requestedPage : 1), pageCount);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const workflowRow = workflowKey ? rowsWithWorkflow.find((row) => `${row.content_type}:${row.content_id}` === workflowKey) ?? null : null;
  const titleOf = (row: ContentRow) => localized(row.title, locale) || row.content_id;
  const typeOf = (key: string) => (t.has(`types.${key}`) ? t(`types.${key}`) : key);

  const creatable = creation.filter(([key]) => creatableTypes.includes(key));
  const createAction = creatable.length === 1 ? (
    <Button asChild>
      <Link href={`${creatable[0][1]}?ownership=${scope.kind}`}><PlusIcon aria-hidden="true" />{t(`create.${creatable[0][0]}`)}</Link>
    </Button>
  ) : creatable.length > 1 ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button><PlusIcon aria-hidden="true" />{library("createMenu")}<ChevronDownIcon aria-hidden="true" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {creatable.map(([key, href]) => (
          <DropdownMenuItem key={key} asChild>
            <Link href={`${href}?ownership=${scope.kind}`}>{t(`create.${key}`)}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;
  // Every row is loaded, so these are honest snapshot counts (no deltas).
  const stageTotals = rowsWithWorkflow.reduce<Record<string, number>>((totals, row) => {
    const value = rowStage(row);
    if (value) totals[value] = (totals[value] ?? 0) + 1;
    return totals;
  }, {});
  const stats = rows.length ? (
    <StatGrid aria-label={library("stats.label")}>
      <StatCard label={library("stats.total")} value={rowsWithWorkflow.length} />
      {(["in_review", "changes_requested", "published"] as const).map((value) => (
        <StatCard key={value} label={home(`stages.${value}`)} value={stageTotals[value] ?? 0} />
      ))}
    </StatGrid>
  ) : null;

  return (
    <div className="space-y-5">
      {title ? (
        <>
          <StaffPageHeader
            title={title}
            description={creatable.length ? `${description ? `${description} ` : ""}${t("creatingFor", { owner })}` : description}
            actions={createAction}
          />
          {stats}
        </>
      ) : creatableTypes.length ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p className="text-sm leading-normal text-muted-foreground">
            {t("creatingFor", { owner })}
          </p>
          <div className="flex flex-wrap gap-2">
            {creatable.map(([key, href]) => (
              <Button key={key} asChild variant="outline" size="sm">
                <Link href={`${href}?ownership=${scope.kind}`}>{t(`create.${key}`)}</Link>
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className={errorNotice}>
          {error}
        </p>
      ) : null}
      <DataCard
        title={library("listTitle")}
        toolbar={
          <div className="space-y-3">
            <DataToolbar
              resetParams={LIBRARY_RESET_PARAMS}
              searchLabel={t("search")}
              searchPlaceholder={library("searchPlaceholder")}
              filters={[
                {
                  param: "type",
                  label: t("type"),
                  allLabel: t("allTypes"),
                  options: [...new Set(rows.map((row) => row.content_type))].map((key) => ({ value: key, label: typeOf(key) })),
                },
                {
                  param: "status",
                  label: t("status"),
                  allLabel: t("allStates"),
                  options: CONTENT_STAGES.map((value) => ({ value, label: home(`stages.${value}`) })),
                },
              ]}
            />
            {focusId ? (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-normal text-muted-foreground">
                {library("focused", { id: focusId })}
                <Button variant="link" size="sm" className="h-auto px-0" onClick={() => updateParams({ id: null })}>
                  {library("showAll")}
                </Button>
              </p>
            ) : null}
          </div>
        }
        footer={filtered.length ? <DataPagination mode="page" page={page} pageSize={pageSize} total={filtered.length} /> : undefined}
      >
        {visible.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("content")}</TableHead>
                <TableHead scope="col" className="hidden md:table-cell">{t("owner")}</TableHead>
                <TableHead scope="col" className="hidden lg:table-cell">{t("audience")}</TableHead>
                <TableHead scope="col">{t("status")}</TableHead>
                <TableHead scope="col" className="hidden md:table-cell">{t("updated")}</TableHead>
                <TableHead scope="col"><span className="sr-only">{t("actions")}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => {
                const key = `${row.content_type}:${row.content_id}`;
                const inReview = ["pending", "approved"].includes(row.review_status ?? "");
                const rowStageValue = rowStage(row);
                const updated = validDate(row.updated_at);
                const title = titleOf(row);
                const actions: RowAction[] = [];
                if (requestableKeys.includes(key)) {
                  actions.push({
                    label: busy === key ? t("submitting") : inReview ? t("inReview") : t("requestReview"),
                    disabled: busy !== null || inReview,
                    onSelect: () => requestReview(row),
                  });
                }
                const editorHref = contentEditorHref(row.content_type, row.content_id, row.studio_href);
                // Editable rows open their editor; read-only rows (learner links) and the library itself do not.
                if (editorHref.startsWith("/studio/") && !editorHref.startsWith("/studio/library"))
                  actions.unshift({ label: library("openEditor"), href: editorHref });
                actions.push({ label: library("reviewWorkflow"), onSelect: () => setWorkflowKey(key) });
                return (
                  <TableRow key={key}>
                    <TableCell className="max-w-80 whitespace-normal py-3">
                      <Link href={editorHref} className="break-words font-medium leading-normal underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring">
                        {title}
                      </Link>
                      <p className="text-xs leading-normal text-muted-foreground">{typeOf(row.content_type)}</p>
                    </TableCell>
                    <TableCell className="hidden whitespace-normal md:table-cell">
                      {ownerName(row.ownership_kind, row.owner_branch_id)}
                    </TableCell>
                    <TableCell className="hidden whitespace-normal lg:table-cell">
                      {audienceLabel(row.audience, branches, t("globalAudience"))}
                    </TableCell>
                    <TableCell>
                      {rowStageValue ? (
                        <StatusBadge kind="content" value={rowStageValue} label={home(`stages.${rowStageValue}`)} tone={STAGE_TONES[rowStageValue]} />
                      ) : (
                        <StatusBadge kind="content" value={row.status} label={row.status === "asset" ? library("assetState") : undefined} />
                      )}
                      {busy === key ? <span role="status" className="ml-2 text-xs leading-normal text-muted-foreground">{t("submitting")}</span> : null}
                    </TableCell>
                    <TableCell className="hidden tabular-nums text-muted-foreground md:table-cell">
                      {updated ? format.dateTime(updated, { dateStyle: "medium", timeStyle: "short" }) : "—"}
                    </TableCell>
                    <TableCell className="w-12 text-right">
                      <RowActions label={library("rowActions", { title })} items={actions} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="p-6">
            <EmptyState title={t("emptyContent")} />
          </div>
        )}
      </DataCard>
      <Sheet open={workflowRow !== null} onOpenChange={(open) => { if (!open) setWorkflowKey(null); }}>
        {workflowRow ? (
          <SheetContent side="right" closeLabel={t("close")} className="w-full overflow-y-auto sm:max-w-xl">
            <SheetHeader className="pr-12">
              <SheetTitle className="leading-normal">{library("reviewWorkflow")}</SheetTitle>
              <SheetDescription className="leading-normal">{library("workflowDescription", { title: titleOf(workflowRow) })}</SheetDescription>
            </SheetHeader>
            <div className="px-6 pb-6">
              <ContentWorkflowPanel
                contentType={workflowRow.content_type}
                contentId={workflowRow.content_id}
                onWorkflowChange={(workflow: ContentWorkflow | null) => {
                  if (!workflow) return;
                  const key = `${workflowRow.content_type}:${workflowRow.content_id}`;
                  const published = workflow.publication !== null && workflow.content.revisionKey === workflow.publication.revisionKey;
                  const next: WorkflowOverride = { reviewStatus: workflow.activeReview?.status ?? null, status: published ? "published" : workflow.content.status };
                  setWorkflowOverrides((current) =>
                    current[key]?.reviewStatus === next.reviewStatus && current[key]?.status === next.status ? current : { ...current, [key]: next },
                  );
                }}
              />
            </div>
          </SheetContent>
        ) : null}
      </Sheet>
    </div>
  );
}

/**
 * /studio/reviews. Master–detail: the request list on the left, the submitted version on the right
 * from `lg` (stacked below). Row decision buttons show only while nothing is selected, so
 * "Approve and publish" never appears twice. Titles come from `titles` (keyed `type:id`, falling back
 * to the id) and submitter names from `submitters` (keyed by lower-cased user id).
 */
export function ReviewQueue({
  rows,
  canReview,
  canPublish,
  publishableTypes,
  scope,
  actorId,
  branches,
  titles,
  submitters,
}: ScopeProps & {
  rows: ReviewRow[];
  canReview: boolean;
  canPublish: boolean;
  publishableTypes?: readonly string[];
  titles?: Record<string, unknown>;
  submitters?: Record<string, string>;
}) {
  const router = useRouter();
  const t = useTranslations("cmsAdmin");
  const reviews = useTranslations("staffUi.studio.reviews");
  const home = useTranslations("staffUi.studio.home");
  const format = useFormatter();
  const locale = useLocale();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const [selected, setSelected] = useState<ReviewPreview | null>(null);
  const [previewTab, setPreviewTab] = useState<"preview" | "changes" | "dependencies" | "history">("preview");
  const [decision, setDecision] = useState<{
    row: ReviewRow;
    value: "changes_requested";
  } | null>(null);
  const [note, setNote] = useState("");
  const [publication, setPublication] = useState<ReviewRow | null>(null);
  const [publicationNote, setPublicationNote] = useState("");
  const checklistCopy = useTranslations("staffUi.studio.courses.checklist");
  const [checklist, setChecklist] = useState<PublishChecklist>(emptyPublishChecklist);
  const [query,setQuery]=useState('');
  const [typeFilter,setTypeFilter]=useState('');
  const [stateFilter,setStateFilter]=useState('');
  const [confirmedTransitions, setConfirmedTransitions] = useState<Record<string, { from: string[]; to: string }>>({});
  // A successful mutation is authoritative while refresh is pending. A later
  // server state supersedes this transition; immutable preview data never does.
  const currentRows = rows.map((row) => {
    const transition = confirmedTransitions[row.id];
    return transition?.from.includes(row.status) ? { ...row, status: transition.to } : row;
  });
  const selectedRow = currentRows.find((row) => row.id === selected?.review.id);
  const titleFor = (contentType: string, contentId: string) =>
    localized(titles?.[`${contentType}:${contentId}`], locale) || contentId;
  const submitterFor = (row: ReviewRow) => (row.submitted_by ? submitters?.[row.submitted_by.toLowerCase()] ?? null : null);
  const ownerFor = (branchId: string | null) =>
    branchId ? (branches.find((branch) => branch.id === branchId)?.name ?? branchId) : home("central");
  const typeOf = (key: string) => (t.has(`types.${key}`) ? t(`types.${key}`) : key);
  const stateLabel = (state: string) => (t.has(`states.${state}`) ? t(`states.${state}`) : undefined);
  const needle = query.trim().toLowerCase();
  const filteredRows=currentRows.filter(row=>(!typeFilter||row.content_type===typeFilter)&&(!stateFilter||row.status===stateFilter)&&(!needle||`${titleFor(row.content_type,row.content_id)} ${row.content_id} ${row.decision_note??''}`.toLowerCase().includes(needle)));
  useEffect(() => {
    if (selected) {
      previewHeading.current?.focus({ preventScroll: true });
      previewHeading.current?.scrollIntoView?.({
        block: "start",
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")
          ?.matches
          ? "auto"
          : "smooth",
      });
    }
  }, [selected]);
  const url = (path: string) => scopedUrl(path, scope, { actorId });
  async function preview(row: ReviewRow) {
    if (busy) return;
    setBusy(row.id);
    setError(null);
    setSelected(null);
    setPreviewTab("preview");
    try {
      const loaded = await readData<ReviewPreview>(
        url(`/api/v1/studio/reviews/${row.id}`), undefined, "GET",
      );
      setSelected(loaded);
      setConfirmedTransitions((previous) => {
        const confirmed = previous[row.id];
        // A delayed preview must not roll back a state already confirmed by a
        // mutation or a newer preview of this immutable review request.
        if (confirmed && (confirmed.to === loaded.review.status || confirmed.from.includes(loaded.review.status))) return previous;
        return {
          ...previous,
          [row.id]: { from: [...(confirmed?.from ?? []), row.status], to: loaded.review.status },
        };
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("failed"));
    } finally {
      setBusy(null);
    }
  }
  async function decide() {
    if (!decision || busy || !note.trim()) return;
    setBusy(decision.row.id);
    setError(null);
    try {
      const decided = await readData<{ status?: string }>(url(`/api/v1/studio/reviews/${decision.row.id}/decision`), {
        decision: decision.value,
        note: note.trim(),
      });
      if (decided?.status !== 'changes_requested') {
        throw new Error(decided?.status === 'stale' ? t('states.stale') : t('failed'));
      }
      setConfirmedTransitions((previous) => ({
        ...previous,
        [decision.row.id]: { from: [decision.row.status], to: 'changes_requested' },
      }));
      setDecision(null);
      setSelected(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("failed"));
      setDecision(null);
    } finally {
      setBusy(null);
    }
  }
  const mayPublish = (row: ReviewRow) => canReview && canPublish && (!publishableTypes || publishableTypes.includes(row.content_type));
  async function approveAndPublish() {
    if (!publication || !mayPublish(publication) || busy || !publicationNote.trim()) return;
    const requiresChecklist = publication.content_type === 'course';
    if (requiresChecklist && !isPublishChecklistComplete(checklist)) return;
    setBusy(publication.id);
    setError(null);
    try {
      const published = await readData<{ status?: string }>(url(`/api/v1/studio/reviews/${publication.id}/approve-and-publish`), {
        expectedRevision: publication.revision_key,
        note: publicationNote.trim(),
        ...(requiresChecklist ? { checklist } : {}),
      });
      if (published?.status !== 'published') {
        throw new Error(published?.status === 'stale' ? t('states.stale') : t('failed'));
      }
      setConfirmedTransitions((previous) => ({
        ...previous,
        [publication.id]: { from: [...(previous[publication.id]?.from ?? []), publication.status], to: 'published' },
      }));
      setPublication(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("failed"));
      setPublication(null);
    } finally {
      setBusy(null);
    }
  }
  function openPublication(row: ReviewRow) {
    setPublication(row);
    setPublicationNote('');
    setChecklist(emptyPublishChecklist());
  }
  const changes = selected
    ? reviewChanges(
        selected.published_snapshot?.source ?? {},
        selected.reviewed_source,
      )
    : [];
  const decisionButtons = (row: ReviewRow) => (
    <>
      {canReview && row.status === "pending" ? (
        <>
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => { setDecision({ row, value: "changes_requested" }); setNote(""); }}>
            {t("requestChanges")}
          </Button>
          {mayPublish(row) ? <Button size="sm" variant={selected ? "default" : "outline"} disabled={busy !== null} onClick={() => openPublication(row)}>{reviews("approveAndPublish")}</Button> : null}
        </>
      ) : null}
      {mayPublish(row) && row.status === "approved" ? (
        <Button size="sm" variant={selected ? "default" : "outline"} disabled={busy !== null} onClick={() => openPublication(row)}>{reviews("completePublication")}</Button>
      ) : null}
    </>
  );
  const tabs = ["preview", "changes", "dependencies", "history"] as const;
  return (
    <div className="space-y-5">
      {error ? (
        <p role="alert" className={errorNotice}>
          {error}
        </p>
      ) : null}
      <div className={cn("grid items-start gap-6", canReview && "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]")}>
        <DataCard
          title={reviews("listTitle")}
          toolbar={
            <DataToolbar
              values={{ q: query, type: typeFilter, status: stateFilter }}
              onValuesChange={(next) => { setQuery(next.q ?? ""); setTypeFilter(next.type ?? ""); setStateFilter(next.status ?? ""); }}
              searchLabel={reviews("search")}
              filters={[
                { param: "type", label: reviews("type"), allLabel: t("allTypes"), options: [...new Set(currentRows.map((row) => row.content_type))].map((type) => ({ value: type, label: typeOf(type) })) },
                { param: "status", label: t("status"), allLabel: t("allStates"), options: [...new Set(currentRows.map((row) => row.status))].map((state) => ({ value: state, label: stateLabel(state) ?? state })) },
              ]}
            />
          }
        >
          {!filteredRows.length ? (
            <div className="p-6">
              <EmptyState title={t("emptyReviews")} />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filteredRows.map((row) => {
                const isSelected = row.id === selected?.review.id;
                const submitted = validDate(row.submitted_at);
                const submitter = submitterFor(row);
                return (
                  <li
                    key={row.id}
                    aria-current={isSelected ? "true" : undefined}
                    className={cn("flex flex-col gap-3 px-6 py-4", isSelected && "bg-muted/60")}
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="text-xs leading-normal text-muted-foreground">
                        {typeOf(row.content_type)} · {ownerFor(row.owner_branch_id)}
                        {isSelected ? <> · <span className="font-medium text-foreground">{reviews("viewing")}</span></> : null}
                      </p>
                      <h3 className="break-words text-sm font-medium leading-normal">{titleFor(row.content_type, row.content_id)}</h3>
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-normal text-muted-foreground">
                        <StatusBadge kind="review" value={row.status} label={stateLabel(row.status)} />
                        {submitted ? <time dateTime={row.submitted_at} className="tabular-nums">{format.dateTime(submitted, { dateStyle: "medium", timeStyle: "short" })}</time> : null}
                        {submitter ? <span>{reviews("submittedBy", { name: submitter })}</span> : null}
                      </p>
                      {row.self_review ? (
                        <p className="text-sm leading-normal text-muted-foreground">
                          {t("selfReview")}
                        </p>
                      ) : null}
                      {row.decision_note ? (
                        <p className="whitespace-pre-wrap break-words text-sm leading-normal">
                          {row.decision_note}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canReview ? (
                        <Button
                          variant={isSelected ? "secondary" : "outline"}
                          size="sm"
                          disabled={busy !== null}
                          onClick={(event) => {
                            previewTrigger.current = event.currentTarget;
                            void preview(row);
                          }}
                        >
                          {t("preview")}
                        </Button>
                      ) : null}
                      {selected ? null : decisionButtons(row)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </DataCard>
        {selected ? (
          <section
            aria-labelledby="review-preview-title"
            className="min-w-0 space-y-5 rounded-lg border border-border bg-card p-6 text-card-foreground"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2
                ref={previewHeading}
                tabIndex={-1}
                id="review-preview-title"
                className="min-w-0 break-words text-base font-semibold leading-normal outline-none"
              >
                {t("preview")}: {titleFor(selected.review.content_type, selected.review.content_id)}
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelected(null);
                  previewTrigger.current?.focus();
                }}
              >
                {t("close")}
              </Button>
            </div>
            {selectedRow && (canReview && selectedRow.status === 'pending' || mayPublish(selectedRow) && selectedRow.status === 'approved') ? (
              <div className="flex flex-wrap gap-2 border-b border-border pb-4">
                {decisionButtons(selectedRow)}
              </div>
            ) : null}
            <p className="text-sm leading-normal text-muted-foreground">{t("snapshotHint")} {reviews("readOnlyPreview")}</p>
            <div role="tablist" aria-label={reviews("detailsLabel")} className="flex flex-nowrap gap-1 overflow-x-auto border-b border-border">
              {tabs.map((tab) => <button key={tab} id={`review-${tab}-tab`} type="button" role="tab" aria-selected={previewTab === tab} aria-controls={`review-${tab}-panel`} tabIndex={previewTab === tab ? 0 : -1} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { const index = tabs.indexOf(tab); const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; setPreviewTab(next); document.getElementById(`review-${next}-tab`)?.focus(); } }} onClick={() => setPreviewTab(tab)} className={cn("-mb-px min-h-9 shrink-0 whitespace-nowrap border-b-2 px-3 text-sm font-medium leading-normal text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none", previewTab === tab ? "border-foreground text-foreground" : "border-transparent")}>{tab === "preview" ? t("preview") : tab === "changes" ? t("changes") : tab === "dependencies" ? reviews("dependenciesTab") : reviews("historyTab")}</button>)}
            </div>
            <dl className="grid gap-4 rounded-md border border-border p-4 sm:grid-cols-3">
              <div className="min-w-0">
                <dt className="text-sm leading-normal text-muted-foreground">{t("owner")}</dt>
                <dd className="break-words text-sm leading-normal">
                  {selected.snapshot.ownership_kind === "central"
                    ? home("central")
                    : ownerFor(selected.snapshot.owner_branch_id)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-sm leading-normal text-muted-foreground">{t("audience")}</dt>
                <dd className="break-words text-sm leading-normal">
                  {audienceLabel(
                    selected.snapshot.audience,
                    branches,
                    t("globalAudience"),
                  )}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-sm leading-normal text-muted-foreground">{reviews("snapshot")}</dt>
                <dd className="break-all text-xs leading-normal text-muted-foreground">{selected.snapshot.revision_key}</dd>
              </div>
            </dl>
            {previewTab === "preview" ? <div id="review-preview-panel" role="tabpanel" aria-labelledby="review-preview-tab" className="space-y-3 border-y border-border py-5"><ReviewSourcePreview source={selected.reviewed_source} locale={locale} resolvedBankQuestions={selected.resolvedBankQuestions} /></div> : null}
            {previewTab === "changes" ? <div id="review-changes-panel" role="tabpanel" aria-labelledby="review-changes-tab" className="space-y-3"><h3 className="text-sm font-medium leading-normal">{t("changes")}</h3>
            {!selected.published_snapshot ? (
              <p className="text-sm leading-normal text-muted-foreground">
                {t("firstPublication")}
              </p>
            ) : null}
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("field")}</TableHead>
                  <TableHead scope="col">{t("before")}</TableHead>
                  <TableHead scope="col">{t("after")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changes.slice(0, 500).map((change) => (
                  <TableRow key={change.field} className="align-top">
                    <th scope="row" className="max-w-48 break-all p-2 text-left font-normal leading-normal">
                      {change.field}
                    </th>
                    <TableCell className="h-auto max-w-md whitespace-pre-wrap break-words py-2 leading-normal text-muted-foreground">
                      {change.before}
                    </TableCell>
                    <TableCell className="h-auto max-w-md whitespace-pre-wrap break-words py-2 leading-normal">
                      {change.after}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {changes.length > 500 ? (
              <p className="text-sm leading-normal">{t("moreChanges")}</p>
            ) : null}</div> : null}
            {previewTab === "dependencies" ? <div id="review-dependencies-panel" role="tabpanel" aria-labelledby="review-dependencies-tab"><ReviewDependencies dependencies={selected.snapshot.dependencies} locale={locale}/></div> : null}
            {previewTab === "history" ? <div id="review-history-panel" role="tabpanel" aria-labelledby="review-history-tab"><ReviewHistory rows={currentRows.filter(row=>row.content_type===selected.review.content_type&&row.content_id===selected.review.content_id)} locale={locale} submitters={submitters}/></div> : null}
            <details>
              <summary className="cursor-pointer text-sm font-medium leading-normal">
                {t("source")}
              </summary>
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-xs leading-normal">
                {JSON.stringify(selected.reviewed_source, null, 2)}
              </pre>
            </details>
          </section>
        ) : canReview ? (
          <EmptyState
            className="hidden lg:flex"
            headingLevel={2}
            title={reviews("selectTitle")}
            description={reviews("selectDescription")}
          />
        ) : null}
      </div>
      <ConfirmationDialog
        open={decision !== null}
        title={
          t("requestChanges")
        }
        description={decision ? titleFor(decision.row.content_type, decision.row.content_id) : ""}
        onCancel={() => setDecision(null)}
        onConfirm={() => void decide()}
        confirmLabel={busy ? t("submitting") : t("confirm")}
      >
        <label className="grid gap-2 text-sm">
          {t("decisionNote")}
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            required
            maxLength={4000}
            className="min-h-28 rounded-md border border-input bg-background p-3"
          />
        </label>
        {!note.trim() ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("noteRequired")}
          </p>
        ) : null}
      </ConfirmationDialog>
      <ConfirmationDialog
        open={publication !== null}
        title={reviews("approveAndPublish")}
        description={publication ? titleFor(publication.content_type, publication.content_id) : ''}
        onCancel={() => setPublication(null)}
        onConfirm={() => void approveAndPublish()}
        confirmLabel={busy ? t('submitting') : reviews("approveAndPublish")}
      >
        <label className="grid gap-2 text-sm">
          {reviews("reviewNote")}
          <textarea value={publicationNote} onChange={(event) => setPublicationNote(event.target.value)} required maxLength={4000} className="min-h-28 rounded-md border border-input bg-background p-3" />
        </label>
        {publication?.content_type === 'course' ? <fieldset className="mt-4 grid gap-2 text-sm"><legend className="font-medium">{checklistCopy('legend')}</legend>{PUBLISH_CHECKLIST_KEYS.map((key) => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={checklist[key]} onChange={(event) => setChecklist((current) => ({ ...current, [key]: event.target.checked }))} />{checklistCopy(`items.${key}.confirm`)}</label>)}</fieldset> : null}
        {!publicationNote.trim() ? <p className="mt-2 text-xs text-muted-foreground">{reviews("reviewNoteRequired")}</p> : null}
      </ConfirmationDialog>
    </div>
  );
}
