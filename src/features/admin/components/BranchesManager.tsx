'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { PlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Branch } from '@/features/admin/branches';
import { DataCard, EmptyState, RowActions, StatCard, StatGrid, type RowAction } from '@/features/staff-ui/components';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
import { routes } from '@/lib/routes';

type Envelope<T> = { data?: T; error?: { message?: string } };

async function responseData<T>(response: Response): Promise<T> {
  const body = await response.json() as Envelope<T>;
  if (!response.ok || body.data === undefined) throw new Error(body.error?.message ?? 'request_failed');
  return body.data;
}

/** One school's report row, already reduced to what the table shows. */
export type SchoolReportCells = {
  activeLearners30d: number;
  enrollments: number;
  completedEnrollments: number;
  /** null when the school has no enrollments yet. */
  completionPercent: number | null;
  pendingGrading: number;
  /** null when the school has no grades yet. */
  averagePercent: number | null;
};

export type BranchesManagerProps = {
  initialBranches: Branch[];
  /**
   * Per-school report cells keyed by branch id. Leave undefined when the viewer may not read
   * reports (the columns are not rendered); 'unavailable' when the read failed (columns say so).
   */
  reports?: Record<string, SchoolReportCells> | 'unavailable';
  /** Central branch.manage: shows "New school" and the per-row Edit action. */
  canManage?: boolean;
  showHeading?: boolean;
};

type EditorState = { mode: 'create' } | { mode: 'edit'; branch: Branch };

/**
 * /admin/branches: KPI row, one schools table and one Sheet shared by "New school" and Edit.
 * Props are plain data so the admin harness can render it with fixtures.
 */
