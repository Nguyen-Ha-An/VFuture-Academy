'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CanvasButton as Button, CanvasSelect } from '@/features/canvas/ui';
import { useUnsavedChanges } from '@/features/studio/ui/useUnsavedChanges';
import { readApiData, workspaceErrorMessage } from '@/features/studio/ui/client';
import type { BranchOption } from './types';
import { deadlineToLocal as localValue, deadlineToUtc as utcValue } from './schedule-time';
import { useTeachingOptions } from './useTeachingOptions';

type Assignment = { itemId: string; blockId: string | null; title?: string };
type Schedule = Assignment & { dueAt: string | null };
type Props = { branches: BranchOption[]; locale: 'vi' | 'en' };
const keyOf = (item: Assignment) => JSON.stringify([item.itemId, item.blockId]);


export function ScheduleWorkspace({ branches, locale }: Props) {
  const vi = locale === 'vi';
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0].id : '');
  const [versionId, setVersionId] = useState('');
  const { options, error: optionsError } = useTeachingOptions(branchId, locale);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [itemKey, setItemKey] = useState('');
  const [due, setDue] = useState('');
  const [savedDue, setSavedDue] = useState('');
  const dirty = !!itemKey && due !== savedDue;
  const guard = useUnsavedChanges(dirty, save);
  async function changeContext(change: () => void) { if (!busy && await guard.requestLeave()) change(); }
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState(() => localValue(new Date().toISOString()).slice(0, 7));
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!branchId || !versionId) { setAssignments([]); setSchedules([]); return; }
    setError(''); setLoading(true);
    try {
      const query = new URLSearchParams({ branchId, courseVersionId: versionId, locale });
      const data = await readApiData<{ schedules: Schedule[]; assignments: Assignment[] }>(await fetch(`/api/v1/teaching/schedules?${query}`, { signal }));
      if (!signal?.aborted) { setAssignments(data.assignments); setSchedules(data.schedules); }
    } catch (cause) { if (!signal?.aborted) setError(workspaceErrorMessage(cause, vi ? 'Không thể tải lịch.' : 'Could not load schedule.')); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [branchId, versionId, vi, locale]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  async function save(): Promise<boolean> {
    const item = assignments.find(candidate => keyOf(candidate) === itemKey);
    if (!item || !branchId || !versionId || busy) return false;
    setBusy(true); setError(''); setMessage('');
    try {
      await readApiData(await fetch('/api/v1/teaching/schedules', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ branchId, courseVersionId: versionId, itemId: item.itemId, blockId: item.blockId, dueAt: utcValue(due) }) }));
      setSavedDue(due); await load(); setMessage(vi ? 'Đã lưu lịch.' : 'Schedule saved.'); return true;
    } catch (cause) { setError(workspaceErrorMessage(cause, vi ? 'Không thể lưu lịch; giá trị đang sửa vẫn được giữ.' : 'Could not save schedule; your edit is retained.')); return false; }
    finally { setBusy(false); }
  }
  const itemLabel = (item: Assignment) => assignments.find(candidate => keyOf(candidate) === keyOf(item))?.title ?? item.itemId;
  const dated = schedules.filter(entry => entry.dueAt).sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
  const monthDays = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const weekday = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const selectClass = 'min-h-11 rounded-md border border-input bg-background px-3 text-sm';
  return <div className="canvas-page mx-auto max-w-7xl space-y-6"><header><Link href="/grading" className="text-sm text-muted-foreground">← {vi ? 'Giảng dạy' : 'Teaching'}</Link><h1 tabIndex={-1} className="mt-2 text-2xl font-semibold">{vi ? 'Lịch học' : 'Schedule'}</h1><p className="mt-1 text-sm text-muted-foreground">{vi ? 'Hạn nộp theo trường và phiên bản khóa học. Nội dung khóa học không thay đổi.' : 'Deadlines are scoped to a school and course version. Course content remains unchanged.'}</p></header>
    <div className="canvas-toolbar grid gap-4 sm:grid-cols-2"><CanvasSelect label={vi ? 'Trường' : 'School'} disabled={busy} value={branchId} onChange={value => void changeContext(() => { setBranchId(value); setVersionId(''); setItemKey(''); setDue(''); setSavedDue(''); setAssignments([]); setSchedules([]); setMessage(''); })} options={[{ value: '', label: vi ? 'Chọn trường' : 'Select school' }, ...branches.map(branch => ({ value: branch.id, label: branch.name }))]} /><CanvasSelect label={vi ? 'Phiên bản khóa học' : 'Course version'} disabled={busy} value={versionId} onChange={value => void changeContext(() => { setVersionId(value); setItemKey(''); setDue(''); setSavedDue(''); setAssignments([]); setSchedules([]); setMessage(''); })} options={[{ value: '', label: vi ? 'Chọn phiên bản' : 'Select version' }, ...options.versions.map(version => ({ value: version.courseVersionId, label: `${version.courseTitle} · ${vi ? 'Phiên bản' : 'Version'} ${version.version ?? '—'}` }))]} /></div>
    {optionsError && <p role="alert" className="rounded-md border border-destructive p-3 text-sm">{optionsError}</p>}
    {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm">{error}</p>}{message && <p role="status">{message}</p>}
    {branchId && versionId && <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start"><section className="canvas-panel order-2 grid min-w-0 gap-4 rounded-lg border p-5 xl:sticky xl:top-20"><h2 className="font-semibold">{vi ? 'Chỉnh hạn nộp' : 'Edit deadline'}</h2><p className="text-sm text-muted-foreground">{vi ? 'Múi giờ: Asia/Ho_Chi_Minh (UTC+07:00). Để trống để bỏ hạn nộp.' : 'Time zone: Asia/Ho_Chi_Minh (UTC+07:00). Leave blank to remove the deadline.'}</p><CanvasSelect label={vi ? 'Bài tập' : 'Assignment'} value={itemKey} disabled={busy} onChange={key => void changeContext(() => { const nextDue = localValue(schedules.find(row => keyOf(row) === key)?.dueAt ?? null); setItemKey(key); setDue(nextDue); setSavedDue(nextDue); setMessage(''); })} options={[{ value: '', label: vi ? 'Chọn bài tập' : 'Select assignment' }, ...assignments.map((item, index) => ({ value: keyOf(item), label: `${itemLabel(item)}${item.blockId ? ` · ${vi ? 'Phần' : 'Part'} ${index + 1}` : ''}` }))]} /><label className="grid gap-1 text-sm">{vi ? 'Hạn nộp (không bắt buộc)' : 'Deadline (optional)'}<input className={selectClass} type="datetime-local" disabled={!itemKey || busy} value={due} onChange={e => setDue(e.target.value)} /></label><div className="flex flex-wrap items-center gap-3"><Button disabled={!itemKey || busy || !dirty} onClick={() => void save()}>{vi ? 'Lưu lịch' : 'Save schedule'}</Button><p className="text-sm text-muted-foreground">{dirty ? (vi ? 'Có thay đổi chưa lưu' : 'Unsaved changes') : ''}</p></div></section>
    <section className="canvas-panel order-1 min-w-0 rounded-lg border p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{vi ? 'Lịch và chương trình' : 'Calendar and agenda'}</h2><label className="grid gap-1 text-sm">{vi ? 'Tháng' : 'Month'}<input type="month" className={selectClass} value={month} onChange={e => { if (e.target.value) setMonth(e.target.value); }} /></label></div><div className="mt-4 hidden grid-cols-7 gap-px bg-border sm:grid" aria-label={vi ? 'Lịch tháng' : 'Month calendar'}>{(vi ? ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map(day => <div key={day} className="bg-background p-2 text-xs font-medium text-muted-foreground">{day}</div>)}{Array.from({ length: weekday }, (_, index) => <div key={`blank-${index}`} className="min-h-20 bg-background" />)}{Array.from({ length: monthDays }, (_, index) => { const day = `${month}-${String(index + 1).padStart(2, '0')}`; const events = dated.filter(entry => localValue(entry.dueAt).startsWith(day)); return <div key={day} className="min-h-20 bg-background p-2 text-sm"><span className="font-medium">{index + 1}</span>{events.map(entry => <p key={keyOf(entry)} className="mt-1 break-words text-xs">{localValue(entry.dueAt).slice(11, 16)} · {itemLabel(entry)}</p>)}</div>; })}</div><h3 className="mt-5 font-medium">{vi ? 'Danh sách hạn nộp' : 'Deadline agenda'}</h3>{loading ? <p role="status" className="py-8 text-sm text-muted-foreground">{vi ? 'Đang tải lịch…' : 'Loading schedule…'}</p> : dated.length ? <ul className="mt-2 divide-y">{dated.map(entry => <li key={keyOf(entry)} className="py-3 text-sm"><time dateTime={entry.dueAt ?? undefined}>{localValue(entry.dueAt).replace('T', ' ')} (UTC+07:00)</time><p className="break-words text-muted-foreground">{itemLabel(entry)}</p></li>)}</ul> : <p className="canvas-empty mt-3 text-sm text-muted-foreground">{vi ? 'Chưa có hạn nộp.' : 'No deadlines yet.'}</p>}</section></div>}
    {!branchId || !versionId ? <div className="canvas-empty border-y border-border py-12"><h2 className="font-semibold">{vi ? 'Chọn phiên bản khóa học để xem lịch' : 'Choose a course version to view its schedule'}</h2><p className="mt-2 text-sm text-muted-foreground">{vi ? 'Hạn nộp sử dụng múi giờ Việt Nam (UTC+07:00).' : 'Deadlines use Vietnam time (UTC+07:00).'}</p></div> : null}
    {guard.dialog}
  </div>;
}
