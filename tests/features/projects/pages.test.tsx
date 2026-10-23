// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import viMessages from '@/messages/vi.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import { ApiError } from '@/lib/api';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listProjects: vi.fn(),
  getProject: vi.fn(),
  listCatalog: vi.fn(),
  getLocale: vi.fn(),
  listStudioProjects: vi.fn(),
  getStudioProject: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  notFound: vi.fn(() => { throw new Error('not_found'); }),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(), supabaseUser: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/features/catalog/service', () => ({ listCatalog: mocks.listCatalog }));
vi.mock('@/features/admin/context', () => ({
  adminPageContext: async () => ({ actor: { userId: '00000000-0000-4000-8000-000000000001', roles: [] }, scope: { kind: 'central' } }),
  assertAdminPermission: vi.fn(),
}));
vi.mock('@/features/admin/content-review', () => ({ assertContentAccess: vi.fn() }));
vi.mock('@/features/admin/content-review-production', () => ({
  typedContentPageContext: async () => ({ actor: { userId: '00000000-0000-4000-8000-000000000001', roles: [] }, scope: { kind: 'central' } }),
}));
vi.mock('@/features/projects/service', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/projects/service')>(),
  listProjects: mocks.listProjects,
  getProject: mocks.getProject,
  listStudioProjects: mocks.listStudioProjects,
  getStudioProject: mocks.getStudioProject,
  createSupabaseProjectStore: vi.fn(() => ({})),
  createProjectService: vi.fn(() => ({ listStudio: mocks.listStudioProjects, getStudio: mocks.getStudioProject })),
}));
vi.mock('next-intl/server', () => ({
  getLocale: mocks.getLocale,
  getTranslations: vi.fn().mockImplementation(async (namespace: string) => (
    (key: string, values?: Record<string, string | number>) => {
      const messages: Record<string, string> = {
        'build.eyebrow': 'BUILD TOGETHER',
        'build.title': 'Projects',
        'build.description': 'Build description',
        'build.results': `${values?.count ?? 0} projects`,
        'build.empty': 'No projects',
        'build.filters.label': 'Filter projects',
        'build.filters.status': 'Status',
        'build.filters.allStatuses': 'All statuses',
        'build.filters.skill': 'Skill ID',
        'build.filters.skillName': 'Skill',
        'build.filters.allSkills': 'All skills',
        'build.filters.skillPlaceholder': 'data-literacy',
        'build.filters.course': 'Course ID',
        'build.filters.courseName': 'Course',
        'build.filters.allCourses': 'All courses',
        'build.filters.coursePlaceholder': 'ai-foundations',
        'build.filters.apply': 'Apply filters',
        'build.card.open': `Open ${values?.project ?? ''}`,
        'build.card.project': 'Project',
        'build.card.view': 'View project',
        'build.card.pending': 'Pending review',
        'build.card.skills': 'Skills',
        'build.card.courses': 'Related courses',
        'build.sections.proposal.title': 'Your proposals',
        'build.sections.proposal.description': 'Ideas awaiting review',
        'build.sections.participation.title': 'Your projects',
        'build.sections.participation.description': 'Projects you joined',
        'build.sections.showcase.title': 'Community showcases',
        'build.sections.showcase.description': 'Approved work',
        'build.detail.back': 'Back to projects',
        'build.detail.team': 'Team',
        'build.detail.outputs': 'Outputs',
        'build.detail.courses': 'Related courses',
        'build.detail.skills': 'Skills',
        'build.detail.interestedPeople': 'Interested learners',
        'build.detail.noOutputs': 'No outputs',
        'build.detail.ownerNote': 'Only you can see this interest list.',
        'build.detail.memberFallback': 'Academy member',
        'build.detail.nextStep': 'Next step',
        'build.detail.interestNote': 'Save your interest so the project team can see it.',
        'build.detail.pendingNote': 'This proposal is waiting for review.',
        'build.detail.relatedWork': 'Project information',
        'build.detail.teamEmpty': 'No team members yet.',
        'build.detail.skillsEmpty': 'No skills listed yet.',
        'build.sections.count': `${values?.count ?? 0} projects`,
        'build.filteredEmpty': 'No projects match these filters.',
        'build.emptyNoProjects': 'No projects have been shared yet.',
        'build.openProposal': 'Propose a project',
        'studio.projects.eyebrow': 'PROJECT STUDIO',
        'studio.projects.title': 'Projects',
        'studio.projects.description': 'Studio description',
        'studio.projects.empty': 'No projects',
        'studio.projects.createTitle': 'Create a project',
        'studio.projects.createDescription': 'Create description',
        'studio.projects.open': `Edit ${values?.project ?? ''}`,
        'studio.projects.approval.approved': 'Approved',
        'studio.projects.approval.pending': 'Pending review',
        'studio.projects.detail.back': 'Back to projects',
        'studio.projects.detail.eyebrow': 'PROJECT EDITOR',
        'studio.projects.detail.interestCount': `${values?.count ?? 0} interested learners`,
        'studio.projects.detail.interestedPeople': 'Interested learners',
      };
      const statuses: Record<string, string> = { idea: 'Idea', forming: 'Forming', active: 'Active', completed: 'Completed', showcased: 'Showcased' };
      return messages[`${namespace}.${key}`] ?? statuses[key.replace('status.', '')] ?? key;
    }
  )),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh, replace: mocks.replace }),
  usePathname: () => '/build',
  useSearchParams: () => new URLSearchParams(),
  notFound: mocks.notFound,
}));

