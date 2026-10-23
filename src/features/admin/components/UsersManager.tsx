'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

import { Button, Input } from '@/components/ui/classic';
import type { Branch } from '@/features/admin/branches';
import type { AdminUser, UserSearchResult } from '@/features/admin/users';
import type { Role } from '@/lib/permissions';

type Envelope<T> = { data?: T; error?: { message?: string } };
type SearchFilters = { query: string; branchId: string };
const branchLeadRoles: Role[] = ['instructor', 'contributor'];
const globalRoles: Role[] = ['contributor', 'instructor', 'branch_lead', 'editor', 'admin'];
const globalOnlyRoles = new Set<Role>(['contributor', 'editor']);

async function responseData<T>(response: Response): Promise<T> {
  const body = await response.json() as Envelope<T>;
  if (!response.ok || body.data === undefined) throw new Error(body.error?.message ?? 'request_failed');
  return body.data;
}

export function UsersManager({
  branches,
  fixedBranchId,
  canManageGlobal,
}: {
  branches: Branch[];
  fixedBranchId: string | null;
  canManageGlobal: boolean;
}) {
  const t = useTranslations('studio.admin');
  const [branchId, setBranchId] = useState(fixedBranchId ?? (canManageGlobal ? '' : branches[0]?.id ?? ''));
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userRevisions, setUserRevisions] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [committedSearch, setCommittedSearch] = useState<SearchFilters | null>(null);
  const [loading, setLoading] = useState(false);
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Record<string, Role>>({});
  const [selectedRoleBranches, setSelectedRoleBranches] = useState<Record<string, string>>({});
  const searchGenerationRef = useRef(0);
  const activeSearchRef = useRef<string | null>(null);
  const activeMutationRef = useRef<string | null>(null);

  async function loadUsers(nextPage = 1, filters = committedSearch ?? { query, branchId }) {
    const requestKey = `${filters.query}\u0000${filters.branchId}\u0000${nextPage}`;
    if (activeSearchRef.current === requestKey) return;
    const generation = ++searchGenerationRef.current;
    activeSearchRef.current = requestKey;
    setLoading(true);
    setStatus(t('loading'));
    const params = new URLSearchParams({ query: filters.query, page: String(nextPage), pageSize: '20' });
    if (filters.branchId) params.set('branchId', filters.branchId);
    try {
      const result = await responseData<UserSearchResult>(await fetch(`/api/v1/studio/users?${params}`));
      if (searchGenerationRef.current !== generation) return;
      setUsers(result.items);
      setPage(result.page);
      setHasMore(result.hasMore);
      setCommittedSearch(filters);
      setStatus(result.items.length ? '' : t('noUsers'));
    } catch (error) {
      if (searchGenerationRef.current === generation) {
        setStatus(error instanceof Error && error.message !== 'request_failed' ? error.message : t('loadError'));
      }
    } finally {
      if (searchGenerationRef.current === generation) {
        activeSearchRef.current = null;
        setLoading(false);
      }
    }
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadUsers(1, { query, branchId });
  }

  function replaceUser(updated: AdminUser) {
    setUsers((current) => current.map((user) => user.id === updated.id ? updated : user));
    setUserRevisions((current) => ({ ...current, [updated.id]: (current[updated.id] ?? 0) + 1 }));
  }

  async function assignBranch(event: FormEvent<HTMLFormElement>, user: AdminUser) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const nextBranch = fixedBranchId ?? (String(values.get('branchId') ?? '') || null);
    const key = `branch:${user.id}`;
    if (activeMutationRef.current) return;
    activeMutationRef.current = key;
    setMutationKey(key);
    setStatus(t('saving'));
    try {
      replaceUser(await responseData<AdminUser>(await fetch(`/api/v1/studio/users/${encodeURIComponent(user.id)}/branch`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: nextBranch }),
      })));
      setStatus(t('saved'));
    } catch (error) {
      setStatus(error instanceof Error && error.message !== 'request_failed' ? error.message : t('saveError'));
    } finally {
      activeMutationRef.current = null;
      setMutationKey(null);
    }
  }

  async function changeRole(event: FormEvent<HTMLFormElement>, user: AdminUser) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const role = String(values.get('role')) as Role;
    const roleBranch = fixedBranchId ?? (String(values.get('roleBranchId') ?? '') || null);
    const key = `role:${user.id}`;
    if (activeMutationRef.current) return;
    activeMutationRef.current = key;
    setMutationKey(key);
    setStatus(t('saving'));
    try {
      replaceUser(await responseData<AdminUser>(await fetch(`/api/v1/studio/users/${encodeURIComponent(user.id)}/roles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, branchId: roleBranch, enabled: submitter?.value === 'true' }),
      })));
      setStatus(t('saved'));
    } catch (error) {
      setStatus(error instanceof Error && error.message !== 'request_failed' ? error.message : t('saveError'));
    } finally {
      activeMutationRef.current = null;
      setMutationKey(null);
    }
  }

  return (
    <section className="space-y-8" aria-labelledby="users-title">
      <div>
        <p className="font-mono text-xs font-medium tracking-[0.16em] text-primary uppercase">{t('eyebrow')}</p>
        <h1 id="users-title" className="mt-3 text-3xl font-semibold tracking-tight">{t('usersTitle')}</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">{t('usersDescription')}</p>
      </div>

      <form onSubmit={submitSearch} className="grid gap-4 rounded-lg border border-border bg-card p-5 md:grid-cols-[minmax(12rem,1fr)_minmax(10rem,16rem)_auto] md:items-end">
        <label className="grid gap-2 text-sm font-medium" htmlFor="user-search">
          {t('searchLabel')}
          <Input id="user-search" value={query} onChange={(event) => setQuery(event.target.value)} minLength={3} maxLength={160} required />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="user-search-branch">
          {t('branch')}
          <select id="user-search-branch" value={branchId} disabled={fixedBranchId !== null} onChange={(event) => setBranchId(event.target.value)} className="min-h-10 rounded-md border border-input bg-background px-3">
            {canManageGlobal && <option value="">{t('allBranches')}</option>}
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
        <Button type="submit">{t('searchUsers')}</Button>
      </form>

      <div className="grid gap-5">
        {users.map((user) => (
          <article key={`${user.id}:${userRevisions[user.id] ?? 0}`} className="space-y-5 rounded-lg border border-border bg-card p-5">
            <div>
              <h2 className="font-semibold">{user.displayName}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{user.email}{user.handle ? ` · @${user.handle}` : ''}</p>
              <p className="mt-2 text-xs text-muted-foreground">{t('roles')}: {user.roles.length ? user.roles.map((role) => `${t(`rolesMap.${role.role}`)} (${role.branchId ?? t('globalScope')})`).join(', ') : t('noRoles')}</p>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <form onSubmit={(event) => assignBranch(event, user)} className="grid gap-3 rounded-md bg-muted p-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="grid gap-2 text-sm font-medium" htmlFor={`assigned-branch-${user.id}`}>
                  {t('assignedBranch', { name: user.displayName })}
                  <select id={`assigned-branch-${user.id}`} name="branchId" defaultValue={fixedBranchId ?? user.branchId ?? ''} disabled={fixedBranchId !== null} className="min-h-10 rounded-md border border-input bg-background px-3">
                    {canManageGlobal && <option value="">{t('unassigned')}</option>}
                    {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </label>
                <Button type="submit" disabled={mutationKey !== null}>{mutationKey === `branch:${user.id}` ? t('saving') : t('assignBranch')}</Button>
              </form>

              {(() => {
                const selectedRole = selectedRoles[user.id] ?? (canManageGlobal ? 'contributor' : 'instructor');
                const selectedRoleBranch = selectedRoleBranches[user.id] ?? fixedBranchId ?? user.branchId ?? '';
                const invalidGrantScope = globalOnlyRoles.has(selectedRole) && selectedRoleBranch !== '';
                return <form onSubmit={(event) => changeRole(event, user)} className="grid gap-3 rounded-md bg-muted p-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium" htmlFor={`role-${user.id}`}>
                  {t('roleFor', { name: user.displayName })}
                  <select id={`role-${user.id}`} name="role" value={selectedRole} onChange={(event) => setSelectedRoles((current) => ({ ...current, [user.id]: event.target.value as Role }))} className="min-h-10 rounded-md border border-input bg-background px-3">
                    {(canManageGlobal ? globalRoles : branchLeadRoles).map((role) => <option key={role} value={role}>{t(`rolesMap.${role}`)}</option>)}
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-medium" htmlFor={`role-branch-${user.id}`}>
                  {t('roleScope')}
                  <select id={`role-branch-${user.id}`} name="roleBranchId" value={selectedRoleBranch} onChange={(event) => setSelectedRoleBranches((current) => ({ ...current, [user.id]: event.target.value }))} disabled={fixedBranchId !== null} className="min-h-10 rounded-md border border-input bg-background px-3">
                    {canManageGlobal && <option value="">{t('globalScope')}</option>}
                    {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </label>
                {invalidGrantScope ? <p className="text-sm text-destructive sm:col-span-2">{t('globalContentRoleHint')}</p> : null}
                <div className="flex gap-2 sm:col-span-2">
                  <Button type="submit" name="enabled" value="true" disabled={mutationKey !== null || invalidGrantScope}>{mutationKey === `role:${user.id}` ? t('saving') : t('grantRole')}</Button>
                  <Button type="submit" name="enabled" value="false" disabled={mutationKey !== null} className="bg-secondary text-secondary-foreground hover:bg-secondary/80">{mutationKey === `role:${user.id}` ? t('saving') : t('revokeRole')}</Button>
                </div>
              </form>;
              })()}
            </div>
          </article>
        ))}
      </div>

      {(page > 1 || hasMore) && <nav aria-label={t('pagination')} className="flex items-center gap-3">
        <Button disabled={page <= 1 || loading} onClick={() => void loadUsers(page - 1)}>{t('previous')}</Button>
        <span className="text-sm text-muted-foreground">{t('page', { page })}</span>
        <Button disabled={!hasMore || loading} onClick={() => void loadUsers(page + 1)}>{t('next')}</Button>
      </nav>}
      <p role="status" aria-live="polite" className="min-h-6 text-sm text-muted-foreground">{status}</p>
    </section>
  );
}
