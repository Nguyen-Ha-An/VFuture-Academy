import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { FIXTURES, fixtureResolver } from '@/content-engine/fixtures';
import { parseWorkspace } from '@/content-engine/validate';
import { encodeWorkspaceEnvelope } from '@/features/studio/content-transfer';
import { importNewCourse, type StudioDatabase } from '@/features/studio/drafts';
import { createAzureDataClient } from '@/lib/database/azure-client';

vi.mock('server-only', () => ({}));

const actor = { userId: '00000000-0000-4000-8000-000000000001', roles: [{ role: 'editor' as const, branchId: null }] };
const sql = readFileSync(new URL('../../../supabase/migrations/0034_studio_atomic_workspace.sql', import.meta.url), 'utf8');
const signature = sql.match(/create function public\.studio_import_course\(([^)]+)\)/i)?.[1];
if (!signature) throw new Error('Course import SQL signature missing');
const parameterNames = signature.split(',').map(parameter => parameter.trim().split(/\s+/)[0]).sort();

describe('course import PostgREST contract', () => {
  it('routes a backup import through Azure with exactly the deployed SQL parameters', async () => {
    const parsed = parseWorkspace(FIXTURES.minimal).parsed;
    if (!parsed) throw new Error('Fixture must parse');
    const backup = encodeWorkspaceEnvelope({ manifest: parsed.manifest, items: parsed.items, baseVersionId: '11111111-2222-4333-8444-555555555555' });
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url, body });
      if (Object.keys(body).sort().join(',') !== parameterNames.join(',')) {
        return Response.json({ code: 'PGRST202', message: 'Could not find the function with these parameters' }, { status: 404 });
      }
      return Response.json({ conflict: false, draft: {
        id: 'draft-imported', course_id: body.course_id, manifest: body.manifest, items: body.items,
        base_version_id: null, checklist: {}, updated_at: '2026-11-05T00:00:00Z',
      } });
    };
    const client = createAzureDataClient('service_role', undefined, {
      AZURE_POSTGREST_URL: 'https://data.example.test/', AZURE_POSTGREST_JWT_SECRET: 'a'.repeat(40),
    }, fetcher);

    await expect(importNewCourse(JSON.stringify(backup), actor, { client: client as unknown as StudioDatabase, resolver: fixtureResolver }))
      .resolves.toMatchObject({ draft: { courseId: 'minimal', baseVersionId: null } });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://data.example.test/rpc/studio_import_course');
    expect(Object.keys(requests[0].body).sort()).toEqual(parameterNames);
    expect(requests[0].body.actor_id).toBe(actor.userId);
  });
});
