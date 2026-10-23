import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createAuditWriter, redactAuditSnapshot, type AuditClient } from '@/lib/audit';

function captureClient() {
  let entry: Parameters<ReturnType<AuditClient['from']>['insert']>[0] | undefined;
  const client: AuditClient = {
    from: () => ({ insert: async (value) => { entry = value; return { error: null }; } }),
  };
  return { client, entry: () => entry };
}

describe('audit writer', () => {
  it('writes the actor and target with snapshots detached and sensitive values redacted', async () => {
    let entry: unknown;
    const client: AuditClient = {
      from: () => ({ insert: async (value) => { entry = value; return { error: null }; } }),
    };
    const before = { status: 'draft', token: 'private-value' };

    await createAuditWriter(client)({ userId: 'actor-1', roles: [] }, 'course.publish', { type: 'course', id: 'course-1' }, before, { status: 'published', password: 'private-value' });
    before.status = 'changed-after-audit';

    expect(entry).toEqual({
      actor_id: 'actor-1', action: 'course.publish', target_type: 'course', target_id: 'course-1',
      before: { status: 'draft', token: '[REDACTED]' }, after: { status: 'published', password: '[REDACTED]' },
    });
  });

  it('does not expose database error details when an audit insert fails', async () => {
    const client: AuditClient = {
      from: () => ({ insert: async () => ({ error: { message: 'service_role_key=private-value' } }) }),
    };

    await expect(createAuditWriter(client)({ userId: 'actor-1', roles: [] }, 'course.publish', { type: 'course', id: 'course-1' }, null, null))
      .rejects.toThrow('Unable to write audit log');
  });

  it('serializes shared references while still rejecting true cycles', async () => {
    const shared = { status: 'draft' };
    const successful = captureClient();

    await createAuditWriter(successful.client)({ userId: 'actor-1', roles: [] }, 'course.edit', { type: 'course', id: 'course-1' }, { a: shared, b: shared }, null);
    expect(successful.entry()?.before).toEqual({ a: { status: 'draft' }, b: { status: 'draft' } });

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    await expect(createAuditWriter(successful.client)({ userId: 'actor-1', roles: [] }, 'course.edit', { type: 'course', id: 'course-1' }, cyclic, null))
      .rejects.toThrow('Audit snapshots must be JSON-serializable');
  });

  it('redacts every sensitive key family before persistence', async () => {
    const capture = captureClient();
    const sensitive = {
      password: 'private', service_role_key: 'private', serviceRoleKey: 'private', email: 'private', phone: 'private',
      session: 'private', refresh: 'private', cookie: 'private', authorization: 'private', answer: 'private',
      answer_key: 'private', correctAnswer: 'private', credential: 'private', token: 'private', secret: 'private',
    };

    await createAuditWriter(capture.client)({ userId: 'actor-1', roles: [] }, 'course.edit', { type: 'course', id: 'course-1' }, sensitive, null);

    expect(capture.entry()?.before).toEqual(Object.fromEntries(Object.keys(sensitive).map((key) => [key, '[REDACTED]'])));
  });

  it('redacts identity and free-text fields in snapshots from any audit writer', () => {
    expect(redactAuditSnapshot({
      displayName: 'Learner Name',
      phoneNumber: '+84 912 345 678',
      free_text_answer: 'Private response',
      feedback: 'Private grading note',
      safeStatus: 'approved',
    })).toEqual({
      displayName: '[REDACTED]',
      phoneNumber: '[REDACTED]',
      free_text_answer: '[REDACTED]',
      feedback: '[REDACTED]',
      safeStatus: 'approved',
    });
  });

  it('scrubs sensitive values from prose and nested string arrays regardless of key names', () => {
    expect(redactAuditSnapshot({
      summary: 'Contact learner@example.com or +84 912 345 678 about the submission.',
      values: [
        'safe label',
        ['Backup: second.learner@example.org', 'Token abcdefghijklmnopqrstuvwxyz0123456789'],
      ],
    })).toEqual({
      summary: 'Contact [REDACTED] or [REDACTED] about the submission.',
      values: [
        'safe label',
        ['Backup: [REDACTED]', 'Token [REDACTED]'],
      ],
    });
  });

  it('scrubs adversarially long free text without catastrophic backtracking', () => {
    // Each string is a near-miss for one scrubbing pattern: an email with no top-level
    // domain, a phone-shaped run that never terminates in a digit, and a token run with no
    // word boundary. Scrubbing runs before the size cap, so these arrive at full length.
    const snapshot = {
      summary: `a@${'a.'.repeat(40_000)}`,
      values: [`+${'1 '.repeat(40_000)}`, '_'.repeat(80_000)],
    };
    const startedAt = process.hrtime.bigint();

    const redacted = redactAuditSnapshot(snapshot) as { truncated?: true } | Record<string, unknown>;
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    expect(redacted).toBeTruthy();
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it('caps oversized snapshots at 64 KB with an explicit truncation marker', async () => {
    const capture = captureClient();

    await createAuditWriter(capture.client)({ userId: 'actor-1', roles: [] }, 'course.edit', { type: 'course', id: 'course-1' }, { manifest: 'long prose '.repeat(8_000), tail: 'must-not-survive' }, null);

    const truncated = capture.entry()?.before;
    expect(truncated).toEqual({
      truncated: true,
      bytes: expect.any(Number),
      preview: expect.stringContaining('[TRUNCATED]'),
    });
    expect((truncated as { bytes: number }).bytes).toBeGreaterThan(64 * 1024);
    const serialized = JSON.stringify(truncated);
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(64 * 1024);
    expect(serialized).toContain('[TRUNCATED]');
    expect(serialized).not.toContain('must-not-survive');
  });
});