import BuildPage from '@/app/app/projects/page';
import BuildDetailPage from '@/app/app/projects/[id]/page';
import NewProjectPage from '@/app/app/projects/new/page';
import StudioProjectsPage from '@/app/studio/projects/page';
import StudioProjectDetailPage from '@/app/studio/projects/[id]/page';
import StudioNewProjectPage from '@/app/studio/projects/new/page';
import { ProjectsBenchView } from '@/features/projects/ui/ProjectsBenchView';

const project = {
  id: 'climate-lab',
  title: { vi: 'Khí hậu', en: 'Climate lab' },
  summary: { vi: 'Dự án', en: 'Climate project' },
  status: 'active' as const,
  outputLinks: [{ label: { vi: 'Bản thử', en: 'Prototype' }, url: 'https://example.com/prototype' }],
  skills: ['data-literacy'],
  courseIds: ['ai-foundations'],
  ownerId: USER_ID,
  coverAssetId: null,
  approved: true,
  branchScope: { scope: 'global' as const },
  createdAt: '2026-09-03T00:00:00.000Z',
  updatedAt: '2026-09-03T00:00:00.000Z',
  viewerRole: null,
  relationship: 'showcase' as const,
};
const detail = {
  ...project,
  members: [{ userId: USER_ID, role: 'owner' as const, displayName: 'Project owner', handle: 'owner' }],
  relatedCourses: [{ id: 'ai-foundations', title: { vi: 'AI nền tảng', en: 'AI Foundations' } }],
  interested: false,
  canExpressInterest: true,
  interestList: [{ userId: '00000000-0000-4000-8000-000000000002', displayName: 'Interested learner', handle: 'learner' }],
};

function Provider({ children, locale = 'en' }: { children: React.ReactNode; locale?: 'en' | 'vi' }) {
  return <NextIntlClientProvider locale={locale} timeZone="UTC" messages={staffUiTestMessages(locale === 'vi' ? viMessages : en, locale)}>{children}</NextIntlClientProvider>;
}

