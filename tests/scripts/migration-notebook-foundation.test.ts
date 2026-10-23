import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260906065957_notebook_foundation.sql'), 'utf8');

describe('notebook foundation migration', () => {
  it('keeps tables server-only and RPC execution restricted', () => {
    expect(sql.match(/enable row level security/gi)).toHaveLength(2);
    expect(sql).toMatch(/revoke all on public\.notebook_artifacts from anon, authenticated/i);
    expect(sql).toMatch(/grant select, insert, delete on public\.notebook_artifacts to service_role/i);
    expect(sql).toMatch(/grant select on public\.notebook_drafts to service_role/i);
    expect(sql.match(/security definer set search_path = ''/gi)).toHaveLength(2);
    expect(sql.match(/grant execute on function public\.(save_notebook_draft|finalize_notebook_artifact)/gi)).toHaveLength(2);
  });

  it('prevents any mutation or deletion after an artifact becomes ready', () => {
    expect(sql).toMatch(/if old\.status = 'ready' then[\s\S]*raise exception 'NOTEBOOK_ARTIFACT_IMMUTABLE'/i);
    expect(sql).toMatch(/before update or delete on public\.notebook_artifacts/i);
  });

  it('makes template provenance a real artifact reference and constrains MIME by purpose', () => {
    expect(sql).toMatch(/template_asset_id uuid references public\.notebook_artifacts\(id\)/i);
    expect(sql).toMatch(/purpose = 'dataset'[\s\S]*mime in \('text\/csv','application\/json'\)/i);
    expect(sql).toMatch(/purpose <> 'dataset'[\s\S]*mime = 'application\/x-ipynb\+json'/i);
  });

  it('keeps finalization idempotent under a row lock', () => {
    expect(sql).toMatch(/for update/i);
    expect(sql).toMatch(/if artifact\.status='ready' then return/i);
    expect(sql).toMatch(/update public\.notebook_artifacts[\s\S]*status='ready'/i);
  });
});
