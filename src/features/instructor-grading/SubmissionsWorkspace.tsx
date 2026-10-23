'use client';
import { NotebookSubmissionPreview } from '@/features/notebooks/ui/NotebookSubmissionPreview';
import Link from 'next/link';

import { Eye, FileText, Inbox, ListFilter, LoaderCircle, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type MouseEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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

  return (
    <div className="space-y-5">
      {rubric.criteria.map((criterion) => {
        const name = localized(criterion.name, locale);
        return (
          <fieldset key={criterion.id} className="rounded-lg border border-border p-4">
            <legend className="px-1 text-sm font-medium leading-normal">{name}</legend>
            {criterion.description ? (
              <p className="mb-3 text-sm leading-normal text-muted-foreground">{localized(criterion.description, locale)}</p>
            ) : null}
            {criterion.levels?.length ? (
              <RadioGroup
                aria-label={name}
                className="gap-2"
                value={scores[criterion.id] === undefined ? '' : String(scores[criterion.id])}
                onValueChange={(value) => onChange({ ...scores, [criterion.id]: Number(value) })}
                disabled={disabled}
              >
                {criterion.levels.map((level, levelIndex) => {
                  const label = localized(level.label, locale);
                  const id = `rubric-${criterion.id}-${levelIndex}`;
                  return (
                    <label key={id} htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border p-3 transition-colors hover:bg-accent has-[[data-state=checked]]:border-primary motion-reduce:transition-none">
                      <RadioGroupItem aria-label={label} id={id} value={String(level.points)} className="mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3 text-sm font-medium leading-normal"><span>{label}</span><span className="shrink-0 tabular-nums">{level.points} / {criterion.maxPoints}</span></span>
                        {level.description ? <span className="mt-1 block text-xs leading-normal text-muted-foreground">{localized(level.description, locale)}</span> : null}
                      </span>
                    </label>
                  );
                })}
              </RadioGroup>
            ) : (
              <Input
                aria-label={name}
                type="number"
                min={0}
                max={criterion.maxPoints}
                step="0.01"
                className="tabular-nums"
                value={scores[criterion.id] ?? ''}
                disabled={disabled}
                onChange={(event) => {
                  const next={...scores};
                  if(event.target.value==='')delete next[criterion.id];else next[criterion.id]=Number(event.target.value);
                  onChange(next);
                }}
              />
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

  function previewFromRow(event: MouseEvent<HTMLTableRowElement>, item: SubmissionQueueItem) {
    // Links and buttons inside the row keep their own behaviour.
    if (!onPreview || (event.target as HTMLElement).closest('a,button')) return;
    // The preview pane only exists from xl (1280px); below it a row click would set invisible state.
    if (typeof window !== 'undefined' && window.matchMedia && !window.matchMedia('(min-width: 1280px)').matches) return;
    onPreview(item);
  }

  return (
    <Table className="max-md:block" containerClassName="max-md:overflow-visible">
      <TableHeader className="max-md:hidden">
        <TableRow className="hover:bg-transparent">
          <TableHead scope="col">{t('table.learner')}</TableHead>
          <TableHead scope="col">{t('table.courseItem')}</TableHead>
          <TableHead scope="col" className="hidden lg:table-cell">{t('table.attempt')}</TableHead>
          <TableHead scope="col" className="hidden sm:table-cell">{t('table.submittedAt')}</TableHead>
          <TableHead scope="col">{t('table.status')}</TableHead>
          {canGrade ? <TableHead scope="col">{t('table.action')}</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody className="max-md:block">
        {items.map((item) => {
          const selected = item.id === selectedId;
          const courseTitle = item.courseTitle === item.courseVersionId ? home('unknownCourse') : item.courseTitle;
          const itemTitle = item.itemTitle === item.itemId ? home('unknownItem') : item.itemTitle;
          return (
            <TableRow
              key={item.id}
              data-state={selected ? 'selected' : undefined}
              onClick={onPreview ? (event) => previewFromRow(event, item) : undefined}
              className={`${onPreview ? 'xl:cursor-pointer ' : ''}max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-2 max-md:px-4 max-md:py-4 max-md:[&>td]:!h-auto max-md:[&>td]:!p-0`}
            >
              <TableCell className="min-w-28 whitespace-normal font-medium leading-normal max-md:col-start-1 max-md:row-start-1 max-md:min-w-0 max-md:break-words"><span className="sr-only md:hidden">{t('table.learner')}: </span>{item.learnerName}</TableCell>
              <TableCell className="whitespace-normal py-3 md:min-w-48 max-md:col-span-2 max-md:row-start-2 max-md:min-w-0"><span className="sr-only md:hidden">{t('table.courseItem')}: </span><span className="block break-words font-medium leading-normal">{courseTitle}</span><span className="block break-words text-xs leading-normal text-muted-foreground">{itemTitle}</span></TableCell>
              <TableCell className="hidden tabular-nums lg:table-cell max-md:col-start-1 max-md:row-start-3 max-md:!block max-md:text-xs max-md:text-muted-foreground"><span className="md:hidden">{t('table.attempt')} </span>{item.attemptNo}</TableCell>
              <TableCell className="hidden whitespace-nowrap text-muted-foreground tabular-nums sm:table-cell max-md:col-start-2 max-md:row-start-3 max-md:!block max-md:whitespace-normal max-md:text-right max-md:text-xs"><span className="sr-only md:hidden">{t('table.submittedAt')}: </span>{date.format(new Date(item.submittedAt))}</TableCell>
              <TableCell className="max-md:col-start-2 max-md:row-start-1 max-md:justify-self-end"><StatusBadge kind="submission" value={item.status} label={t(`status.${item.status}`)} /></TableCell>
              {canGrade ? <TableCell className="max-md:col-span-2 max-md:row-start-4 max-md:pt-2">
                <div className="flex items-center gap-2">
                  {/* Outline, not primary: one black primary per page, never one per row. */}
                  {detailHref
                    ? <Button asChild size="sm" variant="outline" className="max-md:min-h-11 max-md:w-full"><Link href={detailHref(item)}>{t('gradeAction')}</Link></Button>
                    : <Button size="sm" variant="outline" className="max-md:min-h-11 max-md:w-full" onClick={() => onGrade?.(item)}>{t('gradeAction')}</Button>}
                  {onPreview ? <Button
                    variant="ghost"
                    size="icon-sm"
                    className="hidden xl:inline-flex"
                    aria-label={home('queue.preview', { learner: item.learnerName })}
                    aria-pressed={selected}
                    data-preview-for={item.id}
                    onClick={() => onPreview(item)}
                  ><Eye aria-hidden="true" /></Button> : null}
                </div>
              </TableCell> : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
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

export function SubmissionResponse({ item }: { item: SubmissionQueueItem }) {
  const locale = useLocale() === 'vi' ? 'vi' : 'en';
  const t = useTranslations('studio.grading');
  const runtime = learnerRuntime(locale);
  const safeLinks = item.payload.links?.flatMap((link) => {
    const url = safeHttpsUrl(link.url);
    return url ? [{ ...link, url }] : [];
  }) ?? [];
  return (
    <section aria-labelledby="submission-response-title" className="space-y-4">
      <h3 id="submission-response-title" className="text-base font-semibold">{t('response')}</h3>
      {item.payload.notebook ? <NotebookSubmissionPreview key={item.id} submissionId={item.id} /> : null}
      {item.payload.text ? (
        <div className="rounded-lg border border-border bg-background p-4">
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
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Inside the queue page the page header and tab already name this list: one header only,
          the h2 stays for the document outline. */}
      {embedded
        ? <Title className="sr-only">{t('title')}</Title>
        : <header className="border-b border-border pb-6">
          <p className="text-xs font-medium leading-normal text-muted-foreground">{t('eyebrow')}</p>
          <Title className="mt-1 text-2xl font-bold leading-[1.4] tracking-tight">{t('title')}</Title>
          <p className="mt-1 max-w-2xl text-sm leading-normal text-muted-foreground">{t('description')}</p>
        </header>}
      <div className={preview ? 'grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start' : undefined}>
        <DataCard
          aria-label={t('title')}
          toolbar={<section aria-label={t('filters.label')}>
            <h3 className="mb-4 flex items-center gap-2 text-sm font-medium leading-normal text-foreground"><ListFilter aria-hidden="true" className="size-4 text-muted-foreground" />{t('filters.label')}</h3>
            <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${preview ? 'lg:grid-cols-4 xl:grid-cols-2' : 'lg:grid-cols-4'}`}>
              <label className="grid min-w-0 gap-1.5 text-xs font-medium leading-normal text-muted-foreground" htmlFor="submission-branch-filter">
                <span>{t('filters.branch')}</span>
                <NativeSelect id="submission-branch-filter" className="min-h-11" wrapperClassName="w-full" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                  {branches.length > 1 ? <NativeSelectOption value="">{t('filters.allBranches')}</NativeSelectOption> : null}
                  {branches.map((branch) => <NativeSelectOption key={branch.id} value={branch.id}>{branch.name}</NativeSelectOption>)}
                </NativeSelect>
              </label>
              <label className="grid min-w-0 gap-1.5 text-xs font-medium leading-normal text-muted-foreground" htmlFor="submission-course-filter">
                <span>{t('filters.course')}</span>
                <NativeSelect id="submission-course-filter" className="min-h-11" wrapperClassName="w-full" value={courseId} onChange={(event) => chooseCourse(event.target.value)}>
                  <NativeSelectOption value="">{t('filters.allCourses')}</NativeSelectOption>
                  {courses.map((course) => <NativeSelectOption key={course.id} value={course.id}>{course.title}</NativeSelectOption>)}
                </NativeSelect>
              </label>
              <label className="grid min-w-0 gap-1.5 text-xs font-medium leading-normal text-muted-foreground" htmlFor="submission-assignment-filter">
                <span>{t('filters.assignment')}</span>
                <NativeSelect id="submission-assignment-filter" className="min-h-11" wrapperClassName="w-full" value={assignmentFilter} onChange={(event) => setAssignmentFilter(event.target.value)}>
                  <NativeSelectOption value="">{t('filters.allAssignments')}</NativeSelectOption>
                  {assignmentChoices.map((assignment) => <NativeSelectOption key={`${assignment.courseId}:${assignment.assignmentId}`} value={assignment.assignmentId}>{assignmentLabels.get(assignment.assignmentId)}</NativeSelectOption>)}
                </NativeSelect>
              </label>
              <label className="grid min-w-0 gap-1.5 text-xs font-medium leading-normal text-muted-foreground" htmlFor="submission-status-filter">
                <span>{t('filters.status')}</span>
                <NativeSelect id="submission-status-filter" className="min-h-11" wrapperClassName="w-full" value={status} onChange={(event) => setStatus(event.target.value)}>
                  <NativeSelectOption value="">{t('filters.allStatuses')}</NativeSelectOption>
                  {queueStatusFilters.map((value) => <NativeSelectOption key={value} value={value}>{value === 'pending' ? home('queue.statusPending') : t(`status.${value}`)}</NativeSelectOption>)}
                </NativeSelect>
              </label>
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
          <Button asChild><Link href={detailHref(preview)}>{home('queue.openWorkbench')}</Link></Button>
        </aside> : null}
      </div>
    </div>
  );
}
