import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  AuditLogQuerySchema,
  listAuditEntries,
} from '@/features/admin/audit-log';

type QueryResult = {
  data: unknown[];
  error: unknown | null;
  count: number | null;
};

function auditClient(result: QueryResult) {
  const calls: Array<[string, ...unknown[]]> = [];
  const query = {
    select(columns: string, options: unknown) {
      calls.push(['select', columns, options]);
      return this;
    },
    eq(column: string, value: string) {
      calls.push(['eq', column, value]);
      return this;
    },
    ilike(column: string, value: string) {
      calls.push(['ilike', column, value]);
      return this;
    },
    or(filter: string) {
      calls.push(['or', filter]);
      return this;
    },
    order(column: string, options: unknown) {
      calls.push(['order', column, options]);
      return this;
    },
    range(from: number, to: number) {
      calls.push(['range', from, to]);
      return Promise.resolve(result);
    },
  };
  return {
    calls,
    client: {
      from(table: string) {
        calls.push(['from', table]);
        return query;
      },
    },
  };
}

describe('audit log query', () => {
  it('validates the public filter contract and rejects PostgREST control characters', () => {
    expect(AuditLogQuerySchema.parse({
      actor: '', action: '', target: '', page: '2',
    })).toEqual({ page: 2 });
    expect(() => AuditLogQuerySchema.parse({ action: 'publish),actor_id.not.is.null' })).toThrow();
    expect(() => AuditLogQuerySchema.parse({ page: 0 })).toThrow();
  });

  it('applies actor, action and target filters before returning the second 50-row page', async () => {
    const row = {
      id: 42,
      actor_id: '11111111-1111-4111-8111-111111111111',
      action: 'course.publish',
      target_type: 'course',
      target_id: 'ai-foundations',
      at: '2026-09-03T00:00:00.000Z',
    };
    const { client, calls } = auditClient({ data: [row], error: null, count: 101 });

    const result = await listAuditEntries(client, {
      actor: row.actor_id,
      action: 'course.publish',
      target: 'ai-foundations',
      page: 2,
    }, { includeSnapshots: false });

    expect(calls).toEqual([
      ['from', 'audit_log'],
      ['select', 'id, actor_id, action, target_type, target_id, at', { count: 'exact' }],
      ['eq', 'actor_id', row.actor_id],
      ['ilike', 'action', '%course.publish%'],
      ['or', 'target_type.ilike."%ai-foundations%",target_id.ilike."%ai-foundations%"'],
      ['order', 'at', { ascending: false }],
      ['range', 50, 99],
    ]);
    expect(result).toEqual({
      items: [{
        id: 42,
        actorId: row.actor_id,
        action: 'course.publish',
        targetType: 'course',
        targetId: 'ai-foundations',
        snapshots: null,
        at: '2026-09-03T00:00:00.000Z',
      }],
      page: 2,
      pageSize: 50,
      total: 101,
      totalPages: 3,
      hasPrevious: true,
      hasNext: true,
    });
  });

  it('quotes and escapes target values before composing a PostgREST OR filter', async () => {
    const { client, calls } = auditClient({ data: [], error: null, count: 0 });

    await listAuditEntries(client, {
      page: 1,
      target: 'course"),actor_id.not.is.null',
    }, { includeSnapshots: false });

    expect(calls).toContainEqual([
      'or',
      'target_type.ilike."%course\\"),actor_id.not.is.null%",target_id.ilike."%course\\"),actor_id.not.is.null%"',
    ]);
  });

  it('fails closed when the audit query cannot be completed', async () => {
    const { client } = auditClient({ data: [], error: { message: 'database details' }, count: null });

    await expect(listAuditEntries(client, { page: 1 }, { includeSnapshots: false }))
      .rejects.toThrow('Unable to load audit log');
  });

  it('selects and redacts snapshots only when explicitly authorized', async () => {
    const hostileSnapshot = {
      status: 'submitted',
      profile: {
        email: 'learner@example.com',
        displayName: 'Learner Name',
        phone_number: '+84 912 345 678',
      },
      grading: {
        freeTextAnswer: 'My private answer',
        feedback: 'Private grading notes',
      },
      auth: {
        accessToken: 'ey.private.token',
        client_secret: 'private-secret',
      },
      snapshotPreview: '{"email":"leaked@example.com"}',
    };
    const row = {
      id: 43,
      actor_id: null,
      action: 'submission.grade',
      target_type: 'submission',
      target_id: 'submission-1',
      before: hostileSnapshot,
      after: { status: 'approved', learner_name: 'Learner Name' },
      at: '2026-09-03T00:00:00.000Z',
    };
    const { client, calls } = auditClient({ data: [row], error: null, count: 1 });

    const result = await listAuditEntries(client, { page: 1 }, { includeSnapshots: true });

    expect(calls[1]).toEqual([
      'select',
      'id, actor_id, action, target_type, target_id, at, before, after',
      { count: 'exact' },
    ]);
    expect(result.items[0].snapshots).toEqual({
      before: {
        status: 'submitted',
        profile: {
          email: '[REDACTED]',
          displayName: '[REDACTED]',
          phone_number: '[REDACTED]',
        },
        grading: {
          freeTextAnswer: '[REDACTED]',
          feedback: '[REDACTED]',
        },
        auth: {
          accessToken: '[REDACTED]',
          client_secret: '[REDACTED]',
        },
        snapshotPreview: '[REDACTED]',
      },
      after: { status: 'approved', learner_name: '[REDACTED]' },
    });
    expect(JSON.stringify(result)).not.toContain('learner@example.com');
    expect(JSON.stringify(result)).not.toContain('My private answer');
  });
});
