import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { deleteMediaAsset, type MediaDeletionDatabase } from '@/features/media/delete';

function fixture({ beginError = null, removeError = null, infoError = { statusCode: '404' }, deleted = false }: { beginError?: {message:string;code?:string}|null; removeError?: {statusCode:string}|null; infoError?: {statusCode:string}|null; deleted?: boolean } = {}) {
  const events: string[] = [];
  let finalized = false;
  const database: MediaDeletionDatabase = {
    async rpc(name) {
      events.push(name);
      if (name === 'academy_media_delete_begin') return { data: { id: 'asset_ONE', bucket: 'media', path: 'media/asset_ONE/file.pdf', state: deleted ? 'deleted' : 'pending' }, error: beginError };
      finalized = true;
      return { data: { id: 'asset_ONE', state: 'deleted' }, error: null };
    },
    storage: { from() { return {
      async remove() { events.push('remove'); return { error: removeError }; },
      async info() { events.push('info'); return { data: infoError ? null : {}, error: infoError }; },
    }; } },
  };
  return { database, events, finalized: () => finalized };
}
const actor = { userId: 'user-one', roles: [] };
const scope = { kind: 'central' as const };
describe('media deletion', () => {
  it('fences the asset before removal and finalizes only after remote absence', async () => {
    const f = fixture();
    await expect(deleteMediaAsset({ database:f.database, actor, scope, assetId:'asset_ONE' })).resolves.toEqual({ id:'asset_ONE', deleted:true });
    expect(f.events).toEqual(['academy_media_delete_begin', 'remove', 'info', 'academy_media_delete_finish']);
    expect(f.finalized()).toBe(true);
  });
  it.each(['MEDIA_IN_USE', 'MEDIA_PROTECTED', 'MEDIA_REVIEW_PENDING'])('retains referenced/protected files on %s', async message => {
    const f = fixture({beginError:{message}});
    await expect(deleteMediaAsset({database:f.database, actor, scope, assetId:'asset_ONE'})).rejects.toMatchObject({status:409});
    expect(f.events).toEqual(['academy_media_delete_begin']);
    expect(f.finalized()).toBe(false);
  });
  it('denies unauthorized actors before reaching storage', async () => {
    const f = fixture({beginError:{message:'FORBIDDEN',code:'42501'}});
    await expect(deleteMediaAsset({database:f.database,actor,scope,assetId:'asset_ONE'})).rejects.toMatchObject({status:403});
    expect(f.events).toEqual(['academy_media_delete_begin']);
  });
  it('retries a missing object idempotently but still verifies absence', async () => {
    const f = fixture({removeError:{statusCode:'404'}});
    await expect(deleteMediaAsset({database:f.database,actor,scope,assetId:'asset_ONE'})).resolves.toMatchObject({deleted:true});
    expect(f.events).toContain('info');
  });
  it.each([{removeError:{statusCode:'500'}},{infoError:{statusCode:'403'}},{infoError:null}])('retains a pending asset and quota on unknown storage outcome %j', async options => {
    const f=fixture(options);
    await expect(deleteMediaAsset({database:f.database,actor,scope,assetId:'asset_ONE'})).rejects.toMatchObject({status:503});
    expect(f.finalized()).toBe(false);
  });
  it('does not report success when finalization remains pending', async () => {
    const f = fixture();
    const rpc = f.database.rpc.bind(f.database);
    f.database.rpc = (name, args) => name === 'academy_media_delete_finish'
      ? Promise.resolve({ data: { id: 'asset_ONE', state: 'pending' }, error: null })
      : rpc(name, args);
    await expect(deleteMediaAsset({database:f.database,actor,scope,assetId:'asset_ONE'})).rejects.toMatchObject({status:503});
  });
  it('acknowledges a previously completed deletion without deleting again', async () => {
    const f=fixture({deleted:true});
    await expect(deleteMediaAsset({database:f.database,actor,scope,assetId:'asset_ONE'})).resolves.toMatchObject({deleted:true});
    expect(f.events).toEqual(['academy_media_delete_begin']);
  });
});
