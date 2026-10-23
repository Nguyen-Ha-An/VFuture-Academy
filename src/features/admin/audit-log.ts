import 'server-only';

import { z } from 'zod';

import { redactAuditSnapshot } from '@/lib/audit';

const PAGE_SIZE = 50;
const optionalFilter = z.preprocess(
  (value) => value === '' || value === null ? undefined : value,
  z.string().trim().min(1).max(160).regex(/^[\p{L}\p{N}._:/ -]+$/u).optional(),
);

export const AuditLogQuerySchema = z.object({
  actor: z.preprocess(
    (value) => value === '' || value === null ? undefined : value,
    z.uuid().optional(),
  ),
  action: optionalFilter,
  target: optionalFilter,
  page: z.coerce.number().int().min(1).max(10_000).default(1),
}).strict();

export type AuditLogQuery = z.output<typeof AuditLogQuerySchema>;

export type AuditLogEntry = {
  id: number;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  snapshots: { before: unknown; after: unknown } | null;
  at: string;
};

type AuditLogRow = {
  id: number;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  before?: unknown;
  after?: unknown;
  at: string;
};

type AuditQueryResult = {
  data: unknown[] | null;
  error: unknown | null;
  count: number | null;
};

interface AuditFilterBuilder {
  eq(column: string, value: string): AuditFilterBuilder;
  ilike(column: string, value: string): AuditFilterBuilder;
  or(filter: string): AuditFilterBuilder;
  order(column: string, options: { ascending: boolean }): AuditFilterBuilder;
  range(from: number, to: number): PromiseLike<AuditQueryResult>;
}

export interface AuditLogClient {
  from(table: 'audit_log'): {
    select(columns: string, options: { count: 'exact' }): AuditFilterBuilder;
  };
}

type AuditLogOptions = Readonly<{ includeSnapshots: boolean }>;

function toEntry(row: AuditLogRow, options: AuditLogOptions): AuditLogEntry {
  return {
    id: row.id,
    actorId: row.actor_id,
    action: row.action.slice(0, 120),
    targetType: row.target_type.slice(0, 120),
    targetId: row.target_id.slice(0, 160),
    snapshots: options.includeSnapshots ? {
      before: redactAuditSnapshot(row.before),
      after: redactAuditSnapshot(row.after),
    } : null,
    at: row.at,
  };
}

function quotePostgrestFilterValue(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export async function listAuditEntries(
  client: AuditLogClient,
  input: AuditLogQuery,
  options: AuditLogOptions,
) {
  const columns = options.includeSnapshots
    ? 'id, actor_id, action, target_type, target_id, at, before, after'
    : 'id, actor_id, action, target_type, target_id, at';
  let query = client
    .from('audit_log')
    .select(columns, { count: 'exact' });
  if (input.actor) query = query.eq('actor_id', input.actor);
  if (input.action) query = query.ilike('action', `%${input.action}%`);
  if (input.target) {
    const targetPattern = quotePostgrestFilterValue(`%${input.target}%`);
    query = query.or(`target_type.ilike.${targetPattern},target_id.ilike.${targetPattern}`);
  }

  const start = (input.page - 1) * PAGE_SIZE;
  const { data, error, count } = await query
    .order('at', { ascending: false })
    .range(start, start + PAGE_SIZE - 1);
  if (error) throw new Error('Unable to load audit log');

  const total = count ?? 0;
  return {
    items: ((data ?? []) as AuditLogRow[]).map((row) => toEntry(row, options)),
    page: input.page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.ceil(total / PAGE_SIZE),
    hasPrevious: input.page > 1,
    hasNext: input.page * PAGE_SIZE < total,
  };
}

export type AuditLogPage = Awaited<ReturnType<typeof listAuditEntries>>;