export function BranchesManager({ initialBranches, reports, canManage = false, showHeading = true }: BranchesManagerProps) {
  const t = useTranslations('studio.admin');
  const tc = useTranslations('centralAdmin');
  const to = useTranslations('staffUi.admin.org.schools');
  const format = useFormatter();
  const [branches, setBranches] = useState(initialBranches);
  const [status, setStatus] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheetError, setSheetError] = useState('');

  const showReports = reports !== undefined;
  const reportRows = reports === 'unavailable' ? null : reports ?? null;

  function openEditor(next: EditorState) {
    setSheetError('');
    setStatus('');
    setEditor(next);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || saving) return;
    const values = new FormData(event.currentTarget);
    const city = String(values.get('city') ?? '').trim() || null;
    const name = String(values.get('name') ?? '');
    setSaving(true);
    setSheetError('');
    setStatus(t('saving'));
    try {
      if (editor.mode === 'create') {
        const branch = await responseData<Branch>(await fetch('/api/v1/studio/branches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: values.get('id'), name, city }),
        }));
        setBranches((current) => [...current.filter((candidate) => candidate.id !== branch.id), branch]
          .sort((left, right) => left.name.localeCompare(right.name)));
      } else {
        const id = editor.branch.id;
        const branch = await responseData<Branch>(await fetch(`/api/v1/studio/branches/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, city }),
        }));
        setBranches((current) => current.map((candidate) => candidate.id === id ? branch : candidate)
          .sort((left, right) => left.name.localeCompare(right.name)));
      }
      setEditor(null);
      setStatus(t('saved'));
    } catch {
      setStatus('');
      setSheetError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  const count = (value: number) => format.number(value);
  const percent = (value: number | null) => value === null ? '—' : format.number(value / 100, { style: 'percent', maximumFractionDigits: 1 });
  const totals = reportRows ? Object.values(reportRows).reduce(
    (sum, row) => ({ enrollments: sum.enrollments + row.enrollments, pendingGrading: sum.pendingGrading + row.pendingGrading }),
    { enrollments: 0, pendingGrading: 0 },
  ) : null;

  const newSchool = canManage ? (
    <Button onClick={() => openEditor({ mode: 'create' })}>
      <PlusIcon aria-hidden="true" />
      {to('newSchool')}
    </Button>
  ) : null;

  const reportCell = (branchId: string, render: (row: SchoolReportCells) => string) => {
    if (reports === 'unavailable') return <span className="text-muted-foreground">{to('unavailable')}</span>;
    const row = reportRows?.[branchId];
    return row ? render(row) : <span className="text-muted-foreground">—</span>;
  };

  const editing = editor?.mode === 'edit' ? editor.branch : null;

  return (
    <div className="space-y-6">
      {showHeading ? <StaffPageHeader title={tc('schools')} description={to('description')} actions={newSchool} /> : null}

      <StatGrid>
        <StatCard label={to('stats.schools')} value={branches.length} />
        {showReports ? <>
          <StatCard label={to('stats.enrollments')} value={totals?.enrollments ?? null} unavailableLabel={to('unavailable')} />
          <StatCard label={to('stats.pendingGrading')} value={totals?.pendingGrading ?? null} unavailableLabel={to('unavailable')} />
        </> : null}
      </StatGrid>

      <DataCard
        title={to('listTitle')}
        description={reports === 'unavailable' ? to('reportsUnavailable') : to('total', { count: branches.length })}
        actions={showHeading ? undefined : newSchool}
      >
        {branches.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={to('emptyTitle')}
              description={canManage ? to('emptyDescription') : to('emptyReadOnly')}
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col">{to('columns.school')}</TableHead>
                <TableHead scope="col" className="hidden md:table-cell">{to('columns.city')}</TableHead>
                {showReports ? <>
                  <TableHead scope="col" className="hidden text-right sm:table-cell">{to('columns.activeLearners')}</TableHead>
                  <TableHead scope="col" className="hidden text-right lg:table-cell">{to('columns.enrollments')}</TableHead>
                  <TableHead scope="col" className="hidden text-right lg:table-cell">{to('columns.completion')}</TableHead>
                  <TableHead scope="col" className="hidden text-right md:table-cell">{to('columns.pendingGrading')}</TableHead>
                  <TableHead scope="col" className="hidden text-right lg:table-cell">{to('columns.averageScore')}</TableHead>
                </> : null}
                <TableHead scope="col" className="w-12"><span className="sr-only">{to('columns.actions')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branches.map((branch) => {
                const actions: RowAction[] = [
                  { label: to('openSchool'), href: routes.admin.branch(branch.id) },
                  ...(canManage ? [{ label: to('editSchool'), onSelect: () => openEditor({ mode: 'edit', branch }) }] : []),
                ];
                return (
                  <TableRow key={branch.id}>
                    <TableCell className="min-w-40 whitespace-normal py-3">
                      <Link href={routes.admin.branch(branch.id)} className="font-medium leading-normal text-foreground underline-offset-4 hover:underline">
                        {branch.name}
                      </Link>
                      <span className="block text-xs leading-normal text-muted-foreground tabular-nums">
                        {/* On phones the city column folds into this line. */}
                        {branch.city ? <span className="md:hidden">{branch.city} · </span> : null}
                        {branch.id}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{branch.city ?? '—'}</TableCell>
                    {showReports ? <>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">{reportCell(branch.id, (row) => count(row.activeLearners30d))}</TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">{reportCell(branch.id, (row) => count(row.enrollments))}</TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">{reportCell(branch.id, (row) => percent(row.completionPercent))}</TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{reportCell(branch.id, (row) => count(row.pendingGrading))}</TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">{reportCell(branch.id, (row) => percent(row.averagePercent))}</TableCell>
                    </> : null}
                    <TableCell className="text-right">
                      <RowActions items={actions} label={to('actionsFor', { name: branch.name })} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DataCard>

      <p role="status" aria-live="polite" className="min-h-6 text-sm leading-normal text-muted-foreground">{status}</p>

      <Sheet open={editor !== null} onOpenChange={(open) => { if (!open && !saving) setEditor(null); }}>
        <SheetContent className="w-full sm:max-w-md" closeLabel={to('close')}>
          <form key={editing?.id ?? 'new'} onSubmit={save} className="flex min-h-0 flex-1 flex-col" aria-label={editing ? to('editSchool') : to('newSchool')}>
            <SheetHeader>
              <SheetTitle>{editing ? to('editSchool') : to('newSchool')}</SheetTitle>
              <SheetDescription>{editing ? to('editDescription') : to('createDescription')}</SheetDescription>
            </SheetHeader>
            <div className="grid gap-5 overflow-y-auto p-6">
              {editing ? (
                <div className="grid gap-1">
                  <span className="text-sm font-medium leading-normal">{t('branchId')}</span>
                  <span className="text-sm leading-normal text-muted-foreground tabular-nums">{editing.id}</span>
                </div>
              ) : (
                <div className="grid gap-2">
                  <label className="grid gap-2 text-sm font-medium leading-normal" htmlFor="new-branch-id">
                    {t('branchId')}
                    <Input id="new-branch-id" name="id" required pattern="[a-z0-9][a-z0-9-]{0,63}" aria-describedby="new-branch-id-hint" />
                  </label>
                  <span id="new-branch-id-hint" className="text-xs leading-normal text-muted-foreground">{to('idHint')}</span>
                </div>
              )}
              <label className="grid gap-2 text-sm font-medium leading-normal" htmlFor={editing ? 'edit-branch-name' : 'new-branch-name'}>
                {t('name')}
                <Input id={editing ? 'edit-branch-name' : 'new-branch-name'} name="name" defaultValue={editing?.name ?? ''} required maxLength={160} />
              </label>
              <label className="grid gap-2 text-sm font-medium leading-normal" htmlFor={editing ? 'edit-branch-city' : 'new-branch-city'}>
                {t('city')}
                <Input id={editing ? 'edit-branch-city' : 'new-branch-city'} name="city" defaultValue={editing?.city ?? ''} maxLength={160} />
              </label>
              {sheetError ? (
                <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-normal text-destructive-soft-foreground">{sheetError}</p>
              ) : null}
            </div>
            <SheetFooter className="flex-row justify-end">
              <SheetClose asChild>
                <Button variant="outline" disabled={saving}>{tc('cancel')}</Button>
              </SheetClose>
              <Button type="submit" disabled={saving} aria-busy={saving || undefined}>
                {saving ? t('saving') : editing ? t('saveBranch') : t('createBranch')}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
