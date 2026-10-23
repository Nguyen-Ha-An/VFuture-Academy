import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { stableStringify } from '@/content-engine/compile/checksum';
import { FIXTURES } from '@/content-engine/fixtures';
import { decodeItemImport } from '@/features/studio/content-transfer';
import type { CourseDraft, StudioDatabase } from '@/features/studio/drafts';
import { createWorkspaceState, importWorkspaceItemLocally, workspacePayload } from '@/features/studio/workspace-state';
import { ApiError } from '@/lib/api';

vi.mock('server-only', () => ({}));
const { serviceMock } = vi.hoisted(() => ({ serviceMock: vi.fn(() => { throw new Error('Service client fallback'); }) }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: serviceMock }));

import { saveWorkspace } from '@/features/studio/drafts';
import { simulateStudioImport } from '@/features/studio-mcp/validation/simulate-import';

type ReadCall = { table: string; columns: string; filters: Array<[string, unknown]>; limit?: number };
type RpcCall = { name: string; args: Record<string, unknown> };

class StubbedPersistenceAttempt extends Error {}

/** Every reference lookup gets the same fixed answer in the simulator and Studio path. */
class RecordingClient {
  readonly reads: ReadCall[] = [];
  readonly rpcCalls: RpcCall[] = [];

  from(table: string) {
    if (table !== 'cms_review_requests' && table !== 'opportunities') throw new Error(`Unexpected table: ${table}`);
    const call: ReadCall = { table, columns: '', filters: [] };
    this.reads.push(call);
    const answer = () => table === 'cms_review_requests'
      ? { data: [], error: null }
      : { data: { id: 'ai-build-sprint-01' }, error: null };
    return {
      select(columns: string) { call.columns = columns; return this; },
      eq(column: string, value: unknown) { call.filters.push([column, value]); return this; },
      limit(value: number) { call.limit = value; return this; },
      maybeSingle: async () => answer(),
      then<TResult1 = ReturnType<typeof answer>, TResult2 = never>(
        fulfilled?: ((value: ReturnType<typeof answer>) => TResult1 | PromiseLike<TResult1>) | null,
        rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): PromiseLike<TResult1 | TResult2> {
        return Promise.resolve(answer()).then(fulfilled, rejected);
      },
    };
  }

  async rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    if (name !== 'studio_save_draft_workspace') throw new Error(`Unexpected RPC: ${name}`);
    // Reaching this RPC proves the real save preflight accepted the payload. No write is made.
    throw new StubbedPersistenceAttempt();
  }

  referenceReads() { return this.reads.filter((call) => call.table === 'opportunities'); }
}

const actor = { userId: '00000000-0000-4000-8000-000000000001', roles: [{ role: 'editor' as const, branchId: null }] };
const updatedAt = '2026-09-26T00:00:00Z';
const itemHash = (item: unknown) => `sha256:${createHash('sha256').update(stableStringify(item)).digest('hex')}`;

function draft(): CourseDraft {
  const fixture = structuredClone(FIXTURES.minimal);
  return {
    id: 'draft-minimal', courseId: 'minimal', ...fixture,
    baseVersionId: null, checklist: {}, updatedAt,
  };
}

/** Replays what a person pastes into Studio, then invokes Studio's actual save gate. */
async function studioPasteAndSavePreflight(base: CourseDraft, proposed: Record<string, unknown>, client: RecordingClient) {
  const decoded = decodeItemImport(JSON.stringify(proposed, null, 2));
  expect(decoded.ok).toBe(true);
  if (!decoded.ok) throw new Error('The proposed item did not reach Studio import');
  const state = createWorkspaceState(base);
  const imported = importWorkspaceItemLocally(state, decoded.value.document, 'm1');
  const payload = workspacePayload(imported);
  expect(payload).not.toBeNull();
  if (!payload) throw new Error('The proposed item did not reach Studio save');

  try {
    await saveWorkspace(base.courseId, payload, actor, updatedAt, { client: client as unknown as StudioDatabase });
  } catch (error) {
    if (error instanceof StubbedPersistenceAttempt) return { saveable: true, rejectedCode: null };
    if (error instanceof ApiError && (error.status === 422 || error.status === 413)) {
      return { saveable: false, rejectedCode: error.code };
    }
    throw error;
  }
  throw new Error('The recording RPC did not intercept Studio persistence');
}

describe('simulateStudioImport and Studio save preflight parity', () => {
  beforeEach(() => {
    serviceMock.mockClear();
  });

  it('accepts the same valid item and only reaches the recording save RPC in Studio', async () => {
    const base = draft();
    const proposed = structuredClone(base.items.intro) as Record<string, unknown>;
    proposed.title = 'Updated welcome';
    const simulationClient = new RecordingClient();
    const studioClient = new RecordingClient();

    const simulation = await simulateStudioImport({
      draft: base, courseId: base.courseId, itemId: 'intro', baseItemHash: itemHash(base.items.intro),
      document: proposed, client: simulationClient as unknown as StudioDatabase,
    });
    const studio = await studioPasteAndSavePreflight(base, proposed, studioClient);

    expect(simulation.importText).toBe(JSON.stringify(proposed, null, 2));
    expect(simulation.valid).toBe(studio.saveable);
    expect(simulation.errors).toEqual([]);
    expect(studio).toEqual({ saveable: true, rejectedCode: null });
    expect(simulationClient.rpcCalls).toEqual([]);
    expect(studioClient.rpcCalls.map((call) => call.name)).toEqual(['studio_save_draft_workspace']);
    expect(studioClient.rpcCalls[0]?.args).toMatchObject({ course_id: 'minimal', expected_updated_at: updatedAt });
    expect(studioClient.rpcCalls[0]?.args.items).toMatchObject({ intro: { title: 'Updated welcome' } });
    expect(simulationClient.referenceReads()).toEqual(studioClient.referenceReads());
    expect(studioClient.referenceReads()).toEqual([{
      table: 'opportunities', columns: 'id',
      filters: [['id', 'ai-build-sprint-01'], ['status', 'published']],
    }]);
    expect(serviceMock).not.toHaveBeenCalled();
  });

  it('rejects the same semantic-invalid item before either path can persist it', async () => {
    const base = draft();
    const proposed = structuredClone(base.items.intro) as { blocks: Record<string, unknown>[] } & Record<string, unknown>;
    proposed.blocks.push({
      id: 'missing-target', type: 'next_step', title: 'Continue',
      target: { kind: 'lesson', id: 'not-in-course' },
    });
    const simulationClient = new RecordingClient();
    const studioClient = new RecordingClient();

    const simulation = await simulateStudioImport({
      draft: base, courseId: base.courseId, itemId: 'intro', baseItemHash: itemHash(base.items.intro),
      document: proposed, client: simulationClient as unknown as StudioDatabase,
    });
    const studio = await studioPasteAndSavePreflight(base, proposed, studioClient);

    expect(simulation.valid).toBe(studio.saveable);
    expect(simulation.valid).toBe(false);
    expect(simulation.errors).toContainEqual(expect.objectContaining({
      code: 'E_NEXT_STEP_TARGET_UNKNOWN', layer: 'save',
    }));
    expect(studio).toEqual({ saveable: false, rejectedCode: 'INVALID_WORKSPACE' });
    expect(simulationClient.rpcCalls).toEqual([]);
    expect(studioClient.rpcCalls).toEqual([]);
    expect(simulationClient.referenceReads()).toEqual(studioClient.referenceReads());
    expect(studioClient.referenceReads()).toHaveLength(1);
    expect(serviceMock).not.toHaveBeenCalled();
  });
});
