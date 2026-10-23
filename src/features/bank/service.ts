import 'server-only';

import { z } from 'zod';

import { compileBankQuestion } from '@/content-engine/compile';
import { BLOCK_MANIFEST, PLAYER_MANIFEST, resolvePlayer } from '@/content-engine/manifest';
import { QUESTION_TYPES, type Question } from '@/content-engine/schema/questions';
import { QuestionBundleSchema, type QuestionBundle } from '@/content-engine/schema/bundle';
import { IdSchema } from '@/content-engine/schema/common';
import { validateStandaloneDocument, type ReferenceResolver } from '@/content-engine/validate';
import { SupabaseResolver, type SupabaseQueryClient } from '@/features/studio/resolver';
import { ApiError, toValidationIssues } from '@/lib/api';
import { hasPermission, type Actor, type Permission, type Scope } from '@/lib/permissions';

type QueryResult = { data: unknown; error: unknown | null };

export interface BankQuery extends PromiseLike<QueryResult> {
  select(columns: string): this;
  eq(column: string, value: unknown): this;
  overlaps(column: string, values: string[]): this;
  in(column: string, values: string[]): this;
  order(column: string, options?: { ascending?: boolean }): this;
  limit(value: number): this;
  range(from: number, to: number): this;
  maybeSingle(): Promise<QueryResult>;
}

export interface BankDatabase {
  from(table: string): BankQuery;
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<QueryResult>;
}

type BankPermission = Extract<Permission, 'bank.edit' | 'bank.publish'>;
type PermissionCheck = (permission: BankPermission) => Promise<Actor>;

export const BankListFilterSchema = z.object({
  types: z.array(z.enum(QUESTION_TYPES)).max(QUESTION_TYPES.length).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  difficulties: z.array(z.enum(['easy', 'medium', 'hard'])).max(3).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  page: z.number().int().min(1).max(10_000).optional(),
}).strict();

export type BankListFilter = z.infer<typeof BankListFilterSchema>;
export const BANK_PAGE_SIZE = 50;

type Dependencies = {
  database: BankDatabase;
  requirePermission: PermissionCheck;
  resolver?: ReferenceResolver;
  scope?: Scope;
};

