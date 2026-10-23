import 'server-only';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { AssignmentGradingSettings, GradingItem } from '@/content-engine/compile';
import type { AssignmentPayload } from '@/content-engine/render/runtime';
import { SubmissionSpecSchema } from '@/content-engine/schema/activities';
import { IdSchema } from '@/content-engine/schema/common';
import { NotebookAssignmentSchema, type NotebookAssignment } from '@/content-engine/schema/notebook';
import { RubricSchema, type Rubric } from '@/content-engine/schema/questions/base';
import { safeMediaFilename } from '@/features/media/upload';
import {
  validateNotebookSubmissionArtifact,
  type NotebookSubmissionArtifact,
} from '@/features/notebooks/contracts';
import { permitsAssignmentSubmission } from '@/features/media/rate-limit';
import { assertEnrollmentMembershipAccess } from '@/features/learning/membership-access';
import { recompute } from '@/features/progress/service';
import { onAssignmentApproved } from '@/features/skills/service';
import { ApiError } from '@/lib/api';
import { audit as writeAudit } from '@/lib/audit';
import {
  allowedBranchIds,
  type Actor,
  type Permission,
} from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import { submissionAuditSnapshot } from './audit-snapshot';
import { allowedSubmissionUrl } from './constraints';
import {
  assignmentId,
  QUEUE_STATUS_FILTERS,
  type QueueStatusFilter,
  type AssignmentAction,
  type AssignmentLocator,
  type AssignmentSessionResult,
  type AssignmentSubmitResult,
  type LearnerAssignmentSubmission,
  type LearnerReleasedGrade,
  type LearnerSubmissionFile,
  type LearnerSubmissionStatus,
  type SubmissionQueueFilter,
  type SubmissionQueueGrade,
  type SubmissionQueuePage,
  type SubmissionQueueSubmission,
} from './contracts';
import { canGradeSubmissionBranch } from './permissions';

export { submissionAuditSnapshot } from './audit-snapshot';

type QueryResult = { data: unknown; error: unknown | null };

export interface SubmissionQuery extends PromiseLike<QueryResult> {
  select(columns: string): this;
  insert(value: unknown): this;
  update(value: unknown): this;
  upsert(value: unknown, options?: unknown): this;
  delete(): this;
  eq(column: string, value: unknown): this;
  in(column: string, values: unknown[]): this;
  is(column: string, value: null): this;
  or(filters: string): this;
  order(column: string, options?: unknown): this;
  limit(value: number): this;
  maybeSingle(): Promise<QueryResult>;
  single(): Promise<QueryResult>;
}

export interface SubmissionDatabase {
  from(table: string): SubmissionQuery;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
}

export interface ProgressHooks {
  recompute(actor: Actor, courseId: string): Promise<void>;
  onAssignmentApproved?(input: {
    userId: string;
    submissionId: string;
    skills: readonly string[];
  }): Promise<void>;
  awardXp?(effect: {
    userId: string;
    courseVersionId: string;
    itemId: string;
    assignmentId: string;
    submissionId: string;
  }): Promise<void>;
}

export const NOOP_PROGRESS_HOOKS: ProgressHooks = {
  async recompute() {},
  async onAssignmentApproved() {},
};

type AuditWriter = typeof writeAudit;

export type SubmissionServiceDependencies = {
  database: SubmissionDatabase;
  hooks?: ProgressHooks;
  audit?: AuditWriter;
  now?: () => Date;
  verifyNotebookArtifact?: (input: {
    actor: Actor;
    locator: AssignmentLocator;
    courseVersionId: string;
    assignment: NotebookAssignment;
    assetId: string;
  }) => Promise<NotebookSubmissionArtifact | null>;
};

const SubmissionFileSchema = z.object({
  assetId: z.string().min(1).max(80),
  name: z.string().min(1).max(255),
  size: z.number().int().min(0),
  mime: z.string().min(1).max(200),
}).strict();

export const NotebookSubmissionPayloadSchema = z.object({
  assetId: z.string().min(1).max(80),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  format: z.literal('ipynb'),
  templateChecksum: z.string().regex(/^[0-9a-f]{64}$/),
  runtimeProfileId: z.string().min(1).max(80).optional(),
  runtimeProfileVersion: z.string().min(1).max(40).optional(),
}).strict();

export const SubmissionPayloadSchema = z.object({
  text: z.string().trim().min(1).max(100_000).optional(),
  links: z.array(z.object({
    url: z.string().url().max(2_048).refine((url) => url.startsWith('https://'), 'Link must use HTTPS'),
    label: z.string().trim().min(1).max(200).optional(),
  }).strict()).min(1).max(20).optional(),
  files: z.array(SubmissionFileSchema).min(1).max(10).optional(),
  code: z.object({
    language: z.string().min(1).max(40),
    code: z.string().min(1).max(500_000),
  }).strict().optional(),
  notebook: NotebookSubmissionPayloadSchema.optional(),
}).strict().refine(
  ({ text, links, files, code, notebook }) => Boolean(text || links?.length || files?.length || code?.code.trim() || notebook),
  { message: 'Submission must contain at least one accepted response' },
);

export { QUEUE_STATUS_FILTERS, type QueueStatusFilter } from './contracts';

/**
 * Effective statuses whose stored `status` column is a reliable pre-filter. `in_review` and
 * `pending` are derived from the grade rows too (an unreleased draft on an `approved` row reads
 * as in review), so they are filtered only after fetching.
 */
const DATABASE_STATUS_FILTERS = new Set<QueueStatusFilter>(['submitted', 'approved', 'changes_requested']);
/**
 * Stored statuses that can still be waiting on a grader. Grading writes `in_review` for a draft
 * and the decision only on release (grade_assignment_submission_guarded), so a stored
 * approved/changes_requested row is a released one. `pending` is narrowed to these in the
 * database (otherwise the oldest-first scan reads only long-released rows); the post-fetch
 * effective-status and released-approval filters still run as a safety net.
 */
const WAITING_STORED_STATUSES = ['submitted', 'in_review'] as const;
const QUEUE_PAGE_SIZE = 50;
/** A post-fetch status filter reads at most this many database pages to fill one queue page. */
const QUEUE_MAX_SCANS = 4;

export const QueueFilterSchema = z.object({
  branchId: z.string().min(1).max(100).optional(),
  courseId: IdSchema.optional(),
  assignmentId: IdSchema.optional(),
  status: z.enum(QUEUE_STATUS_FILTERS).optional(),
  cursor: z.string().min(1).max(512).optional(),
}).strict();

const LocalizedFeedbackSchema = z.object({
  vi: z.string().max(20_000).optional(),
  en: z.string().max(20_000).optional(),
}).strict().refine(({ vi, en }) => vi !== undefined || en !== undefined, 'Feedback needs vi or en');

export const GradeSubmissionSchema = z.object({
  rubricScores: z.record(z.string().min(1).max(64), z.number().finite().min(0)),
  feedback: z.union([z.string().max(20_000), LocalizedFeedbackSchema]),
  decision: z.enum(['approved', 'changes_requested']),
  release: z.boolean(),
}).strict();

