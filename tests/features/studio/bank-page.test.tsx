import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: `question-${index + 1}`,
    type: 'single_choice',
    tags: ['ai'],
    difficulty: 'easy',
    status: 'draft',
  }));
  const service = {
    list: vi.fn().mockResolvedValue(rows),
    usagesMany: vi.fn().mockResolvedValue(new Map(rows.map((row) => [row.id, []]))),
  };
  return {
    rows,
    service,
    list: vi.fn().mockResolvedValue(rows),
    usages: vi.fn().mockResolvedValue([]),
    requirePermission: vi.fn().mockResolvedValue({ userId: 'editor-1', roles: [{ role: 'editor', branchId: null }] }),
    createBankService: vi.fn(() => service),
    actorPermissionCheck: vi.fn(() => vi.fn()),
    bankFiltersFromUrl: vi.fn().mockReturnValue({ types: ['single_choice'], page: 2 }),
  };
});

vi.mock('server-only', () => ({}));
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn().mockResolvedValue((key: string) => key) }));
vi.mock('@/lib/permissions', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/features/admin/context', () => ({
  adminPageContext: async () => ({ actor: await mocks.requirePermission('bank.edit'), scope: { kind: 'central' } }),
}));
vi.mock('@/features/admin/content-review-production', () => ({
  typedContentPageContext: async () => ({ actor: await mocks.requirePermission('bank.edit'), scope: { kind: 'central' } }),
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => ({})) }));
vi.mock('@/features/bank/service', () => ({
  actorPermissionCheck: mocks.actorPermissionCheck,
  bankFiltersFromUrl: mocks.bankFiltersFromUrl,
  createBankService: mocks.createBankService,
  list: mocks.list,
  usages: mocks.usages,
  BANK_PAGE_SIZE: 50,
}));

import StudioBankPage from '@/app/studio/bank/page';

describe('Studio bank page queries', () => {
  it('resolves the actor once and batches usages for every server-filtered row', async () => {
    await StudioBankPage({
      searchParams: Promise.resolve({ type: 'single_choice', page: '2' }),
    });

    expect(mocks.requirePermission).toHaveBeenCalledTimes(1);
    expect(mocks.createBankService).toHaveBeenCalledTimes(1);
    expect(mocks.service.list).toHaveBeenCalledWith({ types: ['single_choice'], page: 2 });
    expect(mocks.service.usagesMany).toHaveBeenCalledTimes(1);
    expect(mocks.service.usagesMany).toHaveBeenCalledWith(mocks.rows.map((row) => row.id));
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.usages).not.toHaveBeenCalled();
  });
});
