// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/en.json';

vi.mock('@/features/instructor-grading/ExamsWorkspace', () => ({ ExamsWorkspace: () => <p>EXAMS_WORKSPACE</p> }));

import { AssessmentsWorkspace } from '@/features/instructor-grading/AssessmentsWorkspace';

const assignments = [
  { courseId: 'course-a', courseTitle: 'Course A', courseVersionId: 'version-a', itemId: 'item-a', itemTitle: 'Assignment A', assignmentId: 'assignment-a', rubric: { criteria: [{ id: 'quality', name: 'Quality', maxPoints: 4 }] } },
  { courseId: 'course-b', courseTitle: 'Course B', courseVersionId: 'version-b', itemId: 'item-b', itemTitle: 'Assignment B', assignmentId: 'assignment-b', rubric: { criteria: [] } },
];

const props = {
  branches: [{ id: 'branch-a', name: 'Branch A' }],
  courses: [{ id: 'course-a', title: 'Course A' }, { id: 'course-b', title: 'Course B' }],
  exams: [],
  assignments,
  canRelease: true,
  canGrade: true,
  gradingBranchIds: ['branch-a'],
  releaseBranchIds: ['branch-a'],
};

function view() {
  return render(<NextIntlClientProvider locale="en" messages={messages}><AssessmentsWorkspace {...props}/></NextIntlClientProvider>);
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

describe('assessments workspace navigation', () => {
  it('restores tab and course filters from browser history while preserving unrelated query keys', () => {
    window.history.replaceState({}, '', '/grading/assessments?tab=assignments&courseId=course-a&branchId=branch-a');
    view();

    expect(screen.getByRole('tab', { name: 'Assignments' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('combobox', { name: 'Course' })).toHaveValue('course-a');
    expect(screen.getByText('Assignment A')).toBeInTheDocument();
    expect(screen.queryByText('Assignment B')).not.toBeInTheDocument();

    window.history.replaceState({}, '', '/grading/assessments?tab=exams&branchId=branch-a');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(screen.getByRole('tab', { name: 'Exams' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('EXAMS_WORKSPACE')).toBeInTheDocument();
    expect(window.location.search).toContain('branchId=branch-a');
  });

  it('uses roving keyboard focus and keeps course selection in the URL', async () => {
    window.history.replaceState({}, '', '/grading/assessments?source=report');
    view();
    const exams = screen.getByRole('tab', { name: 'Exams' });
    exams.focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: 'Assignments' })).toHaveFocus();
    fireEvent.change(screen.getByRole('combobox', { name: 'Course' }), { target: { value: 'course-b' } });
    expect(window.location.search).toContain('tab=assignments');
    expect(window.location.search).toContain('courseId=course-b');
    expect(window.location.search).toContain('source=report');
  });

  it('distinguishes assignment versions while describing the aggregate submission scope', () => {
    window.history.replaceState({}, '', '/grading/assessments?tab=assignments');
    const versioned = [
      { ...assignments[0], version: 1 },
      { ...assignments[0], courseVersionId: 'version-a-2', version: 2 },
      { ...assignments[0], courseVersionId: 'version-a-unknown' },
    ];
    render(<NextIntlClientProvider locale="en" messages={messages}><AssessmentsWorkspace {...props} assignments={versioned}/></NextIntlClientProvider>);

    expect(screen.getByText('Version 1')).toBeInTheDocument();
    expect(screen.getByText('Version 2')).toBeInTheDocument();
    expect(screen.getByText('Version unavailable')).toBeInTheDocument();
    expect(screen.getByText('Submission links open the course and assignment queue across all versions.')).toBeInTheDocument();

    const links = screen.getAllByRole('link', { name: 'View submissions · all versions' });
    expect(links).toHaveLength(3);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([links[0].getAttribute('href'), links[0].getAttribute('href'), links[0].getAttribute('href')]);
    const queue = new URL(links[0].getAttribute('href')!, window.location.origin);
    expect(queue.searchParams.get('courseId')).toBe('course-a');
    expect(queue.searchParams.get('assignmentId')).toBe('assignment-a');
    expect(queue.searchParams.has('courseVersionId')).toBe(false);
  });
});