export type GradeSubmissionInput = z.infer<typeof GradeSubmissionSchema>;

type SubmissionRow = {
  id: string;
  userId: string;
  courseVersionId: string;
  itemId: string;
  blockId: string | null;
  attemptNo: number;
  status: LearnerSubmissionStatus;
};

type AssignmentContext = {
  courseVersionId: string;
  settings: AssignmentGradingSettings;
  enrollment: Record<string,unknown>;
};

type StoredAsset = {
  id: string;
  mime: string;
  sizeBytes: number;
};

type AssignmentUploadMetadata = {
  size: number;
  mime: string;
};

const submissionStatuses = new Set<LearnerSubmissionStatus>([
  'submitted',
  'in_review',
  'approved',
  'changes_requested',
]);
const MAX_ASSIGNMENT_ATTEMPTS = 20;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function databaseFailure(message: string): never {
  throw new ApiError(500, 'SUBMISSIONS_DATABASE_ERROR', message);
}

function parsedSubmissionRow(value: unknown): SubmissionRow | null {
  const row = record(value);
  const status = stringValue(row?.status);
  if (!row
    || !stringValue(row.id)
    || !stringValue(row.user_id)
    || !stringValue(row.course_version_id)
    || !stringValue(row.item_id)
    || !Number.isSafeInteger(row.attempt_no)
    || !status
    || !submissionStatuses.has(status as LearnerSubmissionStatus)) return null;
  return {
    id: row.id as string,
    userId: row.user_id as string,
    courseVersionId: row.course_version_id as string,
    itemId: row.item_id as string,
    blockId: typeof row.block_id === 'string' ? row.block_id : null,
    attemptNo: row.attempt_no as number,
    status: status as LearnerSubmissionStatus,
  };
}

function assignmentSettings(value: unknown): AssignmentGradingSettings | null {
  const settings = record(value);
  if (!settings) return null;
  const submission = SubmissionSpecSchema.safeParse(settings.submission);
  const resubmission = settings.resubmission ?? 'until_approved';
  const notebook = settings.notebook === undefined ? null : NotebookAssignmentSchema.safeParse(settings.notebook);
  if (!submission.success
    || (notebook !== null && !notebook.success)
    || !['until_approved', 'once', 'never'].includes(String(resubmission))
    || (settings.passPoints !== undefined
      && (typeof settings.passPoints !== 'number' || !Number.isFinite(settings.passPoints) || settings.passPoints < 0))) {
    return null;
  }
  return {
    submission: submission.data,
    ...(notebook?.success ? { notebook: notebook.data } : {}),
    ...(typeof settings.passPoints === 'number' ? { passPoints: settings.passPoints } : {}),
    ...(Array.isArray(settings.skills)
      ? { skills: settings.skills.filter((skill): skill is string => typeof skill === 'string') }
      : {}),
    resubmission: resubmission as AssignmentGradingSettings['resubmission'],
  };
}

export const parseAssignmentGradingSettings = assignmentSettings;

function gradingItem(value: unknown): GradingItem | null {
  const grading = record(value);
  if (!grading || !record(grading.rubrics) || !record(grading.assignments)) return null;
  return grading as unknown as GradingItem;
}

export const parseSubmissionGradingItem = gradingItem;

function isUniqueViolation(error: unknown): boolean {
  return record(error)?.code === '23505';
}

function isNamedDatabaseError(error: unknown, name: string): boolean {
  const details = record(error);
  return [details?.message, details?.details, details?.hint]
    .some((value) => typeof value === 'string' && value.includes(name));
}

function pathForOwnedAsset(userId: string, path: unknown): boolean {
  if (typeof path !== 'string' || !path.startsWith(`${userId}/`)) return false;
  return path.split('/').every((segment) => segment !== '.' && segment !== '..');
}

function assignmentRubric(grading: GradingItem, assignmentId: string): Rubric | null {
  const raw = grading.rubrics[assignmentId];
  if (raw === undefined) return null;
  const parsed = RubricSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(500, 'SUBMISSION_CONFIG_INVALID', 'Assignment grading configuration is invalid');
  return parsed.data;
}

function permissionBranches(actor: Actor, permission: Permission): string[] {
  return allowedBranchIds(actor, permission);
}