export function actorPermissionCheck(actor: Actor, scope?: Scope): PermissionCheck {
  return async (permission) => {
    const genericEdit = permission === 'bank.edit' && hasPermission(actor, 'content.edit', scope);
    if (!genericEdit && !hasPermission(actor, permission, scope)) {
      throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
    }
    return actor;
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function databaseError(message: string): never {
  throw new ApiError(500, 'BANK_DATABASE_ERROR', message);
}

function notFound(id: string): never {
  throw new ApiError(404, 'BANK_QUESTION_NOT_FOUND', `Question "${id}" was not found`);
}

function archivedQuestion(): never {
  throw new ApiError(409, 'BANK_QUESTION_ARCHIVED', 'Archived questions cannot be edited or published');
}

function isDatabaseSignal(error: unknown, code: string, message: string): boolean {
  const value = record(error);
  return value?.code === code && value.message === message;
}

function databaseErrorIds(error: unknown): string[] {
  const details = record(error)?.details;
  if (Array.isArray(details)) return details.filter((value): value is string => typeof value === 'string');
  if (typeof details !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(details);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function validateId(id: string): string {
  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) throw new ApiError(400, 'INVALID_QUESTION_ID', 'Question id is invalid', toValidationIssues(parsed.error.issues));
  return parsed.data;
}

async function validatedBundle(raw: unknown, resolver: ReferenceResolver): Promise<QuestionBundle> {
  const hintedId = record(raw)?.id;
  const result = await validateStandaloneDocument(
    raw,
    typeof hintedId === 'string' ? hintedId : 'question_bundle',
    resolver,
  );
  if (!result.ok || !result.doc) {
    throw new ApiError(400, 'INVALID_DOCUMENT', 'Question bundle validation failed', toValidationIssues(result.report.errors));
  }

  const parsed = QuestionBundleSchema.safeParse(result.doc);
  if (!parsed.success) {
    throw new ApiError(400, 'INVALID_DOCUMENT', 'Expected a question_bundle document', toValidationIssues(parsed.error.issues));
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const question of parsed.data.questions) {
    if (seen.has(question.id)) duplicates.add(question.id);
    seen.add(question.id);
  }
  if (duplicates.size > 0) {
    throw new ApiError(
      400,
      'DUPLICATE_QUESTION_IDS',
      'Question bundle contains duplicate question ids',
      [...duplicates].map((id) => ({ path: ['questions', id], message: 'Question id is duplicated in this bundle' })),
    );
  }
  return parsed.data;
}

async function validatedStandaloneQuestion(raw: unknown, resolver: ReferenceResolver, code = 'INVALID_QUESTION'): Promise<Question> {
  const result = await validateStandaloneDocument({
    schemaVersion: 1,
    kind: 'question_bundle',
    id: 'bank-validation',
    languages: ['vi', 'en'],
    defaultLanguage: 'vi',
    questions: [raw],
  }, 'bank-validation', resolver);
  if (!result.ok || !result.doc) {
    throw new ApiError(400, code, 'Question validation failed', toValidationIssues(result.report.errors));
  }
  const bundle = QuestionBundleSchema.safeParse(result.doc);
  if (!bundle.success || !bundle.data.questions[0]) {
    throw new ApiError(400, code, 'Question validation failed', bundle.success ? [] : toValidationIssues(bundle.error.issues));
  }
  return bundle.data.questions[0];
}

function splitValues(values: string[]): string[] {
  return [...new Set(values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))];
}

export function bankFiltersFromUrl(url: string): BankListFilter {
  const params = new URL(url).searchParams;
  const status = params.get('status');
  const raw = {
    types: splitValues(params.getAll('type')).filter((value) => value !== 'all'),
    tags: splitValues(params.getAll('tags')),
    difficulties: splitValues(params.getAll('difficulty')).filter((value) => value !== 'all'),
    status: status && status !== 'all' ? status : undefined,
    page: params.get('page') ? Number(params.get('page')) : undefined,
  };
  return BankListFilterSchema.parse({
    ...(raw.types.length > 0 ? { types: raw.types } : {}),
    ...(raw.tags.length > 0 ? { tags: raw.tags } : {}),
    ...(raw.difficulties.length > 0 ? { difficulties: raw.difficulties } : {}),
    ...(raw.status ? { status: raw.status } : {}),
    ...(raw.page !== undefined ? { page: raw.page } : {}),
  });
}

function unsupportedBlocks(value: unknown, path = ''): Array<{ path: string; type: string }> {
  if (Array.isArray(value)) return value.flatMap((item, index) => unsupportedBlocks(item, `${path}/${index}`));
  const object = record(value);
  if (!object) return [];

  const issues: Array<{ path: string; type: string }> = [];
  if (Array.isArray(object.blocks)) {
    object.blocks.forEach((block, index) => {
      const blockObject = record(block);
      const type = typeof blockObject?.type === 'string' ? blockObject.type : '';
      const manifest = BLOCK_MANIFEST.find((row) => row.type === type);
      if (!manifest?.renderable) issues.push({ path: `${path}/blocks/${index}`, type });
    });
  }
  for (const [key, nested] of Object.entries(object)) {
    issues.push(...unsupportedBlocks(nested, `${path}/${key}`));
  }
  return issues;
}

function unsupportedPlayers(question: Question, path = ''): Array<{ path: string; type: string; valid: string[] }> {
  const resolved = resolvePlayer(question.type, question.display?.interactionType);
  const issues: Array<{ path: string; type: string; valid: string[] }> = resolved.ok ? [] : [{
    path: `${path}/display/interactionType`,
    type: question.type,
    valid: PLAYER_MANIFEST.filter(({ type }) => type === question.type).map(({ interactionType }) => interactionType),
  }];
  if (question.type === 'question_group') {
    question.questions.forEach((child, index) => {
      issues.push(...unsupportedPlayers(child, `${path}/questions/${index}`));
    });
  }
  return issues;
}

async function publishableQuestion(raw: unknown, questionId: string, resolver: ReferenceResolver): Promise<Question> {
  const question = await validatedStandaloneQuestion(raw, resolver, 'PUBLISH_VALIDATION_FAILED');
  const issues: unknown[] = [];
  if (question.id !== questionId) issues.push({ path: '/id', expected: questionId, received: question.id });
  issues.push(...unsupportedPlayers(question), ...unsupportedBlocks(question));
  if (issues.length > 0) {
    throw new ApiError(400, 'PUBLISH_VALIDATION_FAILED', 'Question cannot be published', toValidationIssues(issues));
  }
  return question;
}

function versionResult(data: unknown): Record<string, unknown> {
  const value = Array.isArray(data) ? data[0] : data;
  const row = record(value);
  if (!row || typeof row.id !== 'string' || typeof row.version !== 'number') {
    databaseError('Question version could not be created');
  }
  return { ...row, versionId: row.id };
}

export function createBankService({ database, requirePermission, resolver, scope }: Dependencies) {
  const referenceResolver = resolver
    ?? new SupabaseResolver(database as unknown as SupabaseQueryClient);
  return {
    async validate(raw: unknown) {
      await requirePermission('bank.edit');
      await validatedStandaloneQuestion(raw, referenceResolver);
      return { valid: true as const };
    },

    async importBundle(raw: unknown) {
      const actor = await requirePermission('bank.edit');
      const document = await validatedBundle(raw, referenceResolver);
      const requestedLanguages = document.languages ?? [document.defaultLanguage ?? 'vi'];
      const defaultLanguage = document.defaultLanguage ?? requestedLanguages[0];
      const languages = [defaultLanguage, ...requestedLanguages.filter((locale) => locale !== defaultLanguage)];
      const rows = await Promise.all(document.questions.map(async (question) => {
        const compiled = await compileBankQuestion(question, languages, defaultLanguage);
        return {
          id: question.id,
          type: question.type,
          tags: question.tags ?? [],
          difficulty: question.difficulty ?? null,
          languages,
          version: 1,
          payload: question,
          renders: compiled.renders,
          grading: compiled.grading,
        };
      }));

      const { data, error } = await database.rpc('studio_bank_import_bundle', {
        p_actor_id: actor.userId,
        p_questions: rows,
      });
      if (error) {
        if (isDatabaseSignal(error, 'P2001', 'BANK_QUESTION_EXISTS')) {
          throw new ApiError(
            409,
            'BANK_QUESTION_EXISTS',
            'One or more question ids already exist',
            databaseErrorIds(error).map((id) => ({ path: ['questions', id], message: 'Question id already exists' })),
          );
        }
        databaseError('Question bundle could not be imported');
      }
      return Array.isArray(data) ? data : [];
    },

    async list(filter: BankListFilter) {
      await requirePermission('bank.edit');
      const parsed = BankListFilterSchema.parse(filter);
      let query = database.from('bank_questions')
        .select('id,type,tags,difficulty,status,languages,current_version_id,created_at,updated_at');
      if (scope?.kind === 'branch') query = query.eq('ownership_kind', 'branch').eq('owner_branch_id', scope.branchId);
      if (parsed.tags?.length) query = query.overlaps('tags', parsed.tags);
      if (parsed.difficulties?.length) query = query.in('difficulty', parsed.difficulties);
      if (parsed.types?.length) query = query.in('type', parsed.types);
      if (parsed.status) query = query.eq('status', parsed.status);
      const page = parsed.page ?? 1;
      const from = (page - 1) * BANK_PAGE_SIZE;
      const { data, error } = await query
        .order('updated_at', { ascending: false })
        .range(from, from + BANK_PAGE_SIZE - 1);
      if (error) databaseError('Question bank could not be listed');
      return Array.isArray(data) ? data : [];
    },

    async get(id: string) {
      await requirePermission('bank.edit');
      validateId(id);
      const questionResult = await database.from('bank_questions')
        .select('id,type,tags,difficulty,status,languages,current_version_id,created_at,updated_at')
        .eq('id', id)
        .maybeSingle();
      if (questionResult.error) databaseError('Question could not be loaded');
      const question = record(questionResult.data);
      if (!question) notFound(id);

      const versionResult = await database.from('bank_question_versions')
        .select('id,question_id,version,payload,renders,grading,created_by,created_at')
        .eq('question_id', id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (versionResult.error) databaseError('Question version could not be loaded');

      return {
        id: question.id,
        type: question.type,
        tags: question.tags,
        difficulty: question.difficulty,
        status: question.status,
        languages: question.languages,
        currentVersionId: question.current_version_id ?? null,
        latestVersion: versionResult.data ?? null,
      };
    },

    async update(id: string, raw: unknown, expectedVersionId?: string) {
      const actor = await requirePermission('bank.edit');
      validateId(id);
      if (!expectedVersionId) throw new ApiError(428, 'PRECONDITION_REQUIRED', 'If-Match is required');
      const rawId = record(raw)?.id;
      if (typeof rawId === 'string' && rawId !== id) {
        throw new ApiError(400, 'ID_MISMATCH', 'Question id must match the route id');
      }
      const question = await validatedStandaloneQuestion(raw, referenceResolver);
      if (question.id !== id) {
        throw new ApiError(400, 'ID_MISMATCH', 'Question id must match the route id');
      }
      const metadataResult = await database.from('bank_questions')
        .select('id,languages,status,current_version_id')
        .eq('id', id)
        .maybeSingle();
      if (metadataResult.error) databaseError('Question could not be loaded');
      const metadata = record(metadataResult.data);
      if (!metadata) notFound(id);
      if (metadata.status === 'archived') archivedQuestion();
      const languages = Array.isArray(metadata.languages)
        ? metadata.languages.filter((locale): locale is 'vi' | 'en' => locale === 'vi' || locale === 'en')
        : [];
      if (languages.length === 0) databaseError('Question languages are invalid');
      const compiled = await compileBankQuestion(question, languages, languages[0]);
      const { data, error } = await database.rpc('studio_bank_create_version_guarded', {
        p_question_id: id,
        p_actor_id: actor.userId,
        p_payload: question,
        p_renders: compiled.renders,
        p_grading: compiled.grading,
        p_type: question.type,
        p_tags: question.tags ?? [],
        p_difficulty: question.difficulty ?? null,
        p_expected_version_id: expectedVersionId,
      });
      if (error) {
        if (isDatabaseSignal(error, 'P2002', 'BANK_QUESTION_ARCHIVED')) archivedQuestion();
        if (isDatabaseSignal(error, '40001', 'CMS_REVISION_CHANGED')) {
          throw new ApiError(409, 'BANK_VERSION_CONFLICT', 'Question changed before this save completed');
        }
        if (String(record(error)?.message ?? '').includes('CMS_REVIEW_PENDING')) {
          throw new ApiError(409, 'CMS_REVIEW_PENDING', 'Withdraw the pending review before editing');
        }
        databaseError('Question version could not be created');
      }
      return versionResult(data);
    },

    async publish(id: string) {
      const actor = await requirePermission('bank.publish');
      validateId(id);
      const currentResult = await database.from('bank_questions')
        .select('id,type,tags,difficulty,status,languages,current_version_id')
        .eq('id', id)
        .maybeSingle();
      if (currentResult.error) databaseError('Question could not be loaded');
      const before = record(currentResult.data);
      if (!before) notFound(id);
      if (before.status === 'archived') archivedQuestion();

      const latestResult = await database.from('bank_question_versions')
        .select('id,question_id,version,payload')
        .eq('question_id', id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestResult.error) databaseError('Question version could not be loaded');
      const latest = record(latestResult.data);
      if (!latest) notFound(id);
      await publishableQuestion(latest.payload, id, referenceResolver);
      if (typeof latest.id !== 'string') databaseError('Question version could not be published');

      const publishResult = await database.rpc('studio_bank_publish', {
        p_question_id: id,
        p_version_id: latest.id,
        p_actor_id: actor.userId,
      });
      if (publishResult.error) {
        if (isDatabaseSignal(publishResult.error, 'P2002', 'BANK_QUESTION_ARCHIVED')) archivedQuestion();
        if (String(record(publishResult.error)?.message ?? '').includes('CMS_APPROVED_REVIEW_REQUIRED')) {
          throw new ApiError(409, 'CMS_REVIEW_REQUIRED', 'An approved Central review is required before publication');
        }
        if (record(publishResult.error)?.code === '40001') {
          throw new ApiError(409, 'BANK_VERSION_CONFLICT', 'Question changed during publish; refresh and retry');
        }
        databaseError('Question could not be published');
      }
      const afterValue = Array.isArray(publishResult.data) ? publishResult.data[0] : publishResult.data;
      const after = record(afterValue);
      if (!after) throw new ApiError(409, 'CMS_STALE_REVIEW', 'The approved review no longer matches this question version');
      return { id: after.id, status: after.status, currentVersionId: after.current_version_id };
    },

    async usages(id: string) {
      await requirePermission('bank.edit');
      validateId(id);
      const { data, error } = await database.rpc('studio_bank_question_usages', { p_question_id: id });
      if (error) databaseError('Question usages could not be loaded');
      if (!Array.isArray(data)) return [];
      return data.flatMap((value) => {
        const row = record(value);
        return row && typeof row.version_id === 'string' && typeof row.item_id === 'string' && typeof row.course_id === 'string'
          ? [{ versionId: row.version_id, itemId: row.item_id, courseId: row.course_id }]
          : [];
      });
    },

    async usagesMany(ids: string[]): Promise<Map<string, Array<{ versionId: string; itemId: string; courseId: string }>>> {
      await requirePermission('bank.edit');
      const questionIds = [...new Set(ids.map(validateId))];
      const indexed = new Map(questionIds.map((id) => [id, [] as Array<{ versionId: string; itemId: string; courseId: string }>]));
      if (questionIds.length === 0) return indexed;
      const { data, error } = await database.rpc('studio_bank_question_usages_batch', { p_question_ids: questionIds });
      if (error) databaseError('Question usages could not be loaded');
      if (!Array.isArray(data)) return indexed;
      for (const value of data) {
        const row = record(value);
        if (!row || typeof row.question_id !== 'string' || !indexed.has(row.question_id)
          || typeof row.version_id !== 'string' || typeof row.item_id !== 'string' || typeof row.course_id !== 'string') continue;
        indexed.get(row.question_id)?.push({ versionId: row.version_id, itemId: row.item_id, courseId: row.course_id });
      }
      return indexed;
    },
  };
}

async function productionService() {
  const [{ supabaseService }, permissions] = await Promise.all([
    import('@/lib/supabase/server'),
    import('@/lib/permissions'),
  ]);
  return createBankService({
    database: supabaseService() as unknown as BankDatabase,
    requirePermission: permissions.requirePermission,
  });
}

export async function importBundle(document: unknown) {
  return (await productionService()).importBundle(document);
}

/** Imports a bundle using the actor already authenticated by a parent workflow. */
export async function importBundleAsActor(document: unknown, actor: Actor) {
  const { supabaseService } = await import('@/lib/supabase/server');
  return createBankService({
    database: supabaseService() as unknown as BankDatabase,
    requirePermission: actorPermissionCheck(actor),
  }).importBundle(document);
}

export async function list(filter: BankListFilter) {
  return (await productionService()).list(filter);
}

export async function get(id: string) {
  return (await productionService()).get(id);
}

export async function update(id: string, question: unknown, expectedVersionId?: string) {
  return (await productionService()).update(id, question, expectedVersionId);
}

export async function publish(id: string) {
  return (await productionService()).publish(id);
}

export async function usages(id: string) {
  return (await productionService()).usages(id);
}
