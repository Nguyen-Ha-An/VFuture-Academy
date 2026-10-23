// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    const labels: Record<string, string> = { handle: '@{handle}', title: 'Propose a project', description: 'Share an idea privately.', urlName: 'Project URL name', urlNameHint: 'Use lowercase letters.', ideaFields: 'Project idea', optionalDetails: 'Optional project details', titleVi: 'Vietnamese title', titleEn: 'English title', summaryVi: 'Vietnamese summary', summaryEn: 'English summary', skills: 'Skill IDs', skillsHint: 'data-literacy', courses: 'Related course IDs', coursesHint: 'ai-foundations', cover: 'Cover asset ID', coverHint: 'asset', outputs: 'Output links', outputsHint: 'One per line', submit: 'Submit proposal', submitting: 'Submitting', success: 'Proposal submitted', error: 'Proposal failed' };
    return (labels[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => values?.[name] ?? '');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => {
    const labels: Record<string, string> = { explore: 'Explore', exploreTitle: 'Find what fits you', exploreDescription: 'Choose a destination.', courses: 'Courses', resources: 'Resources', opportunities: 'Opportunities', projects: 'Projects', 'exploreCards.courses': 'Start with a learning path.', 'exploreCards.resources': 'Find guides and templates.', 'exploreCards.opportunities': 'Find programs and events.', 'exploreCards.projects': 'Build with the community.' };
    return labels[key] ?? key;
  }),
}));

import ExplorePage from '@/app/app/explore/page';
import { ProfileHandle } from '@/features/workspace-ui/profile/ProfileHandle';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('student discovery refinements', () => {
  it('offers concise four-destination exploration including resources', async () => {
    render(await ExplorePage());

    expect(screen.getByRole('link', { name: /Courses/ })).toHaveAttribute('href', '/app/courses?tab=discover');
    expect(screen.getByRole('link', { name: /Resources/ })).toHaveAttribute('href', '/app/resources');
    expect(screen.getByRole('link', { name: /Opportunities/ })).toHaveAttribute('href', '/app/opportunities');
    expect(screen.getByRole('link', { name: /Projects/ })).toHaveAttribute('href', '/app/projects');
    expect(screen.getByText('Find guides and templates.')).toBeVisible();
  });

  it('updates the visible handle when a saved handle is announced', async () => {
    render(<ProfileHandle handle="old_handle" />);
    expect(screen.getByText('@old_handle')).toBeVisible();

    window.dispatchEvent(new CustomEvent('profile-handle-saved', { detail: { handle: 'new_handle' } }));

    await waitFor(() => expect(screen.getByText('@new_handle')).toBeVisible());
  });
});
