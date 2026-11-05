'use client';

import "@/features/admin/ui/admin.css";
import { useState, type FormEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { PlusIcon } from 'lucide-react';

import { CanvasButton as Button, CanvasTextInput, CanvasDataTable, CanvasLink } from '@/features/canvas/ui';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { Branch } from '@/features/admin/branches';
import { DataCard, EmptyState, RowActions, StatCard, StatGrid, type RowAction } from '@/features/staff-ui/components';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
import { routes } from '@/lib/routes';
import { scopedUrl } from './member-admin-ui';
import type { AdminScope } from '@/lib/admin-scope';

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
  scope: AdminScope;
  actorId: string;
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
export function BranchesManager({ initialBranches, scope, actorId, reports, canManage = false, showHeading = true }: BranchesManagerProps) {
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
        const branch = await responseData<Branch>(await fetch(scopedUrl('/api/v1/studio/branches', scope, { actorId }), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: values.get('id'), name, city }),
        }));
        setBranches((current) => [...current.filter((candidate) => candidate.id !== branch.id), branch]
          .sort((left, right) => left.name.localeCompare(right.name)));
      } else {
        const id = editor.branch.id;
        const branch = await responseData<Branch>(await fetch(scopedUrl(`/api/v1/studio/branches/${encodeURIComponent(id)}`, scope, { actorId }), {
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
    <div className="canvas-page canvas-admin space-y-6">
      {showHeading ? <StaffPageHeader title={tc('schools')} description={to('description')} actions={newSchool} /> : null}

      <StatGrid>
        <StatCard label={to('stats.schools')} value={branches.length} />
        {showReports ? <>
          <StatCard label={to('stats.enrollments')} value={totals?.enrollments ?? null} unavailableLabel={to('unavailable')} />
          <StatCard label={to('stats.pendingGrading')} value={totals?.pendingGrading ?? null} unavailableLabel={to('unavailable')} />
        </> : null}
      </StatGrid>

      <DataCard
        className="canvas-panel"
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
          <CanvasDataTable
            caption={to('listTitle')}
            rows={branches}
            rowKey={(branch) => branch.id}
            stackedBelow={64}
            columns={[
              { key: 'school', label: to('columns.school'), render: (branch) => <>
                <CanvasLink href={routes.admin.branch(branch.id)}>{branch.name}</CanvasLink>
                <span className="block text-xs font-normal text-muted-foreground tabular-nums">{branch.id}</span>
              </> },
              { key: 'city', label: to('columns.city'), render: (branch) => branch.city ?? '—' },
              ...(showReports ? [
                { key: 'active', label: to('columns.activeLearners'), render: (branch: Branch) => reportCell(branch.id, (row) => count(row.activeLearners30d)) },
                { key: 'enrollments', label: to('columns.enrollments'), render: (branch: Branch) => reportCell(branch.id, (row) => count(row.enrollments)) },
                { key: 'completion', label: to('columns.completion'), render: (branch: Branch) => reportCell(branch.id, (row) => percent(row.completionPercent)) },
                { key: 'waiting', label: to('columns.pendingGrading'), render: (branch: Branch) => reportCell(branch.id, (row) => count(row.pendingGrading)) },
                { key: 'average', label: to('columns.averageScore'), render: (branch: Branch) => reportCell(branch.id, (row) => percent(row.averagePercent)) },
              ] : []),
              { key: 'actions', label: to('columns.actions'), render: (branch) => {
                const actions: RowAction[] = [
                  { label: to('openSchool'), href: routes.admin.branch(branch.id) },
                  ...(canManage ? [{ label: to('editSchool'), onSelect: () => openEditor({ mode: 'edit', branch }) }] : []),
                ];
                return <RowActions items={actions} label={to('actionsFor', { name: branch.name })} />;
              } },
            ]}
          />
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
                  <div>
                    <CanvasTextInput label={t('branchId')} id="new-branch-id" name="id" required pattern="[a-z0-9][a-z0-9-]{0,63}" aria-describedby="new-branch-id-hint" />
                  </div>
                  <span id="new-branch-id-hint" className="text-xs leading-normal text-muted-foreground">{to('idHint')}</span>
                </div>
              )}
              <CanvasTextInput label={t('name')} id={editing ? 'edit-branch-name' : 'new-branch-name'} name="name" defaultValue={editing?.name ?? ''} required maxLength={160} />
              <CanvasTextInput label={t('city')} id={editing ? 'edit-branch-city' : 'new-branch-city'} name="city" defaultValue={editing?.city ?? ''} maxLength={160} />
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
