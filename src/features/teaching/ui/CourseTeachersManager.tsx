'use client';

import { useCallback, useEffect, useState } from 'react';
import { CanvasButton, CanvasCheckbox, CanvasSelect } from '@/features/canvas/ui';
import { readApiData } from '@/features/studio/ui/client';

type Teacher = { userId: string; displayName: string; role: 'primary' | 'assistant' };
type Assignment = { courseId: string; branchId: string; revision: number; teachers: Teacher[] };
type Option = { userId: string; displayName: string; handle: string | null };
type Course = { id: string; title: string };

export function CourseTeachersManager({ branchId, locale }: { branchId: string; locale: 'en' | 'vi' }) {
  const vi = locale === 'vi';
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');
  const [primary, setPrimary] = useState('');
  const [assistants, setAssistants] = useState<string[]>([]);
  const endpoint = (id: string) => `/api/v1/teaching/courses/${encodeURIComponent(id)}/teachers?${new URLSearchParams({ branchId })}`;
  const loadAssignment = useCallback(async (id: string) => {
    const data = await readApiData<Assignment>(await fetch(endpoint(id)));
    setAssignments(previous => ({ ...previous, [id]: data }));
    return data;
  // branch is stable for the mounted school page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);
  const edit = useCallback((data: Assignment) => {
    setPrimary(data.teachers.find(teacher => teacher.role === 'primary')?.userId ?? '');
    setAssistants(data.teachers.filter(teacher => teacher.role === 'assistant').map(teacher => teacher.userId));
  }, []);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const query = new URLSearchParams({ branchId, locale });
        async function allTeachers() {
          const teachers: Option[] = [];
          for (let page = 1; ; page++) {
            const params = new URLSearchParams({ branchId, pageSize: '100', page: String(page) });
            const result = await readApiData<{ teachers: Option[]; hasMore: boolean }>(await fetch(`/api/v1/teaching/teacher-options?${params}`));
            teachers.push(...result.teachers);
            if (!result.hasMore) return teachers;
          }
        }
        const [list, people] = await Promise.all([
          fetch(`/api/v1/teaching/options?${query}`).then(response => readApiData<{ courses: Course[] }>(response)),
          allTeachers(),
        ]);
        const rows = await Promise.all(list.courses.map(course => fetch(endpoint(course.id)).then(response => readApiData<Assignment>(response))));
        if (active) { setCourses(list.courses); setOptions(people); setAssignments(Object.fromEntries(rows.map(row => [row.courseId, row]))); }
      } catch { if (active) setError(vi ? 'Không thể tải danh sách. Vui lòng thử lại.' : 'Could not load the list. Please try again.'); }
    }
    void load();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, locale]);
  const save = async () => {
    const current = assignments[selected];
    if (!current) return;
    if (!primary && assistants.length) {
      setError(vi ? 'Hãy chọn giáo viên chính khi có trợ giảng.' : 'Choose a primary teacher when assistants are assigned.');
      return;
    }
    if ([primary, ...assistants].some(id => id && !options.some(person => person.userId === id))) {
      setError(vi ? 'Hãy loại bỏ giáo viên không còn đủ điều kiện trước khi lưu.' : 'Remove teachers who are no longer eligible before saving.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(endpoint(selected), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branchId, expectedRevision: current.revision, teachers: [...(primary ? [{ userId: primary, role: 'primary' }] : []), ...assistants.filter(id => id !== primary).map(userId => ({ userId, role: 'assistant' }))] }) });
      if (response.status === 409) {
        const fresh = await loadAssignment(selected); edit(fresh);
        setNotice(vi ? 'Phân công đã thay đổi. Đã tải lại bản mới nhất; vui lòng kiểm tra và lưu lại.' : 'Assignments changed. The latest version has been loaded; review and save again.');
      } else {
        const data = await readApiData<Assignment>(response);
        setAssignments(previous => ({ ...previous, [selected]: data })); edit(data);
        setNotice(vi ? 'Đã lưu phân công.' : 'Assignments saved.');
      }
    } catch { setError(vi ? 'Không thể lưu hoặc tải phân công. Vui lòng thử lại.' : 'Could not save or reload assignments. Please try again.'); }
    finally { setBusy(false); }
  };
  return <section className="canvas-panel space-y-4 p-5" aria-labelledby="course-teachers-heading">
    <h2 id="course-teachers-heading">{vi ? 'Khóa học và giáo viên' : 'Courses & teachers'}</h2>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {courses === null ? !error && <p>{vi ? 'Đang tải…' : 'Loading…'}</p> : courses.length === 0 ? <p>{vi ? 'Không có khóa học phù hợp.' : 'No accessible courses.'}</p> : <ul className="space-y-4">{courses.map(course => {
      const row = assignments[course.id];
      const names = (role: Teacher['role']) => row?.teachers.filter(teacher => teacher.role === role).map(teacher => teacher.displayName).join(', ') || (vi ? 'Chưa phân công' : 'Unassigned');
      return <li key={course.id} className="space-y-2 border-b border-border pb-4"><h3>{course.title}</h3><p>{vi ? 'Giáo viên chính' : 'Primary teacher'}: {names('primary')}</p><p>{vi ? 'Trợ giảng' : 'Assistants'}: {names('assistant')}</p><CanvasButton variant="outline" disabled={busy} onClick={() => { setSelected(course.id); edit(row); setNotice(''); setError(''); }}>{vi ? 'Chỉnh sửa' : 'Edit'}</CanvasButton></li>;
    })}</ul>}
    {selected && assignments[selected] && <div className="space-y-4" aria-labelledby="edit-teachers-heading"><h3 id="edit-teachers-heading">{vi ? 'Phân công cho' : 'Assign teachers for'} {courses?.find(course => course.id === selected)?.title}</h3>
      <CanvasSelect label={vi ? 'Giáo viên chính' : 'Primary teacher'} value={primary} disabled={busy} onChange={value => { setPrimary(value); setAssistants(ids => ids.filter(id => id !== value)); }} options={[{ value: '', label: vi ? 'Chưa phân công' : 'Unassigned' }, ...assignments[selected].teachers.filter(person => person.userId === primary && !options.some(option => option.userId === person.userId)).map(person => ({ value: person.userId, label: `${person.displayName} (${vi ? 'không còn đủ điều kiện' : 'no longer eligible'})`, disabled: true })), ...options.map(person => ({ value: person.userId, label: person.handle ? `${person.displayName} (@${person.handle})` : person.displayName }))]} />
      <fieldset><legend>{vi ? 'Trợ giảng' : 'Assistants'}</legend>{assignments[selected].teachers.filter(person => assistants.includes(person.userId) && !options.some(option => option.userId === person.userId)).map(person => <div key={person.userId}><CanvasCheckbox label={`${person.displayName} (${vi ? 'không còn đủ điều kiện' : 'no longer eligible'})`} checked disabled={busy} onChange={() => setAssistants(ids => ids.filter(id => id !== person.userId))} /></div>)}{options.filter(person => person.userId !== primary).map(person => <div key={person.userId}><CanvasCheckbox label={person.handle ? `${person.displayName} (@${person.handle})` : person.displayName} checked={assistants.includes(person.userId)} disabled={busy} onChange={checked => setAssistants(ids => checked ? [...ids, person.userId] : ids.filter(id => id !== person.userId))} /></div>)}</fieldset>
      <CanvasButton disabled={busy} onClick={() => void save()}>{vi ? 'Lưu phân công' : 'Save assignments'}</CanvasButton>{' '}<CanvasButton variant="outline" disabled={busy} onClick={() => setSelected('')}>{vi ? 'Đóng' : 'Close'}</CanvasButton>
    </div>}
  </section>;
}