beforeEach(() => {
  mocks.getLocale.mockResolvedValue('en');
  mocks.requireUser.mockResolvedValue({ id: USER_ID });
  mocks.listProjects.mockResolvedValue([project]);
  mocks.getProject.mockResolvedValue(detail);
  mocks.listCatalog.mockResolvedValue([{ id: 'ai-foundations', title: 'AI Foundations', skills: [{ id: 'data-literacy', name: 'Data literacy' }] }]);
  mocks.listStudioProjects.mockResolvedValue([project]);
  mocks.getStudioProject.mockResolvedValue(detail);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('project pages', () => {
  it('offers readable project filters from visible projects while preserving selected query context', async () => {
    mocks.listProjects.mockResolvedValueOnce([
      project,
      { ...project, id: 'robot-lab', title: { vi: 'Robot', en: 'Robot lab' }, status: 'forming', skills: ['robotics'], courseIds: ['robot-lab-course'] },
    ]);

    render(<Provider>{await BuildPage({ searchParams: Promise.resolve({
      status: 'active', skill: 'data-literacy', course: 'ai-foundations',
    }) })}</Provider>);

    expect(mocks.listProjects).toHaveBeenCalledWith(USER_ID);
    expect(screen.getByRole('combobox', { name: 'Skill' })).toHaveProperty('value', 'data-literacy');
    expect(within(screen.getByRole('combobox', { name: 'Skill' })).getByRole('option', { name: 'Data literacy' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Course' })).toHaveProperty('value', 'ai-foundations');
    expect(within(screen.getByRole('combobox', { name: 'Course' })).getByRole('option', { name: 'AI Foundations' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Open Climate lab' })).toHaveAttribute('href', '/app/projects/climate-lab?status=active&skill=data-literacy&course=ai-foundations');
    expect(screen.queryByRole('link', { name: 'Open Robot lab' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Propose a project' })).toHaveAttribute('href', '/app/projects/new');
    // The proposal form lives on its own route now.
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    const form = screen.getByRole('form', { name: 'Filter projects' });
    expect(form).toHaveAttribute('data-cols', '3');
    expect(within(form).getAllByRole('combobox').map(select => select.getAttribute('name'))).toEqual(['status', 'skill', 'course']);
    expect(within(form).getByRole('link', { name: 'Clear filters' })).toHaveAttribute('href', '/app/projects');
    const count = document.getElementById('project-results');
    expect(count).toHaveTextContent('1 project');
    expect(count).not.toHaveAttribute('aria-live');
    const chips = screen.getByRole('list', { name: 'Active filters' });
    expect(within(chips).getByRole('link', { name: 'Remove filter Skill: Data literacy' })).toHaveAttribute('href', '/app/projects?status=active&course=ai-foundations');
    expect(within(chips).getByRole('link', { name: 'Remove filter Course: AI Foundations' })).toHaveAttribute('href', '/app/projects?status=active&skill=data-literacy');
    // One spec table per relationship group; one link per row and no phone-only labels.
    const showcase = screen.getByRole('region', { name: 'Community showcases' });
    const table = within(showcase).getByRole('table', { name: 'Community showcases' });
    expect(table).toHaveAttribute('data-stack');
    const row = within(table).getByRole('row', { name: /Climate lab/ });
    expect(within(row).getAllByRole('link')).toHaveLength(1);
    expect(within(row).getByText('Active').closest('td')).toHaveAttribute('data-slot', 'lead');
    expect(within(row).getByText('Climate project')).toHaveClass('vf-l-row-summary');
    expect(document.querySelector('.vf-project-mobile-label')).toBeNull();
  });

  it('resets the project status select when the applied filters clear on the same mounted page (F2)', () => {
    const props = { projects: [project], locale: 'en' as const, skills: [], courses: [] };
    const view = render(<Provider><ProjectsBenchView {...props} filter={{ status: 'active' }} /></Provider>);
    const status = () => within(screen.getByRole('form', { name: 'Filter projects' })).getByRole('combobox', { name: 'Status' });
    expect(status()).toHaveValue('active');
    view.rerender(<Provider><ProjectsBenchView {...props} filter={{}} /></Provider>);
    expect(status()).toHaveValue('');
    expect(document.activeElement).toBe(document.getElementById('project-results'));
  });

  it('names a stale skill or course filter the same way in its select and its chip', () => {
    render(<Provider><ProjectsBenchView projects={[]} locale="en" skills={[]} courses={[]} filter={{ skill: 'retired-skill', course: 'old_course' }} /></Provider>);
    const form = screen.getByRole('form', { name: 'Filter projects' });
    expect(within(form).getByRole('combobox', { name: 'Skill' })).toHaveDisplayValue('Retired skill');
    expect(within(form).getByRole('combobox', { name: 'Course' })).toHaveDisplayValue('Old course');
    const chips = screen.getByRole('list', { name: 'Active filters' });
    expect(within(chips).getByRole('link', { name: 'Remove filter Skill: Retired skill' })).toHaveAttribute('href', '/app/projects?course=old_course');
    expect(within(chips).getByRole('link', { name: 'Remove filter Course: Old course' })).toHaveAttribute('href', '/app/projects?skill=retired-skill');
  });

  it('titles the empty and filtered-empty states as the page h2', () => {
    const props = { projects: [], locale: 'en' as const, skills: [], courses: [] };
    const view = render(<Provider><ProjectsBenchView {...props} filter={{ status: 'active' }} /></Provider>);
    expect(screen.getByRole('heading', { level: 2, name: 'No projects match these filters.' })).toBeInTheDocument();
    view.rerender(<Provider><ProjectsBenchView {...props} filter={{}} /></Provider>);
    expect(screen.getByRole('heading', { level: 2, name: 'No projects have been shared yet.' })).toBeInTheDocument();
  });

  it('uses Vietnamese catalog skill names and identifies unmatched skill IDs honestly on detail', async () => {
    mocks.getLocale.mockResolvedValueOnce('vi');
    mocks.getProject.mockResolvedValueOnce({ ...detail, skills: ['data-literacy', 'systems'] });
    mocks.listCatalog.mockResolvedValueOnce([{ id: 'ai-foundations', title: 'AI nền tảng', skills: [{ id: 'data-literacy', name: 'Hiểu biết dữ liệu' }] }]);

    render(<Provider locale="vi">{await BuildDetailPage({ params: Promise.resolve({ id: 'climate-lab' }) })}</Provider>);

    expect(mocks.listCatalog).toHaveBeenCalledWith({ userId: USER_ID, roles: [] }, 'vi');
    expect(screen.getByText('Hiểu biết dữ liệu')).toBeDefined();
    // An unmatched id reads as a name, never as "Skill ID: x".
    expect(screen.getByText('Systems')).toBeDefined();
    expect(screen.queryByText(/Mã kỹ năng|Skill ID/)).toBeNull();
    expect(screen.queryByText('systems')).toBeNull();
    expect(screen.queryByText('Data literacy')).toBeNull();
  });

  it('lays the detail out as flat cards: no card inside a card, the aside and the action panel present', async () => {
    const { container } = render(<Provider>{await BuildDetailPage({ params: Promise.resolve({ id: 'climate-lab' }) })}</Provider>);

    expect(container.querySelector('.vf-card .vf-card')).toBeNull();
    expect(container.querySelector('.vf-l-detail')).toHaveAttribute('data-aside');
    expect(container.querySelector('[data-area="action"] .vf-l-action')).not.toBeNull();
    expect(within(container.querySelector('aside') as HTMLElement).getByRole('heading', { name: 'Team' })).toBeDefined();
    expect(container.querySelector('.vf-project-action, .vf-project-cover')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Project information' })).toBe(container.querySelector('aside'));
  });

  it('keeps the pending note in the action panel without an empty action row', async () => {
    mocks.getProject.mockResolvedValueOnce({ ...detail, canExpressInterest: false });
    const { container } = render(<Provider>{await BuildDetailPage({ params: Promise.resolve({ id: 'climate-lab' }) })}</Provider>);

    const action = container.querySelector('[data-area="action"] .vf-l-action') as HTMLElement;
    expect(within(action).getByRole('heading', { name: 'Next step' })).toBeDefined();
    expect(action.querySelector('.vf-l-action-cta')).toBeNull();
    expect(within(action).queryByRole('button')).toBeNull();
  });

  it('makes interest and project context prominent on the detail without exposing hidden interest lists', async () => {
    mocks.getProject.mockResolvedValueOnce({ ...detail, viewerRole: null, interestList: undefined });

    render(<Provider>{await BuildDetailPage({
      params: Promise.resolve({ id: 'climate-lab' }),
      searchParams: Promise.resolve({ status: 'active', skill: 'data-literacy' }),
    })}</Provider>);

    expect(screen.getByRole('heading', { level: 1, name: 'Climate lab' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Next step' })).toBeDefined();
    const interest = screen.getByRole('button', { name: "I'm interested" });
    expect(interest.compareDocumentPosition(screen.getByRole('heading', { name: 'Outputs' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumbs' })).getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/app/projects?status=active&skill=data-literacy');
    expect(screen.getByRole('link', { name: 'AI Foundations' })).toHaveAttribute('href', '/app/courses/ai-foundations');
    expect(screen.queryByRole('heading', { name: 'Interested learners' })).toBeNull();
  });

  it('normalizes invalid learner controls and retains valid context through detail and back navigation', async () => {
    const list = render(<Provider>{await BuildPage({ searchParams: Promise.resolve({
      status: 'invalid', skill: 'Invalid Skill', course: 'ai-foundations',
    }) })}</Provider>);

    expect(mocks.listProjects).toHaveBeenLastCalledWith(USER_ID);
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveProperty('value', '');
    expect(screen.getByRole('combobox', { name: 'Skill' })).toHaveProperty('value', '');
    expect(screen.getByRole('combobox', { name: 'Course' })).toHaveProperty('value', 'ai-foundations');
    expect(screen.getByRole('link', { name: 'Open Climate lab' }).getAttribute('href')).toBe('/app/projects/climate-lab?course=ai-foundations');
    list.unmount();

    render(<Provider>{await BuildDetailPage({
      params: Promise.resolve({ id: 'climate-lab' }),
      searchParams: Promise.resolve({ status: 'invalid', skill: 'Invalid Skill', course: 'ai-foundations' }),
    } as Parameters<typeof BuildDetailPage>[0])}</Provider>);
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumbs' })).getByRole('link', { name: 'Projects' }).getAttribute('href')).toBe('/app/projects?course=ai-foundations');
    expect(screen.getByRole('heading', { level: 1 }).className).not.toContain('sm:text-5xl');
  });

  it('separates private proposals and participation from community showcases', async () => {
    mocks.listProjects.mockResolvedValueOnce([
      { ...project, id: 'my-proposal', approved: false, viewerRole: 'owner', relationship: 'proposal' },
      { ...project, id: 'team-project', approved: false, viewerRole: 'member', relationship: 'participation' },
      project,
    ]);

    render(<Provider>{await BuildPage({ searchParams: Promise.resolve({}) })}</Provider>);

    expect(screen.getByRole('heading', { name: 'Your proposals' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Your projects' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Community showcases' })).toBeDefined();
    expect(screen.getAllByText('Pending review')).toHaveLength(2);
  });

  it('renders team, outputs, related courses, interest action, and the owner-only interest list', async () => {
    render(<Provider>{await BuildDetailPage({ params: Promise.resolve({ id: 'climate-lab' }) })}</Provider>);

    expect(mocks.getProject).toHaveBeenCalledWith(USER_ID, 'climate-lab');
    expect(screen.getByRole('heading', { name: 'Team' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Prototype' }).getAttribute('href')).toBe('https://example.com/prototype');
    expect(screen.getByRole('link', { name: 'AI Foundations' }).getAttribute('href')).toBe('/app/courses/ai-foundations');
    expect(screen.getByRole('button', { name: "I'm interested" })).toBeDefined();
    expect(screen.getByText('Interested learner')).toBeDefined();
  });

  it('renders the proposal route with crumbs and catalog options even when no project has skills', async () => {
    mocks.listCatalog.mockResolvedValueOnce([
      { id: 'product-lab', title: 'Product lab', skills: [] },
      { id: 'ai-foundations', title: 'AI Foundations', skills: [{ id: 'data-literacy', name: 'Data literacy' }] },
    ]);

    render(<Provider>{await NewProjectPage()}</Provider>);

    expect(mocks.listCatalog).toHaveBeenCalledWith({ userId: USER_ID, roles: [] }, 'en');
    expect(mocks.listProjects).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Propose a project' })).toBeDefined();
    expect(screen.getByText('A3 / Projects · New')).toHaveClass('vf-kicker');
    const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumbs' }));
    expect(crumbs.getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/app/explore');
    expect(crumbs.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/app/projects');
    expect(crumbs.getByText('New proposal')).toHaveAttribute('aria-current', 'page');
    const form = screen.getByRole('form', { name: 'Propose a project' });
    expect(form.parentElement).toHaveClass('vf-proposal-card');
    expect(within(form).getByRole('button', { name: 'Related courses' })).toBeDefined();
    expect(within(form).getByRole('button', { name: 'Skills' })).toBeDefined();
  });

  it('confirms a submitted proposal on the detail and strips the query', async () => {
    render(<Provider>{await BuildDetailPage({
      params: Promise.resolve({ id: 'climate-lab' }),
      searchParams: Promise.resolve({ submitted: '1', status: 'active' }),
    })}</Provider>);

    const notice = screen.getByText('Proposal submitted for review.');
    expect(notice.closest('[role="status"]')).not.toBeNull();
    // Inside the detail page, under the page header (crumbs first), before the main column.
    const head = notice.closest('.vf-l-detail > [data-area="head"]');
    expect(head).not.toBeNull();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumbs' });
    expect(crumbs.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(document.querySelector('.vf-l-detail > [data-area="main"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mocks.replace).toHaveBeenCalledWith('/app/projects/climate-lab?status=active', { scroll: false });
  });

  it('maps an invisible learner project to the Next.js not-found boundary', async () => {
    mocks.getProject.mockRejectedValueOnce(new ApiError(404, 'PROJECT_NOT_FOUND', 'Project was not found'));

    await expect(BuildDetailPage({ params: Promise.resolve({ id: 'hidden-project' }) })).rejects.toThrow('not_found');
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it('renders the Studio project table with one create action that opens the create route', async () => {
    render(<Provider>{await StudioProjectsPage()}</Provider>);

    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Edit Climate lab' }).getAttribute('href')).toBe('/studio/projects/climate-lab');
    expect(screen.getByRole('link', { name: 'Create project' }).getAttribute('href')).toBe('/studio/projects/new');
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Active')).toBeDefined();
    expect(table.getByText('Approved')).toBeDefined();
    // The whole list is loaded, so the footer may state the total.
    expect(screen.getByText('Showing 1–1 of 1')).toBeDefined();
    // The create form moved to /studio/projects/new.
    expect(screen.queryByRole('heading', { name: 'Create a project' })).toBeNull();
  });

  it('renders the Studio project create route with the creation form', async () => {
    render(<Provider>{await StudioNewProjectPage()}</Provider>);

    expect(screen.getByRole('heading', { level: 1, name: 'Create a project' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Back to projects' }).getAttribute('href')).toBe('/studio/projects');
    expect(screen.getByRole('button', { name: 'Create project' })).toBeDefined();
  });

  it('renders the Studio detail editor with approval and interest count', async () => {
    render(<Provider>{await StudioProjectDetailPage({ params: Promise.resolve({ id: 'climate-lab' }) })}</Provider>);

    expect(screen.getByRole('heading', { name: 'Climate lab' })).toBeDefined();
    expect(screen.queryByRole('checkbox', { name: 'Approved for the learner showcase' })).toBeNull();
    expect(screen.getByText('1 interested learners')).toBeDefined();
    expect(screen.getByText('Interested learner')).toBeDefined();
  });

  it('maps a missing Studio project to the Next.js not-found boundary', async () => {
    mocks.getStudioProject.mockRejectedValueOnce(new ApiError(404, 'PROJECT_NOT_FOUND', 'Project was not found'));

    await expect(StudioProjectDetailPage({ params: Promise.resolve({ id: 'missing-project' }) }))
      .rejects.toThrow('not_found');
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