function historicalBranch(row: Record<string, unknown> | null): string | null | undefined {
  if (!row || typeof row.branch_scope_known !== 'boolean') return undefined;
  if (!row.branch_scope_known) return null;
  return typeof row.branch_id === 'string' && row.branch_id.length > 0
    ? row.branch_id
    : undefined;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function filesOf(value: unknown): LearnerSubmissionFile[] | null {
  if (!Array.isArray(value)) return [];
  const files: LearnerSubmissionFile[] = [];
  for (const entry of value) {
    const file = record(entry);
    const assetId = stringValue(file?.asset_id);
    const name = stringValue(file?.name);
    const mime = stringValue(file?.mime);
    const size = finiteNumber(file?.size_bytes);
    if (!assetId || !name || !mime || size === null || !Number.isSafeInteger(size)) return null;
    files.push({ assetId, name, size, mime });
  }
  return files;
}

function storedPayload(value: unknown, files: LearnerSubmissionFile[]): AssignmentPayload | null {
  const payload = record(value);
  if (!payload) return null;
  const parsed = SubmissionPayloadSchema.safeParse({
    ...payload,
    ...(files.length ? { files } : {}),
  });
  return parsed.success ? parsed.data : null;
}

function gradeRecord(value: unknown): Record<string, unknown> | null {
  const candidates: Record<string, unknown>[] = (Array.isArray(value) ? value : [value])
    .flatMap((entry) => {
      const parsed = record(entry);
      return parsed ? [parsed] : [];
    })
    .sort((left, right) => String(right.graded_at ?? '').localeCompare(String(left.graded_at ?? '')));
  return candidates[0] ?? null;
}

function parsedGrade(value: unknown): SubmissionQueueGrade | null {
  const grade = gradeRecord(value);
  if (!grade || (grade.decision !== 'approved' && grade.decision !== 'changes_requested')
    || typeof grade.released !== 'boolean' || typeof grade.passed !== 'boolean') return null;
  const totalPoints = finiteNumber(grade.total_points);
  const maxPoints = finiteNumber(grade.max_points);
  const gradedAt = stringValue(grade.graded_at);
  const feedback = typeof grade.feedback === 'string'
    ? grade.feedback
    : LocalizedFeedbackSchema.safeParse(grade.feedback);
  if (totalPoints === null || maxPoints === null || !gradedAt
    || (typeof feedback !== 'string' && !feedback.success)) return null;
  const scores = record(grade.rubric_scores) ?? {};
  const rubricScores = Object.fromEntries(Object.entries(scores).flatMap(([key, raw]) => {
    const score = finiteNumber(raw);
    return score === null ? [] : [[key, score]];
  }));
  return {
    rubricScores,
    feedback: typeof feedback === 'string' ? feedback : feedback.data,
    decision: grade.decision,
    passed: grade.passed,
    totalPoints,
    maxPoints,
    gradedAt,
    released: grade.released,
  };
}

function effectiveSubmissionStatus(
  rawStatus: LearnerSubmissionStatus,
  grades: unknown,
): LearnerSubmissionStatus {
  const grade = parsedGrade(grades);
  if (grade?.released) return grade.decision;
  if (gradeRecord(grades) || rawStatus === 'approved' || rawStatus === 'changes_requested') return 'in_review';
  return rawStatus;
}

function learnerSubmission(value: unknown): LearnerAssignmentSubmission | null {
  const row = record(value);
  if (!row) return null;
  const submissionId = stringValue(row?.id);
  const submittedAt = stringValue(row?.submitted_at);
  const rawStatus = stringValue(row?.status);
  const files = filesOf(row?.submission_files);
  if (!submissionId || !submittedAt || !Number.isSafeInteger(row?.attempt_no) || !rawStatus
    || !submissionStatuses.has(rawStatus as LearnerSubmissionStatus) || !files) return null;
  const payload = storedPayload(row?.payload, files);
  if (!payload) return null;
  const grade = parsedGrade(row?.grades);
  const releasedGrade: LearnerReleasedGrade | undefined = grade?.released ? { ...grade, released: true } : undefined;
  const status = effectiveSubmissionStatus(rawStatus as LearnerSubmissionStatus, row?.grades);
  return {
    submissionId,
    attemptNo: row.attempt_no as number,
    status,
    submittedAt,
    payload,
    files,
    ...(releasedGrade ? { grade: releasedGrade } : {}),
  };
}

function queueSubmission(value: unknown): SubmissionQueueSubmission | null {
  const row = record(value);
  const parsed = parsedSubmissionRow(row);
  const submittedAt = stringValue(row?.submitted_at);
  const files = filesOf(row?.submission_files);
  const profile = Array.isArray(row?.profiles) ? record(row.profiles[0]) : record(row?.profiles);
  const branchId = historicalBranch(row);
  if (!parsed || !submittedAt || !files || branchId === undefined) return null;
  const payload = storedPayload(row?.payload, files);
  if (!payload) return null;
  const displayName = stringValue(profile?.display_name);
  const handle = stringValue(profile?.handle);
  const grade = parsedGrade(row?.grades);
  return {
    id: parsed.id,
    userId: parsed.userId,
    learnerName: displayName ?? (handle ? `@${handle}` : parsed.userId),
    branchId,
    courseVersionId: parsed.courseVersionId,
    itemId: parsed.itemId,
    blockId: parsed.blockId,
    assignmentId: parsed.blockId ?? parsed.itemId,
    attemptNo: parsed.attemptNo,
    status: effectiveSubmissionStatus(parsed.status, row?.grades),
    submittedAt,
    payload,
    files,
    ...(grade ? { grade } : {}),
  };
}

export const parseSubmissionQueueSubmission = queueSubmission;

const QueueCursorSchema = z.object({
  submittedAt: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
}).strict();

function decodeQueueCursor(value: string | undefined): z.infer<typeof QueueCursorSchema> | null {
  if (!value) return null;
  try {
    return QueueCursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new ApiError(400, 'INVALID_CURSOR', 'Submission queue cursor is invalid');
  }
}

/** The queue's keyset cursor: base64url JSON of the last item's submittedAt + id. */
export function encodeQueueCursor(value: { submittedAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function normalizedPayload(
  payload: z.infer<typeof SubmissionPayloadSchema>,
  notebook?: z.infer<typeof NotebookSubmissionPayloadSchema>,
): Omit<AssignmentPayload, 'files'> {
  return {
    ...(payload.text !== undefined ? { text: payload.text } : {}),
    ...(payload.links !== undefined ? { links: payload.links } : {}),
    ...(payload.code !== undefined ? { code: payload.code } : {}),
    ...(notebook !== undefined ? { notebook } : {}),
  };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function runPostCommitEffects(
  effects: Array<{ name: string; run: () => Promise<void> }>,
  context: Record<string, string>,
) {
  for (const effect of effects) {
    try {
      await effect.run();
    } catch (error) {
      // The mutation is already durable. Returning an error here would invite
      // a client retry and duplicate attempts; reconciliation handles outages.
      const correlationId = randomUUID();
      console.error(`[submission-effect:${correlationId}] Post-commit effect failed`, {
        effect: effect.name,
        ...context,
        error: error instanceof Error ? error.message : 'Unknown hook error',
      });
    }
  }
}

export function createSubmissionsService(dependencies: SubmissionServiceDependencies) {
  const database = dependencies.database;
  const hooks = { ...NOOP_PROGRESS_HOOKS, ...dependencies.hooks };
  // The grading RPC writes the durable audit entry transactionally. This
  // optional observer preserves the Actor-aware hook used by tests/integrators.
  const audit = dependencies.audit ?? (async () => {});
  const now = dependencies.now ?? (() => new Date());

  async function defaultNotebookArtifact(assetId: string): Promise<NotebookSubmissionArtifact | null> {
    const result = await database.from('notebook_artifacts')
      .select('id,owner_id,course_id,course_version_id,item_id,block_id,purpose,status,checksum,template_asset_id,template_checksum,runtime_profile_id,runtime_profile_version,size_bytes,mime,filename,storage_path')
      .eq('id', assetId)
      .maybeSingle();
    if (result.error) databaseFailure('Unable to validate notebook artifact');
    const row = record(result.data);
    if (!row) return null;
    const required = ['id', 'owner_id', 'course_id', 'item_id', 'purpose', 'status', 'checksum', 'runtime_profile_id', 'runtime_profile_version', 'mime', 'filename', 'storage_path'] as const;
    if (required.some((field) => !stringValue(row[field]))) return null;
    const sizeBytes = finiteNumber(row.size_bytes);
    if (sizeBytes === null || !Number.isSafeInteger(sizeBytes)) return null;
    return {
      id: row.id as string,
      ownerId: row.owner_id as string,
      courseId: row.course_id as string,
      courseVersionId: typeof row.course_version_id === 'string' ? row.course_version_id : null,
      itemId: row.item_id as string,
      blockId: typeof row.block_id === 'string' ? row.block_id : null,
      purpose: row.purpose as NotebookSubmissionArtifact['purpose'],
      status: row.status as NotebookSubmissionArtifact['status'],
      checksum: row.checksum as string,
      templateAssetId: typeof row.template_asset_id === 'string' ? row.template_asset_id : null,
      templateChecksum: typeof row.template_checksum === 'string' ? row.template_checksum : null,
      runtimeProfileId: row.runtime_profile_id as string,
      runtimeProfileVersion: row.runtime_profile_version as string,
      sizeBytes,
      mime: row.mime as string,
      filename: row.filename as string,
      storagePath: row.storage_path as string,
    };
  }

  async function loadAssignment(
    actor: Actor,
    locator: AssignmentLocator,
    enforceMembership=false,
  ): Promise<AssignmentContext> {
    const enrollmentResult = await database.from('enrollments')
      .select('course_version_id,status,branch_id,branch_scope_known')
      .eq('user_id', actor.userId)
      .eq('course_id', locator.courseId)
      .in('status', ['active', 'completed'])
      .maybeSingle();
    if (enrollmentResult.error) databaseFailure('Unable to load enrollment');
    const enrollment=record(enrollmentResult.data);
    const courseVersionId = stringValue(enrollment?.course_version_id);
    if (!courseVersionId) throw new ApiError(403, 'NOT_ENROLLED', 'An active enrollment is required');
    if(enforceMembership)await assertEnrollmentMembershipAccess(actor,enrollment!,database);

    const itemResult = await database.from('course_version_items')
      .select('kind,grading')
      .eq('version_id', courseVersionId)
      .eq('item_id', locator.itemId)
      .maybeSingle();
    if (itemResult.error) databaseFailure('Unable to load assignment');
    const item = record(itemResult.data);
    const grading = gradingItem(item?.grading);
    const settings = assignmentSettings(grading?.assignments?.[assignmentId(locator)]);
    if (!item || !grading || !settings) {
      throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found in the enrolled course version');
    }
    if ((item.kind === 'assignment' && locator.blockId !== null)
      || (item.kind !== 'assignment' && locator.blockId === null)) {
      throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found in the enrolled course version');
    }
    return { courseVersionId, settings, enrollment:enrollment! };
  }

  async function loadSessionForContext(
    actor: Actor,
    locator: AssignmentLocator,
    context: AssignmentContext,
  ): Promise<AssignmentSessionResult> {
    let query = database.from('assignment_submissions')
      .select('id,user_id,course_version_id,item_id,block_id,attempt_no,payload,status,submitted_at,submission_files(asset_id,name,size_bytes,mime),grades(rubric_scores,total_points,max_points,feedback,decision,passed,graded_at,released)')
      .eq('user_id', actor.userId)
      .eq('course_version_id', context.courseVersionId)
      .eq('item_id', locator.itemId);
    query = locator.blockId === null ? query.is('block_id', null) : query.eq('block_id', locator.blockId);
    const result = await query.order('attempt_no', { ascending: false });
    if (result.error) databaseFailure('Unable to load submission history');
    const rows = Array.isArray(result.data) ? result.data : [];
    const submissions = rows.map(learnerSubmission);
    if (submissions.some((entry) => entry === null)) {
      databaseFailure('Assignment submission history contains an invalid record');
    }
    const validSubmissions = submissions
      .filter((entry): entry is LearnerAssignmentSubmission => entry !== null)
      .sort((left, right) => right.attemptNo - left.attemptNo);
    const attemptsUsed = validSubmissions.reduce((maximum, entry) => Math.max(maximum, entry.attemptNo), 0);
    let action: AssignmentAction;
    if (validSubmissions.some(({ grade }) => grade?.decision === 'approved')) {
      action = { allowed: false, reason: 'approved' };
    } else if (attemptsUsed >= MAX_ASSIGNMENT_ATTEMPTS) {
      action = { allowed: false, reason: 'attempt_limit' };
    } else if (!validSubmissions.length) {
      action = { allowed: true, kind: 'initial', expectedLatestSubmissionId: null, nextAttemptNo: 1 };
    } else if (context.settings.resubmission === 'until_approved') {
      action = {
        allowed: true,
        kind: 'revision',
        expectedLatestSubmissionId: validSubmissions[0].submissionId,
        nextAttemptNo: attemptsUsed + 1,
      };
    } else if (context.settings.resubmission === 'once'
      && attemptsUsed < 2
      && validSubmissions[0].grade?.decision === 'changes_requested') {
      action = {
        allowed: true,
        kind: 'revision',
        expectedLatestSubmissionId: validSubmissions[0].submissionId,
        nextAttemptNo: attemptsUsed + 1,
      };
    } else {
      action = {
        allowed: false,
        reason: context.settings.resubmission === 'once' && attemptsUsed < 2 ? 'awaiting_review' : 'policy',
      };
    }
    return { locator, courseVersionId: context.courseVersionId, attemptsUsed, submissions: validSubmissions, action };
  }

  async function authorizeUpload(
    actor: Actor,
    locatorOrCourseId: AssignmentLocator | string,
    itemIdOrFile: string | AssignmentUploadMetadata,
    blockId?: string | null,
    legacyFile?: AssignmentUploadMetadata,
  ) {
    const locator = typeof locatorOrCourseId === 'string'
      ? { courseId: locatorOrCourseId, itemId: itemIdOrFile as string, blockId: blockId ?? null }
      : locatorOrCourseId;
    const file = typeof locatorOrCourseId === 'string' ? legacyFile! : itemIdOrFile as AssignmentUploadMetadata;
    const context = await loadAssignment(actor, locator,true);
    if (!context.settings.submission.accepts.includes('file')) {
      throw new ApiError(400, 'SUBMISSION_TYPE_NOT_ALLOWED', 'This assignment does not accept file uploads');
    }
    const maxBytes = (context.settings.submission.maxFileSizeMB ?? 20) * 1024 * 1024;
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > maxBytes) {
      throw new ApiError(413, 'FILE_TOO_LARGE', 'Submission file exceeds the assignment size limit');
    }
    const allowedMimes = context.settings.submission.allowedMimeTypes;
    if (allowedMimes?.length && !allowedMimes.includes(file.mime)) {
      throw new ApiError(415, 'FILE_TYPE_NOT_ALLOWED', 'Submission file type is not allowed');
    }
    return { courseVersionId: context.courseVersionId, itemId: locator.itemId };
  }

  function assertAcceptedPayload(
    payload: z.infer<typeof SubmissionPayloadSchema>,
    settings: AssignmentGradingSettings,
  ) {
    const accepted = new Set(settings.submission.accepts);
    const submitted = [
      payload.text !== undefined ? 'text' : null,
      payload.links !== undefined ? 'link' : null,
      payload.files !== undefined ? 'file' : null,
      payload.code !== undefined ? 'code' : null,
    ].filter((value): value is 'text' | 'link' | 'file' | 'code' => value !== null);
    if (submitted.some((channel) => !accepted.has(channel))) {
      throw new ApiError(400, 'SUBMISSION_TYPE_NOT_ALLOWED', 'Submission contains a response type this assignment does not accept');
    }
    const maxFiles = settings.submission.maxFiles ?? 3;
    if ((payload.files?.length ?? 0) > maxFiles) {
      throw new ApiError(400, 'TOO_MANY_FILES', `This assignment accepts at most ${maxFiles} files`);
    }
    if (payload.links?.some(({ url }) => !allowedSubmissionUrl(url, settings.submission.linkHosts))) {
      throw new ApiError(400, 'LINK_HOST_NOT_ALLOWED', 'Submission link host is not allowed');
    }
    if (payload.code && settings.submission.codeLanguage
      && payload.code.language !== settings.submission.codeLanguage) {
      throw new ApiError(400, 'CODE_LANGUAGE_NOT_ALLOWED', 'Submission code language does not match the assignment');
    }
    if (settings.notebook && !payload.notebook) {
      throw new ApiError(400, 'NOTEBOOK_REQUIRED', 'This assignment requires a notebook artifact');
    }
    if (!settings.notebook && payload.notebook) {
      throw new ApiError(400, 'SUBMISSION_TYPE_NOT_ALLOWED', 'This assignment does not accept notebook artifacts');
    }
  }

  async function validatedNotebook(
    actor: Actor,
    locator: AssignmentLocator,
    courseVersionId: string,
    payload: z.infer<typeof NotebookSubmissionPayloadSchema> | undefined,
    assignment: NotebookAssignment | undefined,
  ): Promise<z.infer<typeof NotebookSubmissionPayloadSchema> | undefined> {
    if (!payload || !assignment) return undefined;
    const artifact = dependencies.verifyNotebookArtifact
      ? await dependencies.verifyNotebookArtifact({ actor, locator, courseVersionId, assignment, assetId: payload.assetId })
      : await defaultNotebookArtifact(payload.assetId);
    if (!artifact || artifact.id !== payload.assetId) {
      throw new ApiError(400, 'INVALID_NOTEBOOK_ARTIFACT', 'Notebook artifact is invalid');
    }
    const expected = {
      ownerId: actor.userId,
      courseId: locator.courseId,
      courseVersionId,
      itemId: locator.itemId,
      blockId: locator.blockId,
      templateAssetId: assignment.templateAssetId,
      templateChecksum: assignment.templateChecksum,
      runtimeProfileId: assignment.runtimeProfileId,
      runtimeProfileVersion: assignment.runtimeProfileVersion,
    };
    if (validateNotebookSubmissionArtifact(artifact, expected).length
      || payload.checksum !== artifact.checksum
      || payload.templateChecksum !== assignment.templateChecksum
      || (payload.runtimeProfileId !== undefined && payload.runtimeProfileId !== assignment.runtimeProfileId)
      || (payload.runtimeProfileVersion !== undefined && payload.runtimeProfileVersion !== assignment.runtimeProfileVersion)) {
      throw new ApiError(400, 'INVALID_NOTEBOOK_ARTIFACT', 'Notebook artifact is invalid');
    }
    return {
      assetId: artifact.id,
      checksum: artifact.checksum,
      format: 'ipynb',
      templateChecksum: assignment.templateChecksum,
      runtimeProfileId: assignment.runtimeProfileId,
      runtimeProfileVersion: assignment.runtimeProfileVersion,
    };
  }

  async function validatedAssets(
    actor: Actor,
    payload: z.infer<typeof SubmissionPayloadSchema>,
    settings: AssignmentGradingSettings,
  ): Promise<StoredAsset[]> {
    const requested = payload.files ?? [];
    if (!requested.length) return [];
    const ids = requested.map(({ assetId }) => assetId);
    if (new Set(ids).size !== ids.length) {
      throw new ApiError(400, 'INVALID_SUBMISSION_FILE', 'Submission files must be unique');
    }
    const result = await database.from('media_assets')
      .select('id,owner_id,bucket,path,mime,size_bytes,purpose')
      .in('id', ids);
    if (result.error) databaseFailure('Unable to validate submission files');
    const rows = Array.isArray(result.data) ? result.data : [];
    const byId = new Map(rows.flatMap((value) => {
      const row = record(value);
      return row && stringValue(row.id) ? [[row.id as string, row] as const] : [];
    }));
    const maxBytes = (settings.submission.maxFileSizeMB ?? 20) * 1024 * 1024;
    return requested.map((file) => {
      const row = byId.get(file.assetId);
      const mime = stringValue(row?.mime);
      const sizeBytes = typeof row?.size_bytes === 'number'
        ? row.size_bytes
        : typeof row?.size_bytes === 'string' ? Number(row.size_bytes) : Number.NaN;
      if (!row
        || row.owner_id !== actor.userId
        || row.bucket !== 'submissions'
        || (row.purpose !== undefined && row.purpose !== 'submission')
        || !pathForOwnedAsset(actor.userId, row.path)
        || !mime
        || !Number.isSafeInteger(sizeBytes)
        || sizeBytes < 0) {
        throw new ApiError(400, 'INVALID_SUBMISSION_FILE', 'One or more submission files are invalid');
      }
      if (settings.submission.allowedMimeTypes?.length
        && !settings.submission.allowedMimeTypes.includes(mime)) {
        throw new ApiError(400, 'FILE_TYPE_NOT_ALLOWED', 'Submission file type is not allowed');
      }
      if (sizeBytes > maxBytes) {
        throw new ApiError(400, 'FILE_TOO_LARGE', 'Submission file exceeds the assignment size limit');
      }
      if (file.mime !== mime || file.size !== sizeBytes) {
        throw new ApiError(400, 'INVALID_SUBMISSION_FILE', 'Submission file metadata does not match the stored asset');
      }
      return { id: file.assetId, mime, sizeBytes };
    });
  }

  async function submit(
    actor: Actor,
    locatorOrCourseId: AssignmentLocator | string,
    itemIdOrExpectedLatest: string | null,
    blockIdOrPayload: unknown,
    legacyPayload?: unknown,
  ): Promise<AssignmentSubmitResult | { submissionId: string; status: 'submitted'; attemptNo: number }> {
    const legacy = typeof locatorOrCourseId === 'string';
    const locator: AssignmentLocator = legacy
      ? {
          courseId: locatorOrCourseId,
          itemId: itemIdOrExpectedLatest as string,
          blockId: typeof blockIdOrPayload === 'string' ? blockIdOrPayload : null,
        }
      : locatorOrCourseId;
    const rawPayload = legacy ? legacyPayload : blockIdOrPayload;
    const payload = SubmissionPayloadSchema.parse(rawPayload);
    const context = await loadAssignment(actor, locator,true);
    assertAcceptedPayload(payload, context.settings);
    const notebook = await validatedNotebook(actor, locator, context.courseVersionId, payload.notebook, context.settings.notebook);
    let expectedLatestSubmissionId = legacy ? null : itemIdOrExpectedLatest;
    if (legacy) {
      let latestQuery = database.from('assignment_submissions')
        .select('id')
        .eq('user_id', actor.userId)
        .eq('course_version_id', context.courseVersionId)
        .eq('item_id', locator.itemId);
      latestQuery = locator.blockId === null
        ? latestQuery.is('block_id', null)
        : latestQuery.eq('block_id', locator.blockId);
      const latestResult = await latestQuery.order('attempt_no', { ascending: false }).limit(1);
      if (latestResult.error) databaseFailure('Unable to load latest assignment submission');
      expectedLatestSubmissionId = stringValue(record(Array.isArray(latestResult.data) ? latestResult.data[0] : latestResult.data)?.id);
    }
    if (!await permitsAssignmentSubmission(
      database,
      actor.userId,
      context.courseVersionId,
      locator.itemId,
      locator.blockId ?? undefined,
      now(),
    )) {
      throw new ApiError(429, 'RATE_LIMITED', 'Too many submissions for this assignment; try again later');
    }
    const assets = await validatedAssets(actor, payload, context.settings);
    const requestedById = new Map((payload.files ?? []).map((file) => [file.assetId, file]));
    const fileRows = assets.map((asset) => ({
      asset_id: asset.id,
      name: safeMediaFilename(requestedById.get(asset.id)!.name),
      size_bytes: asset.sizeBytes,
      mime: asset.mime,
    }));
    const inserted = await database.rpc('submit_assignment_guarded', {
      p_user_id: actor.userId,
      p_course_id: locator.courseId,
      p_course_version_id: context.courseVersionId,
      p_item_id: locator.itemId,
      p_block_id: locator.blockId,
      p_expected_latest_submission_id: expectedLatestSubmissionId,
      p_resubmission: context.settings.resubmission,
      p_payload: normalizedPayload(payload, notebook),
      p_submitted_at: now().toISOString(),
      p_files: fileRows,
    });
    if (inserted.error) {
      if (isNamedDatabaseError(inserted.error, 'SUBMISSION_STALE')) {
        throw new ApiError(409, 'SUBMISSION_STALE', 'Assignment history changed; refresh before submitting this revision');
      }
      if (isNamedDatabaseError(inserted.error, 'ASSIGNMENT_ALREADY_APPROVED')) {
        throw new ApiError(409, 'ASSIGNMENT_ALREADY_APPROVED', 'An approved assignment cannot be resubmitted');
      }
      if (isNamedDatabaseError(inserted.error, 'RESUBMISSION_NOT_ALLOWED')) {
        throw new ApiError(409, 'RESUBMISSION_NOT_ALLOWED', 'This assignment does not allow that revision');
      }
      if (isNamedDatabaseError(inserted.error, 'ATTEMPT_LIMIT')) {
        throw new ApiError(409, 'ATTEMPT_LIMIT', 'This assignment has reached its 20-attempt limit');
      }
      if (isUniqueViolation(inserted.error)) {
        throw new ApiError(409, 'SUBMISSION_STALE', 'Assignment history changed; refresh before submitting this revision');
      }
      databaseFailure('Unable to create assignment submission');
    }
    const insertedRow = record(inserted.data);
    const submissionId = stringValue(insertedRow?.id);
    const attemptNo = insertedRow?.attempt_no;
    const created = insertedRow?.created;
    if (!submissionId || !Number.isSafeInteger(attemptNo) || typeof created !== 'boolean') {
      databaseFailure('Assignment submission returned an invalid record');
    }

    if (created) {
      await runPostCommitEffects([
        { name: 'progress.recompute', run: () => hooks.recompute(actor, locator.courseId) },
      ], { submissionId, courseId: locator.courseId });
    }
    if (legacy) return { submissionId, status: 'submitted', attemptNo: attemptNo as number };
    return {
      created,
      session: await loadSessionForContext(actor, locator, context),
    };
  }

  async function listMine(actor: Actor, courseId: string, itemId: string) {
    const result = await session(actor, { courseId, itemId, blockId: null });
    return result.submissions.map((submission) => ({
      id: submission.submissionId,
      course_version_id: result.courseVersionId,
      item_id: itemId,
      block_id: null,
      attempt_no: submission.attemptNo,
      status: submission.status,
      submitted_at: submission.submittedAt,
      payload: submission.payload,
      submission_files: submission.files.map((file) => ({
        asset_id: file.assetId, name: file.name, size_bytes: file.size, mime: file.mime,
      })),
      grades: submission.grade ? [{
        rubric_scores: submission.grade.rubricScores,
        total_points: submission.grade.totalPoints,
        max_points: submission.grade.maxPoints,
        feedback: submission.grade.feedback,
        decision: submission.grade.decision,
        passed: submission.grade.passed,
        graded_at: submission.grade.gradedAt,
        released: true,
      }] : [],
    }));
  }

  async function session(actor: Actor, locator: AssignmentLocator): Promise<AssignmentSessionResult> {
    const context = await loadAssignment(actor, locator);
    return loadSessionForContext(actor, locator, context);
  }

  async function queue(actor: Actor, rawFilter: SubmissionQueueFilter): Promise<SubmissionQueuePage> {
    const filter = QueueFilterSchema.parse(rawFilter);
    const cursor = decodeQueueCursor(filter.cursor);
    const globalAccess = canGradeSubmissionBranch(actor, null);
    let effectiveBranch = filter.branchId;
    let effectiveBranches: string[] | undefined;
    if (effectiveBranch) {
      if (!canGradeSubmissionBranch(actor, effectiveBranch)) {
        throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
      }
    } else if (!globalAccess) {
      const branches = permissionBranches(actor, 'submission.grade');
      if (!branches.length) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
      if (branches.length === 1) [effectiveBranch] = branches;
      else effectiveBranches = branches;
    }

    let versionIds: string[] | undefined;
    if (filter.courseId) {
      const versionsResult = await database.from('course_versions')
        .select('id')
        .eq('course_id', filter.courseId);
      if (versionsResult.error) databaseFailure('Unable to load course versions');
      versionIds = (Array.isArray(versionsResult.data) ? versionsResult.data : [])
        .flatMap((value) => stringValue(record(value)?.id) ?? []);
      if (!versionIds.length) return { items: [], nextCursor: null };
    }

    const statusFilter = filter.status;
    const matchesStatus = (status: LearnerSubmissionStatus) => !statusFilter
      || (statusFilter === 'pending' ? status === 'submitted' || status === 'in_review' : status === statusFilter);

    async function readRows(after: { submittedAt: string; id: string } | null) {
      let query = database.from('assignment_submissions')
        .select('id,user_id,course_version_id,item_id,block_id,attempt_no,payload,status,submitted_at,branch_id,branch_scope_known,profiles!inner(display_name,handle),submission_files(asset_id,name,size_bytes,mime),grades(rubric_scores,total_points,max_points,feedback,decision,passed,graded_at,released)');
      if (effectiveBranch) query = query.eq('branch_scope_known', true).eq('branch_id', effectiveBranch);
      else if (effectiveBranches) query = query.eq('branch_scope_known', true).in('branch_id', effectiveBranches);
      if (versionIds) query = query.in('course_version_id', versionIds);
      if (statusFilter && DATABASE_STATUS_FILTERS.has(statusFilter)) query = query.eq('status', statusFilter);
      else if (statusFilter === 'pending') query = query.in('status', [...WAITING_STORED_STATUSES]);
      if (filter.assignmentId) {
        query = query.or(`block_id.eq.${filter.assignmentId},and(block_id.is.null,item_id.eq.${filter.assignmentId})`);
      }
      if (after) {
        query = query.or(`submitted_at.gt.${after.submittedAt},and(submitted_at.eq.${after.submittedAt},id.gt.${after.id})`);
      }
      const result = await query
        .order('submitted_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(QUEUE_PAGE_SIZE + 1);
      if (result.error) databaseFailure('Unable to load submission queue');
      return Array.isArray(result.data) ? result.data : [];
    }

    async function projectRows(pageRows: unknown[]): Promise<SubmissionQueueSubmission[]> {
      let rows = pageRows;
      if (effectiveBranch) rows = rows.filter((value) => historicalBranch(record(value)) === effectiveBranch);
      if (effectiveBranches) {
        const allowed = new Set(effectiveBranches);
        rows = rows.filter((value) => {
          const branch = historicalBranch(record(value));
          return typeof branch === 'string' && allowed.has(branch);
        });
      }
      const candidateItems = rows.flatMap((value) => queueSubmission(value) ?? []);
      const locatorKey = (item: Pick<SubmissionQueueSubmission, 'userId' | 'courseVersionId' | 'itemId' | 'blockId'>) =>
        JSON.stringify([item.userId, item.courseVersionId, item.itemId, item.blockId]);
      const pendingLocators = new Map(candidateItems
        .filter((item) => item.status === 'submitted' || item.status === 'in_review')
        .map((item) => [locatorKey(item), item]));
      const historicallyApproved = new Set<string>();
      if (pendingLocators.size) {
        const locatorFilters = [...pendingLocators.values()].map((item) => `and(user_id.eq.${item.userId},course_version_id.eq.${item.courseVersionId},item_id.eq.${item.itemId},${item.blockId === null ? 'block_id.is.null' : `block_id.eq.${item.blockId}`})`);
        const approval = await database.from('assignment_submissions')
          .select('user_id,course_version_id,item_id,block_id,grades!inner(decision,released)')
          .eq('grades.released', true)
          .eq('grades.decision', 'approved')
          .or(locatorFilters.join(','));
        if (approval.error) databaseFailure('Released assignment approval could not be loaded');
        for (const raw of Array.isArray(approval.data) ? approval.data : []) {
          const row = record(raw);
          if (typeof row?.user_id !== 'string' || typeof row.course_version_id !== 'string'
            || typeof row.item_id !== 'string' || (row.block_id !== null && typeof row.block_id !== 'string')) continue;
          historicallyApproved.add(JSON.stringify([row.user_id, row.course_version_id, row.item_id, row.block_id]));
        }
      }
      return candidateItems
        .filter((item) => !((item.status === 'submitted' || item.status === 'in_review')
          && historicallyApproved.has(locatorKey(item))))
        .filter((item) => matchesStatus(item.status));
    }

    // Keyset paging over the stored order. Row-level filters (historical branch, released
    // approval, derived status) run after the read, so one queue page may need several database
    // pages; it stops at QUEUE_MAX_SCANS and hands the caller a cursor to continue from.
    let items: SubmissionQueueSubmission[] = [];
    let after = cursor;
    let lastScanned: Record<string, unknown> | null = null;
    let moreRows = false;
    for (let scan = 0; scan < QUEUE_MAX_SCANS; scan += 1) {
      const rawRows = await readRows(after);
      const pageRows = rawRows.slice(0, QUEUE_PAGE_SIZE);
      items.push(...await projectRows(pageRows));
      lastScanned = record(pageRows.at(-1)) ?? lastScanned;
      moreRows = rawRows.length > QUEUE_PAGE_SIZE;
      if (!moreRows || items.length >= QUEUE_PAGE_SIZE) break;
      const submittedAt = stringValue(lastScanned?.submitted_at);
      const id = stringValue(lastScanned?.id);
      if (!submittedAt || !id) break;
      after = { submittedAt, id };
    }
    let nextCursor: string | null = null;
    if (items.length > QUEUE_PAGE_SIZE) {
      // Items keep the stored order, so the last returned item is a valid keyset position.
      items = items.slice(0, QUEUE_PAGE_SIZE);
      const last = items[QUEUE_PAGE_SIZE - 1];
      nextCursor = encodeQueueCursor({ submittedAt: last.submittedAt, id: last.id });
    } else if (moreRows && stringValue(lastScanned?.submitted_at) && stringValue(lastScanned?.id)) {
      nextCursor = encodeQueueCursor({ submittedAt: lastScanned!.submitted_at as string, id: lastScanned!.id as string });
    }
    return { items, nextCursor };
  }

  async function grade(actor: Actor, submissionId: string, rawInput: GradeSubmissionInput) {
    const input = GradeSubmissionSchema.parse(rawInput);
    const submissionResult = await database.from('assignment_submissions')
      .select('id,user_id,course_version_id,item_id,block_id,attempt_no,payload,status,submitted_at,branch_id,branch_scope_known,profiles!inner(display_name,handle),submission_files(asset_id,name,size_bytes,mime),grades(rubric_scores,total_points,max_points,feedback,decision,passed,graded_at,released)')
      .eq('id', submissionId)
      .maybeSingle();
    if (submissionResult.error) databaseFailure('Unable to load assignment submission');
    const submission = parsedSubmissionRow(submissionResult.data);
    if (!submission) throw new ApiError(404, 'SUBMISSION_NOT_FOUND', 'Assignment submission not found');
    const initialQueueSubmission = queueSubmission(submissionResult.data);
    if (!initialQueueSubmission) databaseFailure('Assignment submission returned an invalid record');
    const branchId = initialQueueSubmission.branchId;
    if (branchId === undefined || !canGradeSubmissionBranch(actor, branchId)) {
      throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
    }

    const itemResult = await database.from('course_version_items')
      .select('grading')
      .eq('version_id', submission.courseVersionId)
      .eq('item_id', submission.itemId)
      .maybeSingle();
    if (itemResult.error) databaseFailure('Unable to load assignment grading configuration');
    const grading = gradingItem(record(itemResult.data)?.grading);
    const assignmentId = submission.blockId ?? submission.itemId;
    const settings = assignmentSettings(grading?.assignments?.[assignmentId]);
    if (!grading || !settings) {
      throw new ApiError(500, 'SUBMISSION_CONFIG_INVALID', 'Assignment grading configuration is invalid');
    }

    const courseResult = await database.from('course_versions')
      .select('course_id')
      .eq('id', submission.courseVersionId)
      .maybeSingle();
    if (courseResult.error) databaseFailure('Unable to load submission course');
    const courseId = stringValue(record(courseResult.data)?.course_id);
    if (!courseId) databaseFailure('Submission course could not be resolved');

    const existingResult = await database.from('grades')
      .select('rubric_scores,total_points,max_points,feedback,decision,passed,graded_at,released')
      .eq('submission_id', submissionId)
      .maybeSingle();
    if (existingResult.error) databaseFailure('Unable to load existing grade');
    if (submission.status === 'approved' && record(existingResult.data)?.released === true) {
      throw new ApiError(409, 'GRADE_RELEASED', 'A released approved grade cannot be changed');
    }

    const rubric = assignmentRubric(grading, assignmentId);
    const criteria = rubric?.criteria ?? [];
    const criterionIds = new Set(criteria.map(({ id }) => id));
    if (Object.keys(input.rubricScores).some((id) => !criterionIds.has(id))) {
      throw new ApiError(400, 'UNKNOWN_RUBRIC_CRITERION', 'Rubric scores contain an unknown criterion');
    }
    for (const criterion of criteria) {
      if ((input.rubricScores[criterion.id] ?? 0) > criterion.maxPoints) {
        throw new ApiError(400, 'RUBRIC_SCORE_OUT_OF_RANGE', `Score for criterion "${criterion.id}" exceeds its maximum`);
      }
    }
    // A draft (`release: false`) accepts a partial rubric so a grader can stop
    // mid-way and come back; nothing partial is exposed, because only a released
    // grade is projected to the learner. Completion is the opposite: it publishes a
    // total, so an unscored criterion silently counting as zero would misreport the
    // result. `release: true` therefore requires every criterion.
    const unscored = input.release
      ? criteria.filter((criterion) => input.rubricScores[criterion.id] === undefined).map(({ id }) => id)
      : [];
    if (unscored.length > 0) {
      throw new ApiError(
        409,
        'RUBRIC_INCOMPLETE',
        `Every rubric criterion needs a score before grading is completed: ${unscored.join(', ')}`,
      );
    }
    const totalPoints = round2(criteria.reduce((total, criterion) =>
      total + (input.rubricScores[criterion.id] ?? 0), 0));
    const maxPoints = round2(criteria.reduce((total, criterion) => total + criterion.maxPoints, 0));
    const passed = settings.passPoints !== undefined && totalPoints >= settings.passPoints;
    const decision = input.decision;
    const status: LearnerSubmissionStatus = input.release ? decision : 'in_review';
    const gradedAt = now().toISOString();
    const gradeSummary = {
      submissionId,
      status,
      totalPoints,
      maxPoints,
      decision,
      passed,
      released: input.release,
    };
    const auditBefore = { status: submission.status, grade: existingResult.data };
    const auditAfter = { ...gradeSummary, rubricScores: input.rubricScores, feedback: input.feedback };
    const gradeResult = await database.rpc('grade_assignment_submission_guarded', {
      p_submission_id: submissionId,
      p_user_id: submission.userId,
      p_course_id: courseId,
      p_grader_id: actor.userId,
      p_rubric_scores: input.rubricScores,
      p_total_points: totalPoints,
      p_max_points: maxPoints,
      p_feedback: input.feedback,
      p_decision: decision,
      p_passed: passed,
      p_graded_at: gradedAt,
      p_released: input.release,
      p_audit_before: submissionAuditSnapshot(auditBefore),
      p_audit_after: submissionAuditSnapshot(auditAfter),
    });
    if (gradeResult.error) {
      if (isNamedDatabaseError(gradeResult.error, 'GRADE_RELEASED')) {
        throw new ApiError(409, 'GRADE_RELEASED', 'A released approved grade cannot be changed');
      }
      if (isNamedDatabaseError(gradeResult.error, 'STALE_SUBMISSION')) {
        throw new ApiError(409, 'STALE_SUBMISSION', 'A newer assignment revision must be graded instead');
      }
      databaseFailure('Unable to save assignment grade');
    }
    const becameReleasedApproved = record(gradeResult.data)?.became_released_approved;
    if (typeof becameReleasedApproved !== 'boolean') {
      databaseFailure('Assignment grade returned an invalid transition');
    }

    const effects: Array<{ name: string; run: () => Promise<void> }> = [{
      name: 'audit.write',
      run: () => audit(
        actor,
        'submission.grade',
        { type: 'assignment_submission', id: submissionId },
        auditBefore,
        auditAfter,
      ),
    }];
    if (becameReleasedApproved) {
      effects.push({
        name: 'skills.assignment-approved',
        run: () => hooks.onAssignmentApproved!({
          userId: submission.userId,
          submissionId,
          skills: settings.skills ?? [],
        }),
      },
      {
        name: 'progress.recompute',
        run: () => hooks.recompute({ userId: submission.userId, roles: [] }, courseId),
      });
      if (hooks.awardXp) effects.push({
        name: 'xp.assignment_approved',
        run: () => hooks.awardXp!({
          userId: submission.userId,
          courseVersionId: submission.courseVersionId,
          itemId: submission.itemId,
          assignmentId,
          submissionId,
        }),
      });
    }
    await runPostCommitEffects(effects, { submissionId, courseId });

    const committedSubmission: SubmissionQueueSubmission = {
      ...initialQueueSubmission,
      status,
      grade: {
        rubricScores: input.rubricScores,
        feedback: input.feedback,
        decision,
        passed,
        totalPoints,
        maxPoints,
        gradedAt,
        released: input.release,
      },
    };
    const refreshedResult = await database.from('assignment_submissions')
      .select('id,user_id,course_version_id,item_id,block_id,attempt_no,payload,status,submitted_at,branch_id,branch_scope_known,profiles!inner(display_name,handle),submission_files(asset_id,name,size_bytes,mime),grades(rubric_scores,total_points,max_points,feedback,decision,passed,graded_at,released)')
      .eq('id', submissionId)
      .maybeSingle();
    if (refreshedResult.error) {
      const correlationId = randomUUID();
      console.error(`[submission-refresh:${correlationId}] Committed grade reload failed`, {
        submissionId,
        error: 'Assignment grade could not be reloaded',
      });
      return { submission: committedSubmission };
    }
    const refreshed = queueSubmission(refreshedResult.data);
    if (!refreshed) {
      const correlationId = randomUUID();
      console.error(`[submission-refresh:${correlationId}] Committed grade reload returned an invalid record`, {
        submissionId,
      });
      return { submission: committedSubmission };
    }
    return { submission: refreshed };
  }

  return {
    authorizeUpload,
    submit,
    session,
    listMine,
    queue,
    grade,
  };
}

export function createServerSubmissionsService() {
  return createSubmissionsService({
    database: supabaseService() as unknown as SubmissionDatabase,
    hooks: {
      recompute: (actor, courseId) => recompute(actor, courseId).then(() => undefined),
      onAssignmentApproved,
      awardXp: async (effect) => {
        const { award } = await import('@/features/xp/service');
        await award(
          effect.userId,
          'assignment_approved',
          'assignment',
          `${effect.courseVersionId}:${effect.assignmentId}`,
        );
      },
    },
  });
}

function productionService() {
  return createServerSubmissionsService();
}

export async function submit(actor: Actor, locator: AssignmentLocator, expectedLatestSubmissionId: string | null, payload: unknown) {
  return productionService().submit(actor, locator, expectedLatestSubmissionId, payload) as Promise<AssignmentSubmitResult>;
}

export async function authorizeAssignmentUpload(
  actor: Actor,
  locator: AssignmentLocator,
  file: AssignmentUploadMetadata,
) {
  return productionService().authorizeUpload(actor, locator, file);
}

export async function session(actor: Actor, locator: AssignmentLocator) {
  return productionService().session(actor, locator);
}

export async function listMine(actor: Actor, courseId: string, itemId: string) {
  return productionService().listMine(actor, courseId, itemId);
}

export async function queue(actor: Actor, filter: SubmissionQueueFilter) {
  return productionService().queue(actor, filter);
}

export async function grade(actor: Actor, submissionId: string, input: GradeSubmissionInput) {
  return productionService().grade(actor, submissionId, input);
}
