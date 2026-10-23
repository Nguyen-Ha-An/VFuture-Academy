// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({ push: vi.fn(), requestNavigation: vi.fn().mockResolvedValue(true) }));
const copy: Record<string, Record<string, string>> = {
  'learner.focus': { outline: 'Nội dung khoá học', closeOutline: 'Đóng nội dung khoá học', currentItem: 'Mục hiện tại' },
  'bench.learner.activity': { 'state.completed': 'Đã hoàn thành', 'state.inProgress': 'Đang học', 'state.submitted': 'Đã nộp', 'state.changesRequested': 'Cần chỉnh sửa' },
};
vi.mock('next-intl', () => ({ useTranslations: (namespace: string) => (key: string, values?: Record<string, number>) => key === 'outlineProgress' && values
  ? `${values.completed}/${values.total}`
  : copy[namespace]?.[key] ?? key }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/navigation-guard', () => ({ requestNavigation: mocks.requestNavigation }));

import { FocusOutline } from '@/features/learner/ui/FocusOutline';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FocusOutline', () => {
  it('names each module list and shows completion and current status beside the item', () => {
    render(<FocusOutline courseId="course" itemId="now" modules={[
      { id: 'first', title: 'Module one', items: [{ id: 'done', title: 'Done', status: 'completed' }, { id: 'now', title: 'Now', status: 'in_progress' }] },
      { id: 'second', title: 'Module two', items: [{ id: 'later', title: 'Later', status: 'not_started' }] },
    ]} />);
    fireEvent.click(screen.getByRole('button', { name: /nội dung khoá học/i }));

    const first = screen.getByRole('list', { name: 'Module one' });
    const second = screen.getByRole('list', { name: 'Module two' });
    expect(within(first).getByRole('link', { name: /done/i })).toContainElement(screen.getByText('Đã hoàn thành'));
    expect(within(first).getByRole('link', { name: /now/i })).toContainElement(screen.getByText('Mục hiện tại'));
    expect(within(first).getByRole('link', { name: /now/i })).toContainElement(screen.getByText('Đang học'));
    expect(screen.getByText('Đã hoàn thành')).not.toHaveClass('sr-only');
    expect(screen.getByText('Mục hiện tại')).not.toHaveClass('sr-only');
    // Not started is the default: no tag.
    expect(within(second).getByRole('link', { name: 'Later' })).toBeInTheDocument();
    expect(within(second).getByRole('link', { name: 'Later' }).querySelector('.vf-tag')).toBeNull();
  });

  it('heads the drawer with the course, its progress and mono module codes, and tags every non-default status', () => {
    render(<FocusOutline courseId="course" itemId="now" courseTitle="AI Foundations" progress={{ completed: 1, total: 4 }} modules={[
      { id: 'first', title: 'Module one', items: [{ id: 'done', title: 'Done', status: 'completed' }, { id: 'now', title: 'Now', status: 'in_progress' }] },
      { id: 'second', title: 'Module two', items: [{ id: 'sent', title: 'Sent', status: 'submitted' }, { id: 'fix', title: 'Fix', status: 'changes_requested' }] },
    ]} />);
    fireEvent.click(screen.getByRole('button', { name: /nội dung khoá học/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('AI Foundations')).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: '1/4' })).toBeInTheDocument();
    expect(within(dialog).getByText('M01')).toBeInTheDocument();
    expect(within(dialog).getByText('M02')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /sent/i })).toContainElement(screen.getByText('Đã nộp'));
    expect(screen.getByText('Cần chỉnh sửa').closest('.vf-tag')).toHaveAttribute('data-tone', 'fault');
    expect(screen.getByText('Đã nộp').closest('.vf-tag')).toHaveAttribute('data-tone', 'pending');
    const current = within(dialog).getByRole('link', { name: /now/i });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.className).toContain('shadow-[inset_2px_0_0_var(--primary)]');
    expect(dialog.className).toContain('min-[760px]:w-[360px]');
    expect(dialog).toHaveClass('bg-background', 'w-full');
  });

  it('keeps the Radix outline panel closed until requested and identifies current and completed items', () => {
    render(<FocusOutline courseId="course one" itemId="now" modules={[{ id: 'module', title: 'Module one', items: [{ id: 'done', title: 'Done', status: 'completed' }, { id: 'now', title: 'Now', status: 'in_progress' }] }]} />);
    expect(screen.queryByText('Module one')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /nội dung khoá học/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /now/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /done/i })).toHaveAttribute('href', '/app/courses/course%20one/items/done');
  });

  it('guards ordinary outline navigation, closes after it succeeds, and preserves modified-click behavior', async () => {
    render(<FocusOutline courseId="course" itemId="now" modules={[{ id: 'module', title: 'Module one', items: [{ id: 'done', title: 'Done', status: 'completed' }, { id: 'now', title: 'Now', status: 'in_progress' }] }]} />);
    fireEvent.click(screen.getByRole('button', { name: /nội dung khoá học/i }));

    const done = screen.getByRole('link', { name: /done/i });
    done.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(done, { metaKey: true });
    expect(mocks.requestNavigation).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(done);
    await waitFor(() => expect(mocks.requestNavigation).toHaveBeenCalledOnce());
    expect(mocks.push).toHaveBeenCalledWith('/app/courses/course/items/done');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('returns focus to the trigger when the learner selects the item already open', async () => {
    render(<FocusOutline courseId="course" itemId="now" modules={[{ id: 'module', title: 'Module one', items: [{ id: 'done', title: 'Done', status: 'completed' }, { id: 'now', title: 'Now', status: 'in_progress' }] }]} />);
    const trigger = screen.getByRole('button', { name: /nội dung khoá học/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('link', { name: /now/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
