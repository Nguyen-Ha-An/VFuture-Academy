import 'server-only';

import { z } from 'zod';
import { DIFFICULTIES, QUESTION_TYPES } from '@/content-engine/schema/questions';
import { ResolverUnavailableError, type BankQuestionSnapshot, type ReferenceResolver } from '@/content-engine/validate/semantic/refs';

type QueryResult<T> = { data: T; error: unknown | null };

export interface SupabaseQuery {
  select(columns: string): this;
  eq(column: string, value: unknown): this;
  overlaps(column: string, values: string[]): this;
  in(column: string, values: string[]): this;
  not(column: string, operator: string, value: unknown): this;
  maybeSingle(): Promise<QueryResult<unknown>>;
  then<TResult1 = QueryResult<unknown>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<unknown>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

/** The small, query-builder-only surface this resolver needs from Supabase. */
export interface SupabaseQueryClient {
  from(table: string): SupabaseQuery;
}

const bankCandidateFilterSchema = z.object({
  tags: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)).min(1).max(20).optional(),
  difficulty: z.array(z.enum(DIFFICULTIES)).min(1).max(DIFFICULTIES.length).optional(),
  types: z.array(z.enum(QUESTION_TYPES)).min(1).max(QUESTION_TYPES.length).optional(),
}).strict();

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Server-only adapter between the database and the pure content-engine
 * reference contract. The engine imports this interface, never this adapter.
 *
 * A query error and an empty result are reported differently on purpose: `null` /
 * `false` means the row genuinely is not there, while a failed lookup throws
 * `ResolverUnavailableError`. Returning `null` for both is how a database outage
 * used to turn a valid course into a list of phantom missing references — or, on the
 * paths that treat absence as tolerable, into a false clean bill of health.
 */
export class SupabaseResolver implements ReferenceResolver {
  constructor(
    private readonly client?: SupabaseQueryClient,
    private readonly context: { courseId?: string } = {},
  ) {}

  private async database(): Promise<SupabaseQueryClient> {
    if (this.client) return this.client;
    const { supabaseService } = await import('@/lib/supabase/server');
    return supabaseService() as unknown as SupabaseQueryClient;
  }

  private bankOwner?: Promise<{ kind: 'central' | 'branch'; branchId?: string } | null>;

  private async bankScope() {
    this.bankOwner ??= (async () => {
      if (!this.context.courseId) return { kind: 'central' as const };
      const database = await this.database();
      const { data, error } = await database.from('courses')
        .select('ownership_kind,owner_branch_id').eq('id', this.context.courseId).maybeSingle();
      if (error) throw new ResolverUnavailableError('bankCourseOwnership', { cause: error });
      // New-course imports have no persisted owner yet and may only reuse central banks.
      if (!data) return { kind: 'central' as const };
      const row = object(data);
      if (row?.ownership_kind === 'central' && row.owner_branch_id === null) return { kind: 'central' as const };
      const branchId = string(row?.owner_branch_id);
      return row?.ownership_kind === 'branch' && branchId ? { kind: 'branch' as const, branchId } : null;
    })();
    return this.bankOwner;
  }

  private bankAllowed(row: Record<string, unknown> | null, scope: Awaited<ReturnType<SupabaseResolver['bankScope']>>): boolean {
    if (!scope || !row) return false;
    if (row.ownership_kind === 'central' && row.owner_branch_id === null) return true;
    return scope.kind === 'branch' && row.ownership_kind === 'branch' && row.owner_branch_id === scope.branchId;
  }

  async bankQuestion(id: string): Promise<BankQuestionSnapshot | null> {
    const scope = await this.bankScope();
    const database = await this.database();
    const { data, error } = await database.from('bank_questions')
      .select('id,type,tags,difficulty,current_version_id,ownership_kind,owner_branch_id')
      .eq('id', id)
      .eq('status', 'published')
      .maybeSingle();
    if (error) throw new ResolverUnavailableError('bankQuestion', { cause: error });
    if (!data) return null;

    const question = object(data);
    if (!this.bankAllowed(question, scope)) return null;
    const questionId = string(question?.id);
    const versionId = string(question?.current_version_id);
    const type = string(question?.type);
    if (!question || !questionId || !versionId || !type) return null;

    const versionResult = await database.from('bank_question_versions')
      .select('id,payload')
      .eq('id', versionId)
      .eq('question_id', questionId)
      .maybeSingle();
    if (versionResult.error) throw new ResolverUnavailableError('bankQuestionVersion', { cause: versionResult.error });
    if (!versionResult.data) return null;

    const version = object(versionResult.data);
    const resolvedVersionId = string(version?.id);
    if (!version || !resolvedVersionId || !('payload' in version)) return null;

    return {
      id: questionId,
      versionId: resolvedVersionId,
      question: version.payload,
      tags: Array.isArray(question.tags) && question.tags.every((tag) => typeof tag === 'string') ? question.tags : undefined,
      difficulty: string(question.difficulty) ?? undefined,
      type,
    };
  }

  async bankCandidates(filter: { tags?: string[]; difficulty?: string[]; types?: string[] }): Promise<string[]> {
    const validated = bankCandidateFilterSchema.parse(filter);
    const scope = await this.bankScope();
    const database = await this.database();
    let query = database.from('bank_questions')
      .select('id,ownership_kind,owner_branch_id')
      .eq('status', 'published')
      .not('current_version_id', 'is', null);
    if (validated.tags?.length) query = query.overlaps('tags', validated.tags);
    if (validated.difficulty?.length) query = query.in('difficulty', validated.difficulty);
    if (validated.types?.length) query = query.in('type', validated.types);

    const { data, error } = await query;
    if (error) throw new ResolverUnavailableError('bankCandidates', { cause: error });
    if (!Array.isArray(data)) return [];
    return data.flatMap((row) => {
      if (!this.bankAllowed(object(row), scope)) return [];
      const id = string(object(row)?.id);
      return id ? [id] : [];
    });
  }

  async asset(id: string): Promise<{ id: string; url: string; mime: string } | null> {
    const database = await this.database();
    const { data, error } = await database.from('media_assets').select('id,mime,purpose').eq('id', id).eq('purpose', 'content').maybeSingle();
    if (error) throw new ResolverUnavailableError('asset', { cause: error });
    if (!data) return null;
    const asset = object(data);
    const assetId = string(asset?.id);
    const mime = string(asset?.mime);
    return assetId && mime && (asset?.purpose === undefined || asset?.purpose === 'content') ? { id: assetId, url: `/api/v1/media/${encodeURIComponent(assetId)}`, mime } : null;
  }

  async resourceExists(id: string): Promise<boolean> {
    return this.exists('resources', id, true);
  }

  async opportunityExists(id: string): Promise<boolean> {
    return this.exists('opportunities', id, true);
  }

  async branchExists(id: string): Promise<boolean> {
    return this.exists('branches', id);
  }

  private async exists(table: string, id: string, published = false): Promise<boolean> {
    const database = await this.database();
    let query = database.from(table).select('id').eq('id', id);
    if (published) query = query.eq('status', 'published');
    const { data, error } = await query.maybeSingle();
    if (error) throw new ResolverUnavailableError(`exists:${table}`, { cause: error });
    return data !== null;
  }
}
