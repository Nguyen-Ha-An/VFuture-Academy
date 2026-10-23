// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/vi.json';

vi.mock('@/features/instructor-grading/SubmissionsWorkspace', () => ({ SubmissionsWorkspace: () => <p>ASSIGNMENT_QUEUE</p> }));
vi.mock('@/features/instructor-grading/ExamsWorkspace', () => ({ ExamsWorkspace: () => <p>EXAM_QUEUE</p> }));

import { GradingOperations } from '@/features/instructor-grading/GradingOperations';

afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); });

describe('grading operations tabs', () => {
  it('honors an exam deep link, localizes tabs, and supports arrow-key navigation', async () => {
    window.history.replaceState({}, '', '/studio/grading?kind=exam');
    render(<NextIntlClientProvider locale="vi" messages={messages}><GradingOperations branches={[]} courses={[]} assignments={[]} exams={[]} gradingBranchIds={[]} /></NextIntlClientProvider>);
    const assignmentTab = screen.getByRole('tab', { name: 'Bài tập' });
    const examTab = screen.getByRole('tab', { name: 'Kỳ thi' });
    expect(examTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('EXAM_QUEUE')).toBeInTheDocument();
    examTab.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(assignmentTab).toHaveFocus();
    expect(assignmentTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('ASSIGNMENT_QUEUE')).toBeInTheDocument();
    expect(window.location.search).toContain('tab=assignments');
  });

  it('restores the committed queue tab when browser history changes', async () => {
    window.history.replaceState({}, '', '/studio/grading?tab=assignments&branchId=keep-me');
    render(<NextIntlClientProvider locale="vi" messages={messages}><GradingOperations branches={[]} courses={[]} assignments={[]} exams={[]} gradingBranchIds={[]} /></NextIntlClientProvider>);
    expect(screen.getByRole('tab', { name: 'Bài tập' })).toHaveAttribute('aria-selected', 'true');
    window.history.replaceState({}, '', '/studio/grading?tab=exams&branchId=keep-me');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(screen.getByRole('tab', { name: 'Kỳ thi' })).toHaveAttribute('aria-selected', 'true');
    expect(window.location.search).toContain('branchId=keep-me');
  });
});
