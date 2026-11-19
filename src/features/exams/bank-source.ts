import 'server-only';

import type { GradingQuestion } from '@/content-engine/compile';
import type { Locale } from '@/content-engine/schema/common';
import { canUseBankQuestion } from '@/features/bank/ownership';
import { supabaseService } from '@/lib/supabase/server';
import type { BankListQuery, BankQuestionSnapshot, BankSource } from './types';

type DatabaseResult = { data: unknown; error: unknown | null };

export interface BankQuery extends PromiseLike<DatabaseResult> {
  select(columns: string): this;
  eq(column: string, value: unknown): this;
  is(column: string, value: null): this;
  or(filters: string): this;
  in(column: string, values: unknown[]): this;
  overlaps(column: string, values: string[]): this;
}

export interface BankDatabase {
  from(table: string): BankQuery;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((entry): Record<string, unknown>[] => {
      const parsed = record(entry);
      return parsed ? [parsed] : [];
    })
    : [];
}

function assertDatabase(result: DatabaseResult, operation: string) {
  if (result.error) throw new Error(`Unable to ${operation}`);
  return result.data;
}

function sourceId(value: string) {
  return value.startsWith('bank:') ? value.slice('bank:'.length) : value;
}

export class SupabaseBankSource implements BankSource {
  constructor(
    private readonly database: BankDatabase = supabaseService() as unknown as BankDatabase,
  ) {}

  async listPublished(query: BankListQuery): Promise<BankQuestionSnapshot[]> {
    let metadataQuery = this.database.from('bank_questions')
      .select('id,current_version_id,ownership_kind,owner_branch_id')
      .eq('status', 'published');
    if (query.courseOwner.kind === 'central') {
      metadataQuery = metadataQuery.eq('ownership_kind', 'central').is('owner_branch_id', null);
    } else {
      metadataQuery = metadataQuery.or([
        'and(ownership_kind.eq.central,owner_branch_id.is.null)',
        `and(ownership_kind.eq.branch,owner_branch_id.eq.${JSON.stringify(query.courseOwner.branchId)})`,
      ].join(','));
    }
    if ('from' in query) {
      metadataQuery = metadataQuery.in('id', [...new Set(query.from.map(sourceId))]);
    } else {
      if (query.filter.tags?.length) metadataQuery = metadataQuery.overlaps('tags', query.filter.tags);
      if (query.filter.difficulty?.length) metadataQuery = metadataQuery.in('difficulty', query.filter.difficulty);
      if (query.filter.types?.length) metadataQuery = metadataQuery.in('type', query.filter.types);
    }

    const metadata = rows(assertDatabase(await metadataQuery, 'list published bank questions'))
      .filter((row) => canUseBankQuestion(query.courseOwner, row))
      .flatMap((row) => typeof row.id === 'string' && typeof row.current_version_id === 'string'
        ? [{ id: row.id, versionId: row.current_version_id }]
        : []);
    if (!metadata.length) return [];

    const versionIds = [...new Set(metadata.map(({ versionId }) => versionId))];
    const versionResult = await this.database.from('bank_question_versions')
      .select('id,question_id,grading,renders')
      .in('id', versionIds);
    const versions = new Map(rows(assertDatabase(versionResult, 'load published bank question versions'))
      .flatMap((row) => typeof row.id === 'string' ? [[row.id, row] as const] : []));

    return metadata.flatMap(({ id, versionId }) => {
      const version = versions.get(versionId);
      if (!version || version.question_id !== id || !record(version.grading) || !record(version.renders)) return [];
      return [{
        id,
        versionId,
        grading: version.grading as unknown as GradingQuestion,
        renders: version.renders as Record<Locale, unknown>,
      }];
    });
  }
}
