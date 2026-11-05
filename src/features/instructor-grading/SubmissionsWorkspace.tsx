'use client';
import { NotebookSubmissionPreview } from '@/features/notebooks/ui/NotebookSubmissionPreview';

import { Eye, FileText, Inbox, ListFilter, LoaderCircle, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';

import { CanvasButton as Button, CanvasDataTable } from '@/features/canvas/ui';
import { CanvasNumberInput, CanvasRadioInput, CanvasRadioInputGroup, CanvasSelect, CanvasProgressBar } from '@/features/canvas/ui';
import { DataCard, EmptyState, StatusBadge } from '@/features/staff-ui/components';
import { registerContentBlocks } from '@/content-engine/render/blocks';
import { RichContentView } from '@/content-engine/render/RichContentView';
import type { LessonRuntime } from '@/content-engine/render/runtime';
import type { RichContent } from '@/content-engine/schema/types';
import { readApiData, workspaceErrorMessage } from '@/features/studio/ui/client';
import type {
  SubmissionQueuePage,
  SubmissionQueueSubmission,
} from '@/features/submissions/contracts';
import { routes } from '@/lib/routes';
import { safeHttpsUrl } from './safe-url';
import type {
  AssignmentMetadata,
  BranchOption,
  CourseOption,
  InstructorRubric,
  LocalizedLabel,
  SubmissionGrade,
  SubmissionQueueItem,
  SubmissionStatus,
} from './types';

registerContentBlocks();

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function latestGrade(value: unknown): SubmissionGrade | undefined {
  const candidates = (Array.isArray(value) ? value : [value])
    .flatMap((entry): Record<string, unknown>[] => {
      const parsed = record(entry);
      return parsed ? [parsed] : [];
    })
    .sort((left, right) => String(right.graded_at ?? '').localeCompare(String(left.graded_at ?? '')));
  const grade = candidates[0];
  if (!grade || (grade.decision !== 'approved' && grade.decision !== 'changes_requested')
    || typeof grade.released !== 'boolean') return undefined;
  const rawScores = record(grade.rubric_scores) ?? {};
  const rubricScores = Object.fromEntries(Object.entries(rawScores).filter((entry): entry is [string, number] =>
    typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0));
  const rawFeedback = record(grade.feedback);
  const feedback: LocalizedLabel = typeof grade.feedback === 'string'
    ? grade.feedback
    : {
      ...(typeof rawFeedback?.vi === 'string' ? { vi: rawFeedback.vi } : {}),
      ...(typeof rawFeedback?.en === 'string' ? { en: rawFeedback.en } : {}),
    };
  return {
    rubricScores,
    feedback,
    decision: grade.decision,
    released: grade.released,
    ...(typeof grade.passed === 'boolean' ? { passed: grade.passed } : {}),
    ...(typeof grade.total_points === 'number' ? { totalPoints: grade.total_points } : {}),
    ...(typeof grade.max_points === 'number' ? { maxPoints: grade.max_points } : {}),
    ...(typeof grade.graded_at === 'string' ? { gradedAt: grade.graded_at } : {}),
  };
}

const submissionStatuses = new Set<SubmissionStatus>(['submitted', 'in_review', 'approved', 'changes_requested']);
/** Queue status filter values; `pending` ("Waiting") is submitted + in review together. */
const queueStatusFilters = ['pending', 'submitted', 'in_review', 'approved', 'changes_requested'] as const;

/**
 * Course and item titles by lower-cased course version id, already localized on the server
 * (src/features/grading/titles.ts). Used when a row has no matching assignment metadata.
 */
export type QueueTitles = Record<string, { courseTitle: string; items: Record<string, string> }>;

function submissionQueueParams(
  filter: { branchId: string; courseId: string; assignmentId: string; status: string },
  cursor?: string,
) {
  const params = new URLSearchParams();
  if (filter.branchId) params.set('branchId', filter.branchId);
  if (filter.courseId) params.set('courseId', filter.courseId);
  if (filter.assignmentId) params.set('assignmentId', filter.assignmentId);
  if (filter.status) params.set('status', filter.status);
  if (cursor) params.set('cursor', cursor);
  return params;
}

export function normalizeSubmissionRows(
  values: unknown,
  assignments: readonly AssignmentMetadata[],
  titles?: QueueTitles,
): SubmissionQueueItem[] {
  if (!Array.isArray(values)) return [];
  const metadata = new Map(assignments.map((assignment) => [
    `${assignment.courseVersionId}:${assignment.itemId}:${assignment.assignmentId}`,
    assignment,
  ]));
  return values.flatMap((value) => {
    const row = record(value);
    if (!row) return [];
    const id = typeof row.id === 'string' ? row.id : null;
    const userId = typeof row.userId === 'string' ? row.userId : typeof row.user_id === 'string' ? row.user_id : null;
    const courseVersionId = typeof row.courseVersionId === 'string'
      ? row.courseVersionId
      : typeof row.course_version_id === 'string' ? row.course_version_id : null;
    const itemId = typeof row.itemId === 'string' ? row.itemId : typeof row.item_id === 'string' ? row.item_id : null;
    const rawBlockId = Object.hasOwn(row, 'blockId') ? row.blockId : row.block_id;
    const blockId = typeof rawBlockId === 'string' ? rawBlockId : null;
    const assignmentId = typeof row.assignmentId === 'string' ? row.assignmentId : blockId ?? itemId;
    const status = typeof row?.status === 'string' && submissionStatuses.has(row.status as SubmissionStatus)
      ? row.status as SubmissionStatus
      : null;
    const submittedAt = typeof row.submittedAt === 'string'
      ? row.submittedAt
      : typeof row.submitted_at === 'string' ? row.submitted_at : null;
    const attemptNo = Number.isSafeInteger(row.attemptNo) ? row.attemptNo : row.attempt_no;
    if (!id || !userId || !courseVersionId || !itemId || !assignmentId || !status || !submittedAt
      || !Number.isSafeInteger(attemptNo)) return [];
    const profile = record(Array.isArray(row.profiles) ? row.profiles[0] : row.profiles);
    const assignment = metadata.get(`${courseVersionId}:${itemId}:${assignmentId}`);
    const versionTitles = titles?.[courseVersionId.toLowerCase()];
    const payload = record(row.payload) ?? {};
    const links = Array.isArray(payload.links) ? payload.links.flatMap((rawLink) => {
      const link = record(rawLink);
      return typeof link?.url === 'string'
        ? [{ url: link.url, ...(typeof link.label === 'string' ? { label: link.label } : {}) }]
        : [];
    }) : undefined;
    const code = record(payload.code);
    const rawFiles = Array.isArray(row.files) ? row.files : row.submission_files;
    const files = Array.isArray(rawFiles) ? rawFiles.flatMap((rawFile) => {
      const file = record(rawFile);
      const assetId = typeof file?.assetId === 'string' ? file.assetId : file?.asset_id;
      const size = typeof file?.size === 'number' ? file.size : file?.size_bytes;
      return typeof assetId === 'string' && typeof file?.name === 'string'
        && typeof size === 'number' && typeof file.mime === 'string'
        ? [{ assetId, name: file.name, size, mime: file.mime }]
        : [];
    }) : [];
    const camelGrade = record(row.grade);
    const grade = camelGrade && (camelGrade.decision === 'approved' || camelGrade.decision === 'changes_requested')
      && typeof camelGrade.released === 'boolean'
      ? {
        rubricScores: record(camelGrade.rubricScores) as Record<string, number> ?? {},
        feedback: camelGrade.feedback as LocalizedLabel,
        decision: camelGrade.decision,
        released: camelGrade.released,
        passed: camelGrade.passed === true,
        totalPoints: Number(camelGrade.totalPoints ?? 0),
        maxPoints: Number(camelGrade.maxPoints ?? 0),
        gradedAt: String(camelGrade.gradedAt ?? ''),
      } satisfies SubmissionGrade
      : latestGrade(row.grades);
    return [{
      id,
      userId,
      learnerName: typeof row.learnerName === 'string' && row.learnerName
        ? row.learnerName
        : typeof profile?.display_name === 'string' && profile.display_name
        ? profile.display_name
        : typeof profile?.handle === 'string' && profile.handle ? `@${profile.handle}` : userId,
      branchId: typeof row.branchId === 'string'
        ? row.branchId
        : typeof profile?.branch_id === 'string' ? profile.branch_id : null,
      courseVersionId,
      courseId: assignment?.courseId ?? courseVersionId,
      courseTitle: assignment?.courseTitle ?? versionTitles?.courseTitle ?? courseVersionId,
      itemId,
      blockId,
      itemTitle: assignment?.itemTitle ?? versionTitles?.items[itemId] ?? itemId,
      assignmentId,
      attemptNo: attemptNo as number,
      status,
      submittedAt,
      dueAtSnapshot: typeof row.dueAtSnapshot === 'string' ? row.dueAtSnapshot : typeof row.due_at_snapshot === 'string' ? row.due_at_snapshot : null,
      late: typeof row.late === 'boolean' ? row.late : null,
      payload: {
        ...(typeof payload.text === 'string' ? { text: payload.text } : {}),
        ...(record(payload.notebook) && typeof record(payload.notebook)?.assetId === 'string' ? { notebook: payload.notebook as SubmissionQueueItem['payload']['notebook'] } : {}),
        ...(links?.length ? { links } : {}),
        ...(typeof code?.language === 'string' && typeof code.code === 'string'
          ? { code: { language: code.language, code: code.code } }
          : {}),
      },
      files,
      rubric: assignment?.rubric ?? { criteria: [] },
      ...(grade ? { grade } : {}),
    }];
  });
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function localized(value: LocalizedLabel, locale: string): string {
  if (typeof value === 'string') return value;
  return value[locale === 'vi' ? 'vi' : 'en'] ?? value.vi ?? value.en ?? '';
}

export function computeRubricTotal(
  rubric: InstructorRubric,
  scores: Record<string, number>,
): { total: number; max: number } {
  return {
    total: round2(rubric.criteria.reduce((sum, criterion) => {
      const value = scores[criterion.id];
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0)),
    max: round2(rubric.criteria.reduce((sum, criterion) => sum + criterion.maxPoints, 0)),
  };
}

export function RubricScoreEditor({
  rubric,
  scores,
  onChange,
  disabled = false,
}: {
  rubric: InstructorRubric;
  scores: Record<string, number>;
  onChange: (scores: Record<string, number>) => void;
  disabled?: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations('studio.grading');
  const total = computeRubricTotal(rubric, scores);
  const groupId = useId();
  // Persistence stores points only. Keep the clicked level identity locally when
  // several rubric levels award the same points; a reload cannot recover that choice.
  const [selectedLevels, setSelectedLevels] = useState<Record<string, number>>({});

  return (
    <div className="space-y-5">
      {rubric.criteria.length > 0 ? <CanvasProgressBar size="x-small" screenReaderLabel={locale === 'vi' ? 'Tiến độ chấm tiêu chí' : 'Criteria scoring progress'} renderValue={({ valueNow, valueMax }) => <span className="text-xs text-muted-foreground">{locale === 'vi' ? `Đã chấm ${valueNow}/${valueMax} tiêu chí` : `${valueNow} of ${valueMax} criteria scored`}</span>} valueMax={rubric.criteria.length} valueNow={rubric.criteria.filter(criterion => Number.isFinite(scores[criterion.id]) && scores[criterion.id] >= 0 && scores[criterion.id] <= criterion.maxPoints).length} /> : null}
      {rubric.criteria.map((criterion) => {
        const name = localized(criterion.name, locale);
        const localIndex = selectedLevels[criterion.id];
        const matchingLevels = criterion.levels?.flatMap((level, index) => level.points === scores[criterion.id] ? [index] : []) ?? [];
        const selectedIndex = localIndex !== undefined && criterion.levels?.[localIndex]?.points === scores[criterion.id]
          ? localIndex
          : matchingLevels.length === 1 ? matchingLevels[0] : -1;
        return (
          <fieldset key={criterion.id} className="rounded-lg border border-border p-4">
            <legend className="px-1 text-sm font-medium leading-normal">{name}</legend>
            <p className="mb-3 text-xs text-muted-foreground tabular-nums">{locale === 'vi' ? `Từ 0 đến ${criterion.maxPoints} điểm` : `0–${criterion.maxPoints} points`}</p>
            {criterion.description ? (
              <p className="mb-3 text-sm leading-normal text-muted-foreground">{localized(criterion.description, locale)}</p>
            ) : null}
            {selectedIndex < 0 && matchingLevels.length > 1 ? <p className="mb-3 text-xs text-muted-foreground">{locale === 'vi' ? `Điểm: ${scores[criterion.id]}. Nhiều mức rubric có cùng số điểm này; mức đã chọn không được lưu.` : `Score: ${scores[criterion.id]}. Several rubric levels award this score; the selected level was not stored.`}</p> : null}
            {criterion.levels?.length ? (
              <CanvasRadioInputGroup name={`${groupId}-${criterion.id}`} description={<span className="sr-only">{name}</span>} value={selectedIndex < 0 ? '' : String(selectedIndex)} disabled={disabled} onChange={(_event, value) => {
                const index = Number(value);
                const level = criterion.levels?.[index];
                if (!level) return;
                setSelectedLevels(current => ({ ...current, [criterion.id]: index }));
                onChange({ ...scores, [criterion.id]: level.points });
              }}>
                {criterion.levels.map((level, levelIndex) => <CanvasRadioInput key={levelIndex} id={`${groupId}-${criterion.id}-${levelIndex}`} value={String(levelIndex)} label={<span className="block min-w-0"><span className="block text-sm font-medium">{localized(level.label, locale)} · {level.points} / {criterion.maxPoints}</span>{level.description ? <span className="mt-1 block text-xs text-muted-foreground">{localized(level.description, locale)}</span> : null}</span>} />)}
              </CanvasRadioInputGroup>
            ) : (
              <CanvasNumberInput renderLabel={<span className="sr-only">{name} ({locale === 'vi' ? `0 đến ${criterion.maxPoints} điểm` : `0 to ${criterion.maxPoints} points`})</span>} messages={scores[criterion.id] !== undefined && (!Number.isFinite(scores[criterion.id]) || scores[criterion.id] < 0 || scores[criterion.id] > criterion.maxPoints) ? [{ type: 'error', text: locale === 'vi' ? `Nhập điểm từ 0 đến ${criterion.maxPoints}.` : `Enter a score from 0 to ${criterion.maxPoints}.` }] : undefined} min={0} max={criterion.maxPoints} step={0.01} showArrows={false} value={scores[criterion.id] ?? ''} interaction={disabled ? 'disabled' : 'enabled'} onChange={(_event, value) => { const next = { ...scores }; if (value === '') delete next[criterion.id]; else next[criterion.id] = Number(value); onChange(next); }} />
            )}
          </fieldset>
        );
      })}
      <p aria-live="polite" className="rounded-md bg-muted px-4 py-3 text-right text-lg font-semibold leading-normal tabular-nums">
        {t('scoreSummary', total)}
      </p>
    </div>
  );
}

export function SubmissionsTable({
  items,
  canGrade,
  detailHref,
  onGrade,
  selectedId,
  onPreview,
}: {
  items: SubmissionQueueItem[];
  canGrade: boolean;
  detailHref?: (item: SubmissionQueueItem) => string;
  onGrade?: (item: SubmissionQueueItem) => void;
  /** The row shown in the side preview (xl and up). */
  selectedId?: string | null;
  /** When given, a row click (or its preview button) previews the response beside the list. */
  onPreview?: (item: SubmissionQueueItem) => void;
}) {
  const locale = useLocale();
  const t = useTranslations('studio.grading');
  const home = useTranslations('staffUi.grading.home');
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  function previewFromRow(event: MouseEvent<Element>, item: SubmissionQueueItem) {
    // Links and buttons inside the row keep their own behaviour.
    if (!onPreview || (event.target as HTMLElement).closest('a,button')) return;
    // The preview pane only exists from xl (1280px); below it a row click would set invisible state.
    if (typeof window !== 'undefined' && window.matchMedia && !window.matchMedia('(min-width: 1280px)').matches) return;
    onPreview(item);
  }

  return <CanvasDataTable
    caption={t('title')}
    rows={items}
    rowKey={(item) => item.id}
    rowProps={(item) => ({
      'data-state': item.id === selectedId ? 'selected' : undefined,
      setHoverStateTo: item.id === selectedId ? true : undefined,
      onClick: onPreview ? (event) => previewFromRow(event, item) : undefined,
      className: onPreview ? 'xl:cursor-pointer' : undefined,
    })}
    columns={[
      { key: 'learner', label: t('table.learner'), render: (item) => item.learnerName },
      { key: 'assignment', label: t('table.courseItem'), render: (item) => <>
        <span className="block break-words font-medium">{item.courseTitle === item.courseVersionId ? home('unknownCourse') : item.courseTitle}</span>
        <span className="block break-words text-xs text-muted-foreground">{item.itemTitle === item.itemId ? home('unknownItem') : item.itemTitle}</span>
      </> },
      { key: 'attempt', label: t('table.attempt'), render: (item) => item.attemptNo },
      { key: 'submitted', label: t('table.submittedAt'), render: (item) => <time className="text-muted-foreground tabular-nums" dateTime={item.submittedAt}>{date.format(new Date(item.submittedAt))}</time> },
      { key: 'status', label: t('table.status'), render: (item) => <>
        <StatusBadge kind="submission" value={item.status} label={t(`status.${item.status}`)} />
        {item.late === true ? <span className="mt-1 block text-xs text-muted-foreground">{t('lateSnapshot')}</span> : null}
      </> },
      ...(canGrade ? [{ key: 'action', label: t('table.action'), render: (item: SubmissionQueueItem) => <div className="flex flex-wrap items-center gap-2">
        {detailHref
          ? <Button size="sm" variant="outline" href={detailHref(item)}>{t('gradeAction')}</Button>
          : <Button size="sm" variant="outline" onClick={() => onGrade?.(item)}>{t('gradeAction')}</Button>}
        {onPreview ? <Button variant="ghost" size="icon-sm" className="hidden xl:inline-flex" aria-label={home('queue.preview', { learner: item.learnerName })} aria-pressed={item.id === selectedId} data-preview-for={item.id} onClick={() => onPreview(item)}><Eye aria-hidden="true" /></Button> : null}
      </div> }] : []),
    ]}
  />;
}

function textContent(text: string): RichContent {
  return { blocks: [{ type: 'paragraph', content: [{ text }] }] };
}

function learnerRuntime(locale: 'vi' | 'en'): LessonRuntime {
  const unavailable = async () => { throw new Error('Learner interactions are unavailable in the grading view'); };
  return {
    mode: 'preview',
    locale,
    getBlockState: () => undefined,
    setBlockState: () => undefined,
    submitQuiz: unavailable,
    checkQuestion: unavailable,
    getAssignmentSession: () => undefined,
    refreshAssignmentSession: unavailable,
    submitAssignment: unavailable,
    uploadAssignmentFile: unavailable,
    uploadFile: unavailable,
    resolveMedia: (ref) => 'url' in ref ? ref.url : `/api/v1/media/${encodeURIComponent(ref.assetId)}`,
    hrefFor: (target) => target.kind === 'url' ? target.url : target.kind === 'resource'
      ? routes.learner.resource(target.id)
      : target.kind === 'opportunity' ? routes.learner.opportunity(target.id) : '#',
    markViewed: () => undefined,
    onActivityComplete: () => undefined,
  } as LessonRuntime;
}

export function SubmissionResponse({ item, hideHeading = false }: { item: SubmissionQueueItem; hideHeading?: boolean }) {
  const locale = useLocale() === 'vi' ? 'vi' : 'en';
  const t = useTranslations('studio.grading');
  const runtime = learnerRuntime(locale);
  const safeLinks = item.payload.links?.flatMap((link) => {
    const url = safeHttpsUrl(link.url);
    return url ? [{ ...link, url }] : [];
  }) ?? [];
  return (
    <section aria-label={t('response')} className="space-y-4">
      {!hideHeading ? <h3 className="text-base font-semibold">{t('response')}</h3> : null}
      {item.payload.notebook ? <NotebookSubmissionPreview key={item.id} submissionId={item.id} /> : null}
      {item.payload.text ? (
        <div className={hideHeading ? "max-w-prose py-2 text-base leading-relaxed" : "rounded-lg border border-border bg-background p-4"}>
          <RichContentView content={textContent(item.payload.text)} runtime={runtime} path="/submission/text" />
        </div>
      ) : null}
      {item.payload.code ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('code', { language: item.payload.code.language })}</p>
          <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-muted p-4 text-xs text-foreground"><code>{item.payload.code.code}</code></pre>
        </div>
      ) : null}
      {safeLinks.length ? (
        <div>
          <h4 className="text-sm font-semibold">{t('links')}</h4>
          <ul className="mt-2 space-y-2">
            {safeLinks.map((link) => (
              <li key={link.url}><a className="break-all text-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" href={link.url} target="_blank" rel="noopener noreferrer">{link.label ?? link.url}</a></li>
            ))}
          </ul>
        </div>
      ) : null}
      {item.files.length ? (
        <div>
          <h4 className="text-sm font-semibold">{t('files')}</h4>
          <ul className="mt-2 space-y-2">
            {item.files.map((file) => (
              <li key={file.assetId}>
                <a className="flex min-h-11 items-center gap-3 rounded-md border border-border px-3 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" href={`/api/v1/media/${encodeURIComponent(file.assetId)}`} target="_blank" rel="noopener noreferrer">
                  <FileText aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="text-xs text-muted-foreground">{t('fileSize', { size: file.size })}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!item.payload.notebook && !item.payload.text && !item.payload.code && !safeLinks.length && !item.files.length
        ? <p className="text-sm text-muted-foreground">{t('emptyResponse')}</p>
        : null}
    </section>
  );
}

/**
 * Assignment filter labels without raw ids: the item title (metadata, else the server-resolved
 * outline title), then the course title when two courses share it, then a running number when
 * one item holds several assignments.
 */
export function assignmentOptionLabels(
  choices: readonly AssignmentMetadata[],
  titles?: QueueTitles,
  fallbackLabels: { item: string; course: string } = { item: '', course: '' },
): Map<string, string> {
  const base = choices.map((assignment) => {
    const resolved = titles?.[assignment.courseVersionId.toLowerCase()];
    const item = assignment.itemTitle && assignment.itemTitle !== assignment.itemId && assignment.itemTitle !== assignment.assignmentId
      ? assignment.itemTitle
      : resolved?.items[assignment.itemId] ?? (fallbackLabels.item || assignment.itemTitle);
    const course = assignment.courseTitle && assignment.courseTitle !== assignment.courseId && assignment.courseTitle !== assignment.courseVersionId
      ? assignment.courseTitle
      : resolved?.courseTitle ?? (fallbackLabels.course || assignment.courseTitle);
    return { assignment, item, course };
  });
  const count = (values: string[]) => values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<string, number>());
  const byItem = count(base.map((entry) => entry.item));
  const withCourse = base.map((entry) => ({
    ...entry,
    label: (byItem.get(entry.item) ?? 0) > 1 && entry.course ? `${entry.item} · ${entry.course}` : entry.item,
  }));
  const byLabel = count(withCourse.map((entry) => entry.label));
  const seen = new Map<string, number>();
  return new Map(withCourse.map((entry) => {
    if ((byLabel.get(entry.label) ?? 0) < 2) return [entry.assignment.assignmentId, entry.label];
    const index = (seen.get(entry.label) ?? 0) + 1;
    seen.set(entry.label, index);
    return [entry.assignment.assignmentId, `${entry.label} (${index})`];
  }));
}

export function SubmissionsWorkspace({
  branches,
  courses,
  assignments,
  canGrade,
  embedded = false,
  titles,
}: {
  branches: BranchOption[];
  courses: CourseOption[];
  assignments: AssignmentMetadata[];
  canGrade: boolean;
  embedded?: boolean;
  titles?: QueueTitles;
}) {
  const t = useTranslations('studio.grading');
  const home = useTranslations('staffUi.grading.home');
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0].id : '');
  const [filtersReady,setFiltersReady]=useState(false);
  const initialized=useRef(false);
  const [courseId, setCourseId] = useState('');
  const [assignmentFilter, setAssignmentFilter] = useState('');
  const [status, setStatus] = useState('');
  useEffect(()=>{
    if(initialized.current)return;initialized.current=true;
    const q=new URLSearchParams(window.location.search);
    if(branches.some(b=>b.id===q.get('branchId')))setBranchId(q.get('branchId')!);
    if(courses.some(c=>c.id===q.get('courseId')))setCourseId(q.get('courseId')!);
    if(assignments.some(a=>a.assignmentId===q.get('assignmentId')))setAssignmentFilter(q.get('assignmentId')!);
    if((queueStatusFilters as readonly string[]).includes(q.get('status')??''))setStatus(q.get('status')!);
    setFiltersReady(true);
  },[branches,courses,assignments]);
  useEffect(()=>{
    if(!filtersReady)return;
    const q=new URLSearchParams(window.location.search);
    for(const [key,value] of Object.entries({branchId,courseId,assignmentId:assignmentFilter,status})){if(value)q.set(key,value);else q.delete(key);}
    window.history.replaceState(window.history.state,'',`${window.location.pathname}?${q}`);
  },[filtersReady,branchId,courseId,assignmentFilter,status]);

  const [items, setItems] = useState<SubmissionQueueItem[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewHeading = useRef<HTMLHeadingElement | null>(null);
  // Opening moves focus to the preview heading; closing returns it to the row's preview button.
  const lastPreview = useRef<string | null>(null);
  useEffect(() => {
    if (previewId) {
      lastPreview.current = previewId;
      previewHeading.current?.focus();
    } else if (lastPreview.current) {
      document.querySelector<HTMLButtonElement>(`[data-preview-for="${CSS.escape(lastPreview.current)}"]`)?.focus();
      lastPreview.current = null;
    }
  }, [previewId]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingMoreRef = useRef(false);
  const queueGenerationRef = useRef(0);
  const filter = { branchId, courseId, assignmentId: assignmentFilter, status };
  const filterKey = JSON.stringify(filter);
  const firstPageQuery = submissionQueueParams(filter).toString();
  const filterKeyRef = useRef(filterKey);
  filterKeyRef.current = filterKey;
  const loadErrorMessage = t('loadError');
  const assignmentChoices = [...new Map(assignments
    .filter((assignment) => !courseId || assignment.courseId === courseId)
    .map((assignment) => [assignment.assignmentId, assignment])).values()];
  const assignmentLabels = assignmentOptionLabels(assignmentChoices, titles, { item: home('unknownItem'), course: home('unknownCourse') });

  async function readPage(cursor?: string): Promise<SubmissionQueuePage> {
    const data = await readApiData<unknown>(await fetch(`/api/v1/studio/submissions?${submissionQueueParams(filter, cursor)}`));
    const page = record(data);
    if (!page || !Array.isArray(page.items) || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) {
      throw new Error('Invalid submission queue response');
    }
    return { items: page.items as SubmissionQueueSubmission[], nextCursor: page.nextCursor as string | null };
  }

  useEffect(() => {
    if(!filtersReady)return;
    const requestGeneration = ++queueGenerationRef.current;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    if (!canGrade || !branches.length) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setItems([]);
    setNextCursor(null);
    void fetch(`/api/v1/studio/submissions?${firstPageQuery}`, { signal: controller.signal })
      .then((response) => readApiData<unknown>(response))
      .then((data) => {
        if (queueGenerationRef.current !== requestGeneration) return;
        const page = record(data);
        if (!page || !Array.isArray(page.items) || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) {
          throw new Error('Invalid submission queue response');
        }
        setItems(normalizeSubmissionRows(page.items, assignments, titles));
        setNextCursor(page.nextCursor as string | null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && queueGenerationRef.current === requestGeneration) {
          setError(workspaceErrorMessage(cause, loadErrorMessage));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && queueGenerationRef.current === requestGeneration) setLoading(false);
      });
    return () => controller.abort();
  }, [assignments, titles, branches.length, canGrade, firstPageQuery, loadErrorMessage, filtersReady]);

  async function loadMore() {
    if (!nextCursor || loadingMoreRef.current) return;
    const requestGeneration = queueGenerationRef.current;
    const expectedFilter = filterKey;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await readPage(nextCursor);
      if (queueGenerationRef.current !== requestGeneration || filterKeyRef.current !== expectedFilter) return;
      const additions = normalizeSubmissionRows(page.items, assignments, titles);
      setItems((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        for (const item of additions) byId.set(item.id, item);
        return [...byId.values()];
      });
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (queueGenerationRef.current === requestGeneration && filterKeyRef.current === expectedFilter) {
        setError(workspaceErrorMessage(cause, loadErrorMessage));
      }
    } finally {
      if (queueGenerationRef.current === requestGeneration && filterKeyRef.current === expectedFilter) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }

  function chooseCourse(nextCourseId: string) {
    setCourseId(nextCourseId);
    if (assignmentFilter && !assignments.some((assignment) =>
      assignment.assignmentId === assignmentFilter && (!nextCourseId || assignment.courseId === nextCourseId))) {
      setAssignmentFilter('');
    }
  }

  const Title = embedded ? 'h2' : 'h1';
  const detailHref = (item: SubmissionQueueItem) => routes.grading.assignment(item.id, { branchId: item.branchId ?? undefined, courseId, assignmentId: assignmentFilter, status, back: routes.grading.queue(filter) });
  const preview = previewId ? items.find((item) => item.id === previewId) ?? null : null;
  const previewCourseTitle = preview ? preview.courseTitle === preview.courseVersionId ? home('unknownCourse') : preview.courseTitle : '';
  const previewItemTitle = preview ? preview.itemTitle === preview.itemId ? home('unknownItem') : preview.itemTitle : '';
  const unavailable = !canGrade || !branches.length;

  return (
    <div className="canvas-page mx-auto max-w-7xl min-w-0 space-y-6">
      {/* Inside the queue page the page header and tab already name this list: one header only,
          the h2 stays for the document outline. */}
      {embedded
        ? <Title tabIndex={embedded ? undefined : -1} className="sr-only">{t('title')}</Title>
        : <header className="border-b border-border pb-6">
          <p className="text-xs font-medium leading-normal text-muted-foreground">{t('eyebrow')}</p>
          <Title tabIndex={embedded ? undefined : -1} className="mt-1 text-2xl font-bold leading-[1.4] tracking-tight">{t('title')}</Title>
          <p className="mt-1 max-w-2xl text-sm leading-normal text-muted-foreground">{t('description')}</p>
        </header>}
      <div className={preview ? 'grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start' : undefined}>
        <DataCard
          aria-label={t('title')}
          toolbar={<section aria-label={t('filters.label')}>
            <h3 className="mb-4 flex items-center gap-2 text-sm font-medium leading-normal text-foreground"><ListFilter aria-hidden="true" className="size-4 text-muted-foreground" />{t('filters.label')}</h3>
            <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${preview ? 'lg:grid-cols-4 xl:grid-cols-2' : 'lg:grid-cols-4'}`}>
              <CanvasSelect label={t('filters.branch')} value={branchId} onChange={setBranchId} options={[...(branches.length > 1 ? [{ value: '', label: t('filters.allBranches') }] : []), ...branches.map(branch => ({ value: branch.id, label: branch.name }))]} />
              <CanvasSelect label={t('filters.course')} value={courseId} onChange={chooseCourse} options={[{ value: '', label: t('filters.allCourses') }, ...courses.map(course => ({ value: course.id, label: course.title }))]} />
              <CanvasSelect label={t('filters.assignment')} value={assignmentFilter} onChange={setAssignmentFilter} options={[{ value: '', label: t('filters.allAssignments') }, ...assignmentChoices.map(assignment => ({ value: assignment.assignmentId, label: assignmentLabels.get(assignment.assignmentId) ?? assignment.assignmentId }))]} />
              <CanvasSelect label={t('filters.status')} value={status} onChange={setStatus} options={[{ value: '', label: t('filters.allStatuses') }, ...queueStatusFilters.map(value => ({ value, label: value === 'pending' ? home('queue.statusPending') : t(`status.${value}`) }))]} />
            </div>
          </section>}
          footer={nextCursor ? <div className="flex justify-center"><Button variant="outline" className="max-sm:min-h-11 max-sm:w-full" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? t('loadingMore') : t('loadMore')}</Button></div> : undefined}
        >
          {unavailable ? <EmptyState icon={<Inbox />} title={t('noPermission')} className="m-4 sm:m-6" /> : null}
          {loading ? <p role="status" className="flex items-center gap-2 px-6 py-5 text-sm leading-normal text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />{t('loading')}</p> : null}
          {error ? <p role="alert" className="m-6 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-normal text-destructive-soft-foreground">{error}</p> : null}
          {!loading && !unavailable && !items.length && !error ? <EmptyState icon={<Inbox />} title={nextCursor ? home('queue.noMatchesYet') : t('empty')} className="m-4 sm:m-6" /> : null}
          {items.length ? <SubmissionsTable
            items={items}
            canGrade={canGrade}
            detailHref={detailHref}
            selectedId={preview?.id ?? null}
            onPreview={canGrade ? (item) => setPreviewId((current) => current === item.id ? null : item.id) : undefined}
          /> : null}
        </DataCard>
        {preview ? <aside aria-labelledby="submission-preview-title" className="hidden min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground xl:sticky xl:top-20 xl:flex">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-xs font-medium leading-normal text-muted-foreground">{home('queue.previewTitle')}</p>
              <h3 id="submission-preview-title" ref={previewHeading} tabIndex={-1} className="break-words text-base font-semibold leading-normal outline-none">{preview.learnerName}</h3>
              <p className="break-words text-sm leading-normal text-muted-foreground">{home('queue.previewMeta', { course: previewCourseTitle, item: previewItemTitle, attempt: preview.attemptNo })}</p>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label={home('queue.closePreview')} onClick={() => setPreviewId(null)}><X aria-hidden="true" /></Button>
          </div>
          <div><StatusBadge kind="submission" value={preview.status} label={t(`status.${preview.status}`)} /></div>
          <div className="max-h-[60vh] min-w-0 overflow-y-auto"><SubmissionResponse item={preview} /></div>
          <Button href={detailHref(preview)}>{home('queue.openWorkbench')}</Button>
        </aside> : null}
      </div>
    </div>
  );
}
