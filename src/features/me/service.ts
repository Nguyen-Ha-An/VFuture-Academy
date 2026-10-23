import 'server-only';

import { ApiError } from '@/lib/api';

type QueryResult = { data: unknown; error: unknown | null };

export interface MeQuery extends PromiseLike<QueryResult> {
  select(columns: string): this;
  eq(column: string, value: unknown): this;
  maybeSingle(): Promise<QueryResult>;
}

export interface MeDatabase {
  from(table: string): MeQuery;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rowCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function databaseFailure(): never {
  throw new ApiError(500, 'PROFILE_DATABASE_ERROR', 'Learner profile could not be loaded');
}

export function createMeService({ database }: { database: MeDatabase }) {
  async function getMe(userId: string) {
    const [profileResult, enrollments, completions, certificates, evidence] = await Promise.all([
      database.from('profiles')
        .select('id,handle,display_name,avatar_url,locale,branch_id,profile_public')
        .eq('id', userId)
        .maybeSingle(),
      database.from('enrollments').select('id').eq('user_id', userId),
      database.from('course_completions').select('course_id').eq('user_id', userId),
      database.from('certificates').select('id').eq('user_id', userId),
      database.from('skill_evidence').select('id').eq('user_id', userId),
    ]);
    if (profileResult.error || enrollments.error || completions.error || certificates.error || evidence.error) databaseFailure();
    const profile = record(profileResult.data);
    if (!profile || profile.id !== userId || typeof profile.display_name !== 'string') {
      throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Learner profile not found');
    }
    return {
      profile: {
        id: userId,
        handle: typeof profile.handle === 'string' ? profile.handle : null,
        displayName: profile.display_name,
        avatarUrl: typeof profile.avatar_url === 'string' ? profile.avatar_url : null,
        locale: profile.locale === 'en' ? 'en' as const : 'vi' as const,
        branchId: typeof profile.branch_id === 'string' ? profile.branch_id : null,
        profilePublic: profile.profile_public === true,
      },
      counts: {
        enrollments: rowCount(enrollments.data),
        completedCourses: rowCount(completions.data),
        certificates: rowCount(certificates.data),
        skillEvidence: rowCount(evidence.data),
      },
    };
  }

  async function branchIdForUser(userId: string): Promise<string | null> {
    const result = await database.from('profiles').select('branch_id').eq('id', userId).maybeSingle();
    if (result.error) databaseFailure();
    const branchId = record(result.data)?.branch_id;
    return typeof branchId === 'string' ? branchId : null;
  }

  return { getMe, branchIdForUser };
}

async function productionService() {
  const { supabaseService } = await import('@/lib/supabase/server');
  return createMeService({ database: supabaseService() as unknown as MeDatabase });
}

export async function getMe(userId: string) {
  return (await productionService()).getMe(userId);
}

export async function branchIdForUser(userId: string) {
  return (await productionService()).branchIdForUser(userId);
}
