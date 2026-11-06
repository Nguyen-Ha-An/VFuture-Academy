// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/features/canvas/ui', () => ({
  CanvasButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  CanvasSelect: ({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) => <label>{label}<select value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>,
  CanvasCheckbox: ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) => <label><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />{label}</label>,
}));
import { CourseTeachersManager } from '@/features/teaching/ui/CourseTeachersManager';
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('loads all teacher pages and reloads the latest revision after a conflict', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/teaching/options?')) return ok({ courses: [{ id: 'c', title: 'Course' }] });
    if (url.includes('teacher-options')) return url.includes('page=2') ? ok({ teachers: [{ userId: 'b', displayName: 'Be', handle: null }], hasMore: false }) : ok({ teachers: [{ userId: 'a', displayName: 'An', handle: null }], hasMore: true });
    if (init?.method === 'PUT') return new Response('', { status: 409 });
    const reads = fetcher.mock.calls.filter(([path, options]) => String(path).includes('/courses/c/teachers') && !options?.method).length;
    return ok({ courseId: 'c', branchId: 'school', revision: reads > 1 ? 2 : 1, teachers: reads > 1 ? [{ userId: 'b', displayName: 'Be', role: 'primary' }] : [] });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<CourseTeachersManager branchId="school" locale="en" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Primary teacher'), { target: { value: 'a' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Be' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save assignments' }));
  await screen.findByText(/latest version has been loaded/);
  const put = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(String(put[1]?.body))).toEqual({ branchId: 'school', expectedRevision: 1, teachers: [{ userId: 'a', role: 'primary' }, { userId: 'b', role: 'assistant' }] });
  await waitFor(() => expect(screen.getByLabelText('Primary teacher')).toHaveValue('b'));
});

it.each(['success', 'conflict', 'conflict-reload-error'] as const)('prevents switching courses during a deferred %s save and reload', async outcome => {
  let release!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  let releaseReload!: (response: Response) => void;
  const pendingReload = new Promise<Response>(resolve => { releaseReload = resolve; });
  let courseAReads = 0;
  const row = (id: string, revision = 1) => ({ courseId: id, branchId: 'school', revision, teachers: [] });
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/teaching/options?')) return ok({ courses: [{ id: 'a', title: 'Course A' }, { id: 'b', title: 'Course B' }] });
    if (url.includes('teacher-options')) return ok({ teachers: [], hasMore: false });
    if (init?.method === 'PUT') return pending;
    if (url.includes('/courses/a/')) { courseAReads++; if (courseAReads > 1) return pendingReload; return ok(row('a')); }
    return ok(row('b'));
  });
  vi.stubGlobal('fetch', fetcher);
  render(<CourseTeachersManager branchId="school" locale="en" />);
  const edits = await screen.findAllByRole('button', { name: 'Edit' });
  fireEvent.click(edits[0]!);
  fireEvent.click(screen.getByRole('button', { name: 'Save assignments' }));
  expect(edits[1]).toBeDisabled();
  fireEvent.click(edits[1]!);
  expect(screen.getByRole('heading', { name: 'Assign teachers for Course A' })).toBeVisible();
  release(outcome === 'success' ? ok(row('a', 2)) : new Response('', { status: 409 }));
  if (outcome !== 'success') {
    await waitFor(() => expect(courseAReads).toBe(2));
    expect(edits[1]).toBeDisabled();
    fireEvent.click(edits[1]!);
    releaseReload(outcome === 'conflict' ? ok(row('a', 2)) : new Response('', { status: 503 }));
    if (outcome === 'conflict-reload-error') expect(await screen.findByRole('alert')).toHaveTextContent('Could not save or reload');
  }
  await waitFor(() => expect(edits[1]).toBeEnabled());
  fireEvent.click(edits[1]!);
  expect(screen.getByRole('heading', { name: 'Assign teachers for Course B' })).toBeVisible();
});
