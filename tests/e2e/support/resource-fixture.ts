import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { APIRequestContext } from '@playwright/test';
import { assertE2EResetTarget } from './reset';

type Fixture = {
  id: string;
  assetId: string;
  title: string;
  updatedTitle: string;
  registerAdminRequest(request: APIRequestContext): void;
};

export async function withDisposableResource(run: (fixture: Fixture) => Promise<void>) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.SEED_ADMIN_EMAIL?.trim();
  if (!url || !key || !email) throw new Error('Resource acceptance requires Supabase cleanup credentials and seeded admin email.');
  assertE2EResetTarget(url, process.env);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1_000 });
  const owner = users.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
  if (users.error || !owner) throw new Error('Seeded resource owner was not found.');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const id = `recovery-resource-${suffix}`;
  const assetId = `asset_recovery_resource_${suffix}`;
  const path = `${owner.id}/recovery/${suffix}.txt`;
  const bytes = Buffer.from(`resource attachment ${suffix}`);
  let objectCreated = false;
  let namespaceVerified = false;
  let adminRequest: APIRequestContext | undefined;
  let primary: unknown;

  try {
    const [existingResource, existingAsset] = await Promise.all([
      admin.from('resources').select('id').eq('id', id).maybeSingle(),
      admin.from('media_assets').select('id').eq('id', assetId).maybeSingle(),
    ]);
    if (existingResource.error || existingResource.data || existingAsset.error || existingAsset.data) {
      throw new Error('Disposable resource namespace is not empty.');
    }
    namespaceVerified = true;
    const upload = await admin.storage.from('media').upload(path, bytes, { contentType: 'text/plain', upsert: false });
    if (upload.error) throw new Error('Disposable resource attachment upload failed.');
    objectCreated = true;
    const asset = await admin.from('media_assets').insert({ id: assetId, owner_id: owner.id, bucket: 'media', path, mime: 'text/plain', size_bytes: bytes.length }).select('id').single();
    if (asset.error || asset.data?.id !== assetId) throw new Error('Disposable resource attachment record failed.');
    await run({
      id,
      assetId,
      title: `Recovery resource ${suffix}`,
      updatedTitle: `Updated resource ${suffix}`,
      registerAdminRequest(request) { adminRequest = request; },
    });
  } catch (error) {
    primary = error;
  }

  const failures: Error[] = [];
  if (namespaceVerified) try {
    const resource = await admin.from('resources').select('id,owner_id,document,status,updated_at').eq('id', id).maybeSingle();
    if (resource.error || (resource.data && (resource.data.owner_id !== owner.id || resource.data.document?.id !== id
      || ![`Recovery resource ${suffix}`, `Updated resource ${suffix}`].includes(resource.data.document?.title?.en)))) {
      throw new Error('Resource cleanup ownership verification failed.');
    }
    if (resource.data) {
      if (resource.data.status === 'published') {
        if (!adminRequest) throw new Error('Published resource cleanup requires the registered authorized request context.');
        const unpublished = await adminRequest.put(`/api/v1/studio/resources/${encodeURIComponent(id)}`, {
          data: { document: resource.data.document, expectedUpdatedAt: resource.data.updated_at, unpublish: true },
          timeout: 15_000,
        });
        if (!unpublished.ok()) throw new Error(`Resource unpublish cleanup failed: HTTP ${unpublished.status()}.`);
      }
      const draft = await admin.from('resources').select('id,owner_id,status').eq('id', id).maybeSingle();
      if (draft.error || draft.data?.owner_id !== owner.id || draft.data.status !== 'draft') throw new Error('Resource unpublish cleanup verification failed.');
      const removed = await admin.from('resources').delete().eq('id', id).eq('owner_id', owner.id).eq('status', 'draft').select('id').single();
      if (removed.error || removed.data?.id !== id) throw new Error('Resource cleanup failed.');
      const absent = await admin.from('resources').select('id').eq('id', id).maybeSingle();
      if (absent.error || absent.data) throw new Error('Resource cleanup absence verification failed.');
    }
    const audits = await admin.from('audit_log').delete().eq('target_type', 'resource').eq('target_id', id);
    if (audits.error) throw new Error('Resource audit cleanup failed.');
  } catch (error) { failures.push(error instanceof Error ? error : new Error('Resource cleanup failed.')); }

  if (objectCreated) {
    try {
      const current = await admin.from('media_assets').select('id,owner_id,bucket,path').eq('id', assetId).maybeSingle();
      if (current.error || (current.data && (current.data.owner_id !== owner.id || current.data.bucket !== 'media' || current.data.path !== path))) throw new Error('Attachment cleanup ownership verification failed.');
      if (!path.startsWith(`${owner.id}/recovery/`) || path.includes('..')) throw new Error('Attachment storage path failed its namespace guard.');
      const stored = await admin.storage.from('media').remove([path]);
      if (stored.error) throw new Error('Attachment object cleanup failed.');
      if (current.data) {
        const removed = await admin.from('media_assets').delete().eq('id', assetId).eq('owner_id', owner.id).eq('bucket', 'media').eq('path', path).select('id').single();
        if (removed.error || removed.data?.id !== assetId) throw new Error('Attachment record cleanup failed.');
      }
    } catch (error) { failures.push(error instanceof Error ? error : new Error('Attachment cleanup failed.')); }
  }
  if (failures.length) throw new AggregateError(primary ? [primary, ...failures] : failures, 'Resource journey cleanup failed.');
  if (primary) throw primary;
}
