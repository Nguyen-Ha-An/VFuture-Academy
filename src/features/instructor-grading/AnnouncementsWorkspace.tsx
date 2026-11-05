'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CanvasButton as Button, CanvasSelect, CanvasTextInput, CanvasTextArea } from '@/features/canvas/ui';
import { useUnsavedChanges } from '@/features/studio/ui/useUnsavedChanges';
import { WorkspaceApiError, readApiData, workspaceErrorMessage } from '@/features/studio/ui/client';
import type { BranchOption } from './types';
import { useTeachingOptions } from './useTeachingOptions';

type Announcement = { id: string; title: string; body: string; status: 'draft' | 'published' | 'archived'; revision: number };
type Props = { branches: BranchOption[]; locale: 'vi' | 'en' };

export function AnnouncementsWorkspace({ branches, locale }: Props) {
  const vi = locale === 'vi';
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0].id : '');
  const [courseId, setCourseId] = useState('');
  const { options, error: optionsError } = useTeachingOptions(branchId, locale);
  const [rows, setRows] = useState<Announcement[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saved, setSaved] = useState(JSON.stringify({ title: '', body: '' }));
  const dirty = saved !== JSON.stringify({ title, body });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const current = rows.find(row => row.id === selected);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!branchId || !courseId) { setRows([]); return; }
    setLoading(true); setError('');
    try {
      const query = new URLSearchParams({ branchId, courseId });
      const data = await readApiData<{ announcements: Announcement[] }>(await fetch(`/api/v1/teaching/announcements?${query}`, { signal }));
      if (!signal?.aborted) setRows(data.announcements);
    } catch (cause) { if (!signal?.aborted) setError(workspaceErrorMessage(cause, vi ? 'Không thể tải thông báo.' : 'Could not load announcements.')); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [branchId, courseId, vi]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  function reset() { setSelected(null); setEditingRevision(null); setTitle(''); setBody(''); setSaved(JSON.stringify({ title: '', body: '' })); }
  const guard = useUnsavedChanges(dirty, save);
  async function changeContext(change: () => void) { if (!busy && await guard.requestLeave()) change(); }
  async function save(): Promise<boolean> {
    if (!branchId || !courseId || !title.trim() || !body.trim() || busy) return false;
    if (selected && (!Number.isSafeInteger(editingRevision) || (editingRevision ?? 0) < 1)) { setError(vi ? 'Mở lại bản nháp trước khi lưu.' : 'Reopen the draft before saving.'); return false; }
    setBusy(true); setError('');
    try {
      const url = selected ? `/api/v1/teaching/announcements/${encodeURIComponent(selected)}` : '/api/v1/teaching/announcements';
      await readApiData(await fetch(url, { method: selected ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(selected ? { title, body, expectedRevision: editingRevision } : { branchId, courseId, title, body }) }));
      reset(); await load(); return true;
    } catch (cause) { setError(cause instanceof WorkspaceApiError && cause.code === 'STALE_ANNOUNCEMENT' ? (vi ? 'Thông báo đã được người khác thay đổi. Nội dung bạn đang sửa vẫn được giữ; hãy xem lại phiên bản mới trước khi lưu.' : 'Another operator changed this announcement. Your text is retained; review the latest version before saving.') : workspaceErrorMessage(cause, vi ? 'Không thể lưu; nội dung vẫn được giữ.' : 'Could not save; your text is retained.')); return false; }
    finally { setBusy(false); }
  }
  async function action(id: string, kind: 'publish' | 'archive') {
    if (busy || dirty) return;
    const revision = rows.find(row => row.id === id)?.revision;
    if (!Number.isSafeInteger(revision) || (revision ?? 0) < 1) { setError(vi ? 'Tải lại thông báo trước khi cập nhật.' : 'Reload announcements before updating.'); return; }
    setBusy(true); setError('');
    try { await readApiData(await fetch(`/api/v1/teaching/announcements/${encodeURIComponent(id)}/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: revision }) })); reset(); await load(); }
    catch (cause) { setError(cause instanceof WorkspaceApiError && cause.code === 'STALE_ANNOUNCEMENT' ? (vi ? 'Thông báo đã thay đổi. Tải lại và xem phiên bản mới trước khi công bố hoặc lưu trữ.' : 'This announcement changed. Reload and review the latest version before publishing or archiving.') : workspaceErrorMessage(cause, vi ? 'Không thể cập nhật thông báo.' : 'Could not update announcement.')); }
    finally { setBusy(false); }
  }
  return <div className="canvas-page mx-auto max-w-7xl space-y-6">
    <header><Link href="/grading" className="text-sm text-muted-foreground">← {vi ? 'Giảng dạy' : 'Teaching'}</Link><h1 tabIndex={-1} className="mt-2 text-2xl font-semibold">{vi ? 'Thông báo' : 'Announcements'}</h1><p className="mt-1 text-sm text-muted-foreground">{vi ? 'Soạn bản nháp và công bố cho khóa học tại trường đã chọn.' : 'Draft and publish announcements for a course at the selected school.'}</p></header>
    <div className="canvas-toolbar grid gap-4 sm:grid-cols-2"><CanvasSelect label={vi ? 'Trường' : 'School'} disabled={busy} value={branchId} onChange={value => void changeContext(() => { setBranchId(value); setCourseId(''); setRows([]); reset(); })} options={[{ value: '', label: vi ? 'Chọn trường' : 'Select school' }, ...branches.map(branch => ({ value: branch.id, label: branch.name }))]} /><CanvasSelect label={vi ? 'Khóa học' : 'Course'} disabled={busy} value={courseId} onChange={value => void changeContext(() => { setCourseId(value); setRows([]); reset(); })} options={[{ value: '', label: vi ? 'Chọn khóa học' : 'Select course' }, ...options.courses.map(course => ({ value: course.id, label: course.title }))]} /></div>
    {optionsError && <p role="alert" className="rounded-md border border-destructive p-3 text-sm">{optionsError}</p>}
    {error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive p-3"><p role="alert" className="text-sm">{error}</p><Button variant="outline" size="sm" disabled={busy || loading} onClick={() => void load()}>{vi ? 'Tải lại danh sách' : 'Refresh announcements'}</Button></div>}
    {branchId && courseId && <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)] lg:items-start"><section className="canvas-panel space-y-4 rounded-lg border p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">{vi ? 'Thông báo trong khóa học' : 'Course announcements'}</h2><Button variant="outline" disabled={busy} onClick={() => void changeContext(reset)}>{vi ? 'Tạo mới' : 'New'}</Button></div>{loading ? <p role="status">{vi ? 'Đang tải…' : 'Loading…'}</p> : rows.length === 0 ? <p className="canvas-empty text-sm text-muted-foreground">{vi ? 'Chưa có thông báo.' : 'No announcements yet.'}</p> : <ul className="divide-y">{rows.map(row => <li key={row.id} className="space-y-2 py-4"><div className="flex flex-wrap justify-between gap-2"><strong className="min-w-0 break-words">{row.title}</strong><span className="text-sm text-muted-foreground">{row.status === 'draft' ? (vi ? 'Bản nháp' : 'Draft') : row.status === 'published' ? (vi ? 'Đã công bố' : 'Published') : (vi ? 'Đã lưu trữ' : 'Archived')}</span></div><details className="text-sm"><summary className="min-h-9 cursor-pointer py-2 text-primary">{vi ? 'Đọc nội dung thông báo' : 'Read announcement'}</summary><p className="whitespace-pre-wrap break-words leading-relaxed">{row.body}</p></details><div className="flex flex-wrap gap-2">{row.status === 'draft' && <><Button size="sm" variant="outline" disabled={busy} onClick={() => void changeContext(() => { setSelected(row.id); setEditingRevision(row.revision); setTitle(row.title); setBody(row.body); setSaved(JSON.stringify({ title: row.title, body: row.body })); })}>{vi ? 'Sửa bản nháp' : 'Edit draft'}</Button><Button size="sm" disabled={busy || dirty} onClick={() => void action(row.id, 'publish')}>{vi ? 'Công bố' : 'Publish'}</Button></>}{row.status !== 'archived' && <Button size="sm" variant="outline" disabled={busy || dirty} onClick={() => void action(row.id, 'archive')}>{vi ? 'Lưu trữ' : 'Archive'}</Button>}</div></li>)}</ul>}</section>
    <section className="canvas-panel grid gap-4 rounded-lg border p-5 lg:sticky lg:top-20"><h2 className="font-semibold">{current ? (vi ? 'Sửa bản nháp' : 'Edit draft') : (vi ? 'Bản nháp mới' : 'New draft')}</h2><CanvasTextInput label={vi ? 'Tiêu đề' : 'Title'} disabled={busy} value={title} onChange={setTitle} maxLength={200} /><CanvasTextArea label={vi ? 'Nội dung' : 'Message'} disabled={busy} value={body} onChange={setBody} /><p className="text-sm text-muted-foreground">{vi ? 'Lưu bản nháp trước, sau đó chọn Công bố để học viên xem.' : 'Save the draft first, then select Publish to make it visible to learners.'}</p><p role="status" className="text-sm font-medium">{dirty ? (vi ? 'Có thay đổi chưa lưu · lưu trước khi công bố' : 'Unsaved changes · save before publishing') : (vi ? 'Bản nháp riêng tư' : 'Private draft')}</p><Button disabled={busy || !dirty || !title.trim() || !body.trim()} onClick={() => void save()}>{vi ? 'Lưu bản nháp' : 'Save draft'}</Button></section></div>}
    {!branchId || !courseId ? <div className="canvas-empty border-y border-border py-12"><h2 className="font-semibold">{vi ? 'Chọn khóa học để bắt đầu' : 'Choose a course to begin'}</h2><p className="mt-2 text-sm text-muted-foreground">{vi ? 'Thông báo chỉ hiển thị cho học viên trong khóa học và trường đã chọn.' : 'Announcements reach learners in the selected school and course.'}</p></div> : null}
    {guard.dialog}
  </div>;
}
