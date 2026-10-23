import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FIXTURES, fixtureResolver } from '@/content-engine/fixtures';

const { serviceMock } = vi.hoisted(() => ({ serviceMock: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: serviceMock }));

import { saveWorkspace, saveabilityReport, type SaveabilityDependencies, type StudioDatabase } from '@/features/studio/drafts';

class ReadOnlyClient {
  readonly calls: Array<{ table: string; columns: string; filters: Array<[string, unknown]> }> = [];
  readonly rpcCalls: string[] = [];

  constructor(private readonly lookupError: boolean = false) {}

  from(table: string) {
    const call = { table, columns: '', filters: [] as Array<[string, unknown]> };
    this.calls.push(call);
    return {
      select(columns: string) { call.columns = columns; return this; },
      eq(column: string, value: unknown) { call.filters.push([column, value]); return this; },
      maybeSingle: async () => this.lookupError
        ? { data: null, error: { message: 'lookup unavailable' } }
        : { data: { id: 'ai-build-sprint-01' }, error: null },
    };
  }

  async rpc(name: string) {
    this.rpcCalls.push(name);
    throw new Error(`Unexpected RPC: ${name}`);
  }
}

const actor = { userId: '00000000-0000-4000-8000-000000000001', roles: [{ role: 'editor' as const, branchId: null }] };
const draft = () => structuredClone(FIXTURES.minimal);
const deps = (client: ReadOnlyClient) => ({ client: client as unknown as StudioDatabase });

describe('saveabilityReport', () => {
  beforeEach(() => {
    serviceMock.mockReset();
    serviceMock.mockImplementation(() => { throw new Error('Service client fallback'); });
  });

  it('returns the save verdict through the supplied read-only client', async () => {
    const { manifest, items } = draft();
    const client = new ReadOnlyClient();

    const report = await saveabilityReport('minimal', manifest, items, deps(client));

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(client.calls).toEqual([{
      table: 'opportunities', columns: 'id',
      filters: [['id', 'ai-build-sprint-01'], ['status', 'published']],
    }]);
    expect(client.rpcCalls).toEqual([]);
    expect(serviceMock).not.toHaveBeenCalled();
  });

  it('checks references against the supplied client even if a resolver is injected', async () => {
    const { manifest, items } = draft();
    const client = new ReadOnlyClient(true);

    const report = await saveabilityReport('minimal', manifest, items, {
      client: client as unknown as StudioDatabase,
      resolver: fixtureResolver,
    } as unknown as SaveabilityDependencies);

    expect(report.errors.map((diagnostic) => diagnostic.code)).toContain('E_REFERENCE_LOOKUP_FAILED');
    expect(client.calls.map((call) => call.table)).toEqual(['opportunities']);
  });

  it('returns identity diagnostics without querying the client', async () => {
    const { manifest, items } = draft();
    (manifest as { id: string }).id = 'different-course';
    const client = new ReadOnlyClient();

    const report = await saveabilityReport('minimal', manifest, items, deps(client));

    expect(report.ok).toBe(false);
    expect(report.errors.map((diagnostic) => diagnostic.code)).toContain('E_WORKSPACE_ID_MISMATCH');
    expect(client.calls).toEqual([]);
    expect(serviceMock).not.toHaveBeenCalled();
  });

  it('reports a document byte limit and preserves the save route 413', async () => {
    const { manifest, items } = draft();
    (items.intro as { title: string }).title = 'x'.repeat(1_048_576);
    const client = new ReadOnlyClient();

    const report = await saveabilityReport('minimal', manifest, items, deps(client));

    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'E_LIMIT_EXCEEDED', meta: expect.objectContaining({ limit: 'bytes' }) }),
    ]));
    await expect(saveWorkspace('minimal', { manifest, items }, actor, '2026-09-02T00:00:00Z', deps(client)))
      .rejects.toMatchObject({ status: 413, code: 'DOCUMENT_TOO_LARGE' });
    expect(client.calls).toEqual([]);
    expect(client.rpcCalls).toEqual([]);
  });

  it('returns a retryable reference outage while the save route still raises 503', async () => {
    const { manifest, items } = draft();
    const client = new ReadOnlyClient(true);

    const report = await saveabilityReport('minimal', manifest, items, deps(client));

    expect(report.ok).toBe(false);
    expect(report.errors.map((diagnostic) => diagnostic.code)).toContain('E_REFERENCE_LOOKUP_FAILED');
    expect(report.errors.map((diagnostic) => diagnostic.code)).not.toContain('E_OPPORTUNITY_UNKNOWN');
    await expect(saveWorkspace('minimal', { manifest, items }, actor, '2026-09-02T00:00:00Z', deps(client)))
      .rejects.toMatchObject({ status: 503, code: 'REFERENCE_LOOKUP_UNAVAILABLE' });
    expect(client.rpcCalls).toEqual([]);
    expect(serviceMock).not.toHaveBeenCalled();
  });

  it('rejects a missing explicit client before any fallback is possible', async () => {
    const { manifest, items } = draft();

    await expect(saveabilityReport('minimal', manifest, items, { client: undefined } as unknown as { client: StudioDatabase }))
      .rejects.toThrow('Explicit Studio client is required');
    expect(serviceMock).not.toHaveBeenCalled();
  });
});
