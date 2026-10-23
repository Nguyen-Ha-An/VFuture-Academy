import 'server-only';

import { getDraft, type CourseDraft, type StudioDatabase } from '@/features/studio/drafts';
import { env } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service-client';
import { logMcpEvent } from '../log';

const READ_TABLES = new Set([
  'courses', 'course_drafts', 'cms_review_requests', 'branches', 'bank_questions',
  'bank_question_versions', 'media_assets', 'resources', 'opportunities',
  'studio_mcp_access_blocks',
]);

const READ_RPCS = new Set([
  'authorization_actor', 'cms_assert_content_access', 'studio_get_draft_snapshot', 'rate_limit',
]);

type QueryResult = { data: unknown; error: { message?: string; code?: string; details?: string } | null };

export interface ReadOnlyQuery extends PromiseLike<QueryResult> {
  select(columns: string): ReadOnlyQuery;
  eq(column: string, value: unknown): ReadOnlyQuery;
  order(column: string, options?: unknown): ReadOnlyQuery;
  limit(value: number): ReadOnlyQuery;
  range(from: number, to: number): ReadOnlyQuery;
  in(column: string, values: unknown[]): ReadOnlyQuery;
  not(column: string, operator: string, value: unknown): ReadOnlyQuery;
  overlaps(column: string, values: string[]): ReadOnlyQuery;
  is(column: string, value: unknown): ReadOnlyQuery;
  maybeSingle(): Promise<QueryResult>;
  single(): Promise<QueryResult>;
}

export interface ReadOnlyDatabase {
  from(table: string): ReadOnlyQuery;
  rpc(name: string, args: Record<string, unknown>): Promise<QueryResult>;
  readonly auth: {
    readonly admin: {
      readonly oauth: {
        getClient(clientId: string): Promise<{ data: unknown; error: unknown | null }>;
      };
    };
  };
}

export class McpWriteAttemptError extends Error {
  constructor() {
    super('MCP database operation is not allowlisted');
    this.name = 'McpWriteAttemptError';
    logMcpEvent({ event: 'security', outcome: 'blocked', code: 'DB_OPERATION_FORBIDDEN' });
  }
}

type RawQuery = Record<string | symbol, unknown>;
type RawDatabase = {
  from(table: string): RawQuery;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
  auth: { admin: { oauth: { getClient(clientId: string): Promise<{ data: unknown; error: unknown | null }> } } };
};

const FILTER_METHODS = new Set(['eq', 'order', 'limit', 'range', 'in', 'not', 'overlaps', 'is']);

function only<T extends object>(allowed: T): T {
  return new Proxy(Object.freeze(allowed), {
    get(target, key, receiver) {
      if (!Reflect.has(target, key)) throw new McpWriteAttemptError();
      return Reflect.get(target, key, receiver);
    },
    set() { throw new McpWriteAttemptError(); },
  });
}

function wrapQuery(query: RawQuery, selected: boolean): ReadOnlyQuery {
  return new Proxy({} as ReadOnlyQuery, {
    get(_target, key) {
      if (key === 'select' && !selected) {
        return (columns: string) => {
          if (typeof columns !== 'string' || columns.length === 0 || columns.length > 512) throw new McpWriteAttemptError();
          return wrapQuery((query.select as (value: string) => RawQuery)(columns), true);
        };
      }
      if (selected && typeof key === 'string' && FILTER_METHODS.has(key)) {
        return (...args: unknown[]) => wrapQuery((query[key] as (...args: unknown[]) => RawQuery)(...args), true);
      }
      if (selected && (key === 'single' || key === 'maybeSingle')) {
        return () => Promise.resolve((query[key] as () => PromiseLike<QueryResult>)());
      }
      if (selected && key === 'then') {
        return (onfulfilled?: (value: QueryResult) => unknown, onrejected?: (reason: unknown) => unknown) =>
          (query.then as PromiseLike<QueryResult>['then']).call(query, onfulfilled, onrejected);
      }
      throw new McpWriteAttemptError();
    },
    set() { throw new McpWriteAttemptError(); },
    has(_target, key) { return key === 'select' || (selected && (key === 'then' || key === 'single' || key === 'maybeSingle' || FILTER_METHODS.has(String(key)))); },
  });
}

/** Test injection point; the production constructor never exposes its service client. */
export function wrapReadOnlyDatabase(rawClient: unknown): ReadOnlyDatabase {
  const client = rawClient as RawDatabase;
  return only({
    from(table: string): ReadOnlyQuery {
      if (!READ_TABLES.has(table)) throw new McpWriteAttemptError();
      return wrapQuery(client.from(table), false);
    },
    rpc(name: string, args: Record<string, unknown>): Promise<QueryResult> {
      if (!READ_RPCS.has(name)) throw new McpWriteAttemptError();
      return Promise.resolve(client.rpc(name, args));
    },
    auth: only({ admin: only({ oauth: only({
      getClient(clientId: string) {
        return client.auth.admin.oauth.getClient(clientId);
      },
    }) }) }),
  });
}

/** The only MCP constructor of a service-role Supabase client. */
export function createReadOnlyDatabase(): ReadOnlyDatabase {
  return wrapReadOnlyDatabase(createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY));
}

/** Reused Studio read helpers have broad database types; the runtime facade still blocks writes. */
export function asStudioDatabase(db: ReadOnlyDatabase): StudioDatabase {
  return db as unknown as StudioDatabase;
}

export async function mcpGetDraft(db: ReadOnlyDatabase, courseId: string): Promise<CourseDraft> {
  return getDraft(courseId, { client: asStudioDatabase(db) });
}
