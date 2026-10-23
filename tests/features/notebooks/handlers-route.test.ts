import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enforceRateLimit: vi.fn().mockResolvedValue(undefined),
  loadNotebookContext: vi.fn(),
  supabaseService: vi.fn(() => ({})),
  requireApiUser:vi.fn(),
  getActor:vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock('@/lib/permissions',async(importOriginal)=>({...await importOriginal<typeof import('@/lib/permissions')>(),getActor:mocks.getActor}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));
vi.mock('@/features/notebooks/access', () => ({ loadNotebookContext: mocks.loadNotebookContext }));
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, enforceRateLimit: mocks.enforceRateLimit };
});

import { notebookHandler, NOTEBOOK_ACTION_RATE_LIMITS } from '@/features/notebooks/handlers';
import { RATE_LIMITS } from '@/lib/rate-limit';

const url = 'http://localhost/api/v1/notebooks/upload?courseId=course-1&itemId=assignment-1';
const actorHeaders = { 'content-type': 'application/json', 'X-Notebook-Actor': '11111111-1111-4111-8111-111111111111' };

describe('notebook route factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({id:'11111111-1111-4111-8111-111111111111'});
    mocks.getActor.mockResolvedValue({userId:'11111111-1111-4111-8111-111111111111',roles:[],authorization:{source:'database',accountStatus:'active',memberships:[],assignments:[]}});
    mocks.loadNotebookContext.mockResolvedValue({
      courseId: 'course-1', itemId: 'assignment-1', blockId: null,
      courseVersionId: '22222222-2222-4222-8222-222222222222', studio: false,
      notebook: {
        runtimeMode: 'jupyterlite', templateAssetId: 'template-1', templateChecksum: 'a'.repeat(64),
        runtimeProfileId: 'python-data-v1', runtimeProfileVersion: '1', datasets: [],
      },
    });
  });

  it('maps semantic upload validation to 4xx and applies global plus action limits', async () => {
    const response = await notebookHandler('upload', false)(new Request(url, {
      method: 'POST',
      headers: actorHeaders,
      body: JSON.stringify({ purpose: 'draft', filename: 'work.html', sizeBytes: 100, checksum: 'a'.repeat(64) }),
    }));

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'NOTEBOOK_FILE_TYPE' } });
    expect(mocks.loadNotebookContext).toHaveBeenCalledWith(expect.objectContaining({
      authorization:{source:'database',accountStatus:'active',memberships:[],assignments:[]},
    }),expect.objectContaining({courseId:'course-1',itemId:'assignment-1'}),false);
    expect(mocks.enforceRateLimit).toHaveBeenNthCalledWith(
      1, expect.anything(), expect.stringContaining('notebooks:mutation'), RATE_LIMITS.progress, expect.any(String),
    );
    expect(mocks.enforceRateLimit).toHaveBeenNthCalledWith(
      2, expect.anything(), expect.stringContaining('notebooks:upload'), NOTEBOOK_ACTION_RATE_LIMITS.upload, expect.any(String),
    );
  });

  it('rejects malformed locators before loading content or consuming mutation limits', async () => {
    const response = await notebookHandler('upload', false)(new Request(
      'http://localhost/api/v1/notebooks/upload?courseId=../other&itemId=assignment-1',
      { method: 'POST', headers:actorHeaders, body: '{}' },
    ));

    expect(response.status).toBe(400);
    expect(mocks.loadNotebookContext).not.toHaveBeenCalled();
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 428, 'NOTEBOOK_ACTOR_REQUIRED'],
    ['22222222-2222-4222-8222-222222222222', 401, 'NOTEBOOK_ACTOR_CHANGED'],
  ])('rejects actor precondition %s before loading or reserving a notebook', async (expectedActor,status,code) => {
    const response=await notebookHandler('upload',false)(new Request(url,{
      method:'POST',
      headers:{'content-type':'application/json',...(expectedActor?{'X-Notebook-Actor':expectedActor}:{})},
      body:JSON.stringify({purpose:'draft',filename:'work.ipynb',sizeBytes:100,checksum:'a'.repeat(64)}),
    }));
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({error:{code}});
    expect(mocks.loadNotebookContext).not.toHaveBeenCalled();
    expect(mocks.getActor).not.toHaveBeenCalled();
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
  });

  it.each(['session','upload'] as const)('rejects a suspended persisted actor before %s context or storage access',async(action)=>{
    mocks.getActor.mockResolvedValue({userId:'11111111-1111-4111-8111-111111111111',roles:[],authorization:{source:'database',accountStatus:'suspended',memberships:[],assignments:[]}});
    const response=await notebookHandler(action,false)(new Request(
      action==='session'?url.replace('/upload','/session'):url,
      action==='session'?undefined:{method:'POST',headers:actorHeaders,body:'{}'},
    ));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({error:{code:'ACCOUNT_INACTIVE'}});
    expect(mocks.loadNotebookContext).not.toHaveBeenCalled();
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
  });
});
