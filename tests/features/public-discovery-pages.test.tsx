// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://labs.example.test' } }));
vi.mock('@/features/public-site/PublicStickyAction', () => ({ PublicStickyAction: () => null }));


const mocks = vi.hoisted(() => ({ listResources: vi.fn(), getResource: vi.fn(), listOpportunities: vi.fn(), getOpportunity: vi.fn(), listProjects: vi.fn(), getProject: vi.fn(), getPublicCourse: vi.fn(), listPublicCourses: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn().mockResolvedValue('en'), getTranslations: vi.fn().mockResolvedValue((key: string, values?: Record<string, unknown>) => values ? `${key}:${Object.values(values).join(':')}` : key) }));
vi.mock('@/features/marketing/public-discovery', () => ({ listPublicResources: mocks.listResources, getPublicResource: mocks.getResource, listPublicOpportunities: mocks.listOpportunities, getPublicOpportunity: mocks.getOpportunity, listPublicProjects: mocks.listProjects, getPublicProject: mocks.getProject }));
vi.mock('@/features/ecosystem/ui/StaticRichContent', () => ({ StaticRichContent: () => <div>public rich content</div> }));
vi.mock('next/image', () => ({ default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img {...props} alt={props.alt ?? ''} />
) }));
vi.mock('@/features/marketing/public-courses', () => ({ getPublicCourse: mocks.getPublicCourse, listPublicCourses: mocks.listPublicCourses }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/resources',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
  notFound: vi.fn(() => { throw new Error('not_found'); }),
  redirect: vi.fn((href: string) => { throw new Error(`redirect:${href}`); }),
}));

import ResourcesPage from '@/app/(public)/resources/page';
import ResourcePage from '@/app/(public)/resources/[resourceId]/page';
import OpportunitiesPage from '@/app/(public)/opportunities/page';
import OpportunityPage from '@/app/(public)/opportunities/[opportunityId]/page';
import ProjectsPage from '@/app/(public)/projects/page';
import ProjectPage from '@/app/(public)/projects/[projectId]/page';

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.getPublicCourse.mockResolvedValue(null); mocks.listPublicCourses.mockResolvedValue([]); });

describe('public discovery pages', () => {
  it('lets database failures reach the explicit public error boundary', async () => {
    mocks.listResources.mockRejectedValue(new Error('PUBLIC_READ_UNAVAILABLE'));
    await expect(ResourcesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('PUBLIC_READ_UNAVAILABLE');
  });

  it('keeps resource filters on pagination and links every result to its public detail', async () => {
    mocks.listResources.mockResolvedValue({ items: [{ id: 'guide/one', title: 'Guide one', summary: 'Summary', resourceType: 'guide', tags: ['ai'], skills: [], pathways: [], publishedAt: null }], total: 30, page: 2, pageSize: 12 });
    render(await ResourcesPage({ searchParams: Promise.resolve({ type: 'guide', search: 'robot', page: '2' }) }));
    expect(screen.getByRole('link', { name: 'Guide one' }).getAttribute('href')).toBe('/resources/guide%2Fone?search=robot&type=guide&page=2&lang=en');
    expect(screen.getByRole('link', { name: 'pagination.previous' }).getAttribute('href')).toContain('search=robot');
    expect(screen.getByRole('link', { name: 'pagination.next' }).getAttribute('href')).toContain('type=guide');
  });

  it('renders a public resource body, public attachment, and explicit protected handoff', async () => {
    mocks.getResource.mockResolvedValue({ id: 'guide', title: 'Guide', summary: 'Summary', resourceType: 'guide', tags: [], skills: [], pathways: [], publishedAt: null, body: { blocks: [{ type: 'paragraph', text: 'Public body' }] }, attachments: [{ label: 'Worksheet', src: { assetId: 'asset one' } }] });
    render(await ResourcePage({ params: Promise.resolve({ resourceId: 'guide' }) }));
    expect(screen.getByText('public rich content')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Worksheet' }).getAttribute('href')).toBe('/api/v1/public/media/asset%20one');
    expect(screen.getByRole('link', { name: /resourceAction/ }).getAttribute('href')).toBe('/app/resources/guide');
  });

  it('passes functional opportunity filters and links results publicly', async () => {
    mocks.listOpportunities.mockResolvedValue({ items: [{ id: 'sprint', title: 'Sprint', organization: 'Lab', type: 'hackathon', featured: true, online: true }], total: 1, page: 1, pageSize: 12 });
    render(await OpportunitiesPage({ searchParams: Promise.resolve({ type: 'hackathon', openNow: 'true', featured: 'true' }) }));
    expect(mocks.listOpportunities).toHaveBeenCalledWith('en', expect.objectContaining({ type: 'hackathon', openNow: true, featured: true }));
    expect(screen.getByRole('link', { name: 'Sprint' }).getAttribute('href')).toBe('/opportunities/sprint?type=hackathon&openNow=true&featured=true&lang=en');
  });

  it.each([
    ['resources', () => { mocks.listResources.mockResolvedValue({ items: [], total: 13, page: 999, pageSize: 12 }); return ResourcesPage({ searchParams: Promise.resolve({ type: 'guide', tag: 'ai', pathway: 'research-innovation', search: 'robot', page: '999' }) }); }, '/resources?type=guide&tag=ai&pathway=research-innovation&search=robot&page=2&lang=en'],
    ['opportunities', () => { mocks.listOpportunities.mockResolvedValue({ items: [], total: 13, page: 999, pageSize: 12 }); return OpportunitiesPage({ searchParams: Promise.resolve({ type: 'hackathon', openNow: 'true', featured: 'true', page: '999' }) }); }, '/opportunities?type=hackathon&openNow=true&featured=true&lang=en&page=2'],
    ['projects', () => { mocks.listProjects.mockResolvedValue({ items: [], total: 13, page: 999, pageSize: 12 }); return ProjectsPage({ searchParams: Promise.resolve({ skill: 'robotics', course: 'ai-foundations', page: '999' }) }); }, '/projects?skill=robotics&course=ai-foundations&lang=en&page=2'],
  ])('redirects an out-of-range %s catalog request to its last page with filters retained', async (_catalog, loadPage, expectedPath) => {
    await expect(loadPage()).rejects.toThrow(`redirect:${expectedPath}`);
  });

  it('uses localized public course titles while keeping course filter IDs', async () => {
    mocks.listProjects.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 });
    mocks.listPublicCourses.mockResolvedValue([{ id: 'robotics-101', title: 'Robotics foundations' }]);
    render(await ProjectsPage({ searchParams: Promise.resolve({ course: 'robotics-101' }) }));
    expect(mocks.listPublicCourses).toHaveBeenCalledWith('en', { limit: 500 });
    expect(mocks.listProjects).toHaveBeenCalledWith('en', expect.objectContaining({ course: 'robotics-101', pageSize: 12 }));
    expect(screen.getByRole('combobox', { name: 'Course' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Robotics foundations' }).getAttribute('value')).toBe('robotics-101');
    expect(screen.queryByText('robotics-101')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Skill' }).getAttribute('aria-describedby')).toBe('project-skill-hint');
  });

  it('retains an unavailable incoming course filter without displaying its raw ID', async () => {
    mocks.listProjects.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 });
    render(await ProjectsPage({ searchParams: Promise.resolve({ course: 'unpublished-course' }) }));
    expect(screen.getByRole('option', { name: 'Selected course unavailable' }).getAttribute('value')).toBe('unpublished-course');
    expect(screen.queryByText('unpublished-course')).toBeNull();
    expect(mocks.listProjects).toHaveBeenCalledWith('en', expect.objectContaining({ course: 'unpublished-course' }));
  });

  it('keeps course-list failures distinct from an empty project collection', async () => {
    mocks.listProjects.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 });
    mocks.listPublicCourses.mockRejectedValueOnce(new Error('Public courses could not be loaded'));
    await expect(ProjectsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('Public courses could not be loaded');
  });

  it('labels recommended opportunity skills as skills for the heading and tag list', async () => {
    mocks.getOpportunity.mockResolvedValue({ id: 'sprint', title: 'Sprint', organization: 'Lab', type: 'hackathon', description: { blocks: [] }, recommendedSkills: ['prototyping'], recommendedCourses: [], requiredCourses: [], applicationUrl: null, internalParticipation: false, openAt: null, closeAt: null, startAt: null, endAt: null, location: null, online: true, featured: false, publishedAt: null });
    render(await OpportunityPage({ params: Promise.resolve({ opportunityId: 'sprint' }) }));
    expect(screen.getByRole('heading', { name: 'recommendedSkills' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'recommendedSkills' })).toBeTruthy();
  });

  it('requires login with a return destination before an external opportunity application', async () => {
    mocks.getOpportunity.mockResolvedValue({ id: 'sprint', title: 'Sprint', organization: 'Lab', type: 'hackathon', description: { blocks: [] }, recommendedSkills: [], recommendedCourses: [], requiredCourses: [], applicationUrl: 'https://external.example/apply', internalParticipation: false, openAt: null, closeAt: null, startAt: null, endAt: null, location: null, online: true, featured: false, publishedAt: null });
    render(await OpportunityPage({ params: Promise.resolve({ opportunityId: 'sprint' }) }));

    expect(screen.getByRole('link', { name: /action.apply/ }).getAttribute('href'))
      .toBe('/login?next=%2Fapp%2Fopportunities%2Fsprint');
  });

  it('does not advertise an application handoff after the public opportunity closes', async () => {
    mocks.getOpportunity.mockResolvedValue({ id: 'closed', title: 'Closed', organization: 'Lab', type: 'hackathon', description: { blocks: [] }, recommendedSkills: [], recommendedCourses: [], requiredCourses: [], applicationUrl: 'https://external.example/apply', internalParticipation: false, openAt: null, closeAt: '2020-01-01T00:00:00.000Z', startAt: null, endAt: null, location: null, online: true, featured: false, publishedAt: null });
    render(await OpportunityPage({ params: Promise.resolve({ opportunityId: 'closed' }) }));

    expect(screen.queryByRole('link', { name: /action.apply/ })).toBeNull();
    expect(screen.getByText('action.closed')).toBeTruthy();
  });

  it('shows only public project fields, public media, outputs, and the protected continuation', async () => {
    mocks.getProject.mockResolvedValue({ id: 'robot', title: 'Robot', summary: 'Built together', status: 'showcased', skills: ['robotics'], courseIds: ['robotics-101'], coverAssetId: 'cover', createdAt: '', updatedAt: '', outputLinks: [{ label: 'Demo', url: 'https://example.com/demo' }] });
    mocks.getPublicCourse.mockResolvedValue({ id: 'robotics-101', title: 'Robotics foundations' });
    render(await ProjectPage({ params: Promise.resolve({ projectId: 'robot' }) }));
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/api/v1/public/media/cover');
    expect(screen.getByRole('link', { name: /Demo/ }).getAttribute('href')).toBe('https://example.com/demo');
    expect(screen.getByRole('link', { name: 'Robotics foundations' }).getAttribute('href')).toBe('/courses/robotics-101?lang=en');
    expect(screen.getByRole('link', { name: /projectAction/ }).getAttribute('href')).toBe('/app/projects/robot');
  });
});

describe('public detail navigation context and disclosure', () => {
  it('returns resources to the same allowlisted search context without accepting a raw return URL', async () => {
    mocks.getResource.mockResolvedValue({ id: 'guide', title: 'Guide', summary: 'Summary', resourceType: 'guide', tags: [], skills: [], pathways: [], publishedAt: null, body: { blocks: [] }, attachments: [] });
    render(await ResourcePage({ params: Promise.resolve({ resourceId: 'guide' }), searchParams: Promise.resolve({ search: 'robot', type: 'guide', tag: 'ai', pathway: 'research-innovation', page: '2', returnTo: 'https://untrusted.example/' }) }));
    const href = screen.getByRole('link', { name: 'back' }).getAttribute('href')!;
    const url = new URL(href, 'https://labs.example.test');
    expect(url.pathname).toBe('/resources');
    expect(Object.fromEntries(url.searchParams)).toEqual({ search: 'robot', type: 'guide', tag: 'ai', pathway: 'research-innovation', page: '2', lang: 'en' });
    expect(document.querySelectorAll('h1')).toHaveLength(1);
  });

  it('returns a project to its filters and exposes only related courses verified by the public loader', async () => {
    mocks.getProject.mockResolvedValue({ id: 'robot', title: 'Robot', summary: 'Built together', status: 'showcased', skills: [], courseIds: ['public-course', 'private-course'], coverAssetId: null, createdAt: '', updatedAt: '', outputLinks: [] });
    mocks.getPublicCourse.mockImplementation(async (id: string) => id === 'public-course' ? { id, title: 'Public course title' } : null);
    render(await ProjectPage({ params: Promise.resolve({ projectId: 'robot' }), searchParams: Promise.resolve({ skill: 'robotics', course: 'public-course', page: '3', returnTo: '/app/admin' }) }));
    const back = new URL(screen.getByRole('link', { name: 'detail.back' }).getAttribute('href')!, 'https://labs.example.test');
    expect(Object.fromEntries(back.searchParams)).toEqual({ skill: 'robotics', course: 'public-course', page: '3', lang: 'en' });
    expect(screen.getByRole('link', { name: 'Public course title' }).getAttribute('href')).toBe('/courses/public-course?lang=en');
    expect(document.body.textContent).not.toContain('private-course');
    expect(mocks.getPublicCourse).toHaveBeenCalledWith('private-course', 'en');
    expect(document.querySelectorAll('h1')).toHaveLength(1);
  });

  it('retains opportunity context but never adds filters to the protected application destination', async () => {
    mocks.getOpportunity.mockResolvedValue({ id: 'sprint', title: 'Sprint', organization: 'Lab', type: 'hackathon', description: { blocks: [] }, recommendedSkills: [], recommendedCourses: ['private-course'], requiredCourses: [], applicationUrl: 'https://external.example/apply', internalParticipation: false, openAt: null, closeAt: null, startAt: null, endAt: null, location: null, online: true, featured: false, publishedAt: null });
    mocks.getPublicCourse.mockResolvedValue(null); mocks.listPublicCourses.mockResolvedValue([]);
    render(await OpportunityPage({ params: Promise.resolve({ opportunityId: 'sprint' }), searchParams: Promise.resolve({ type: 'hackathon', openNow: 'true', featured: 'true', page: '2', returnTo: '//untrusted.example' }) }));
    const back = new URL(screen.getByRole('link', { name: 'back' }).getAttribute('href')!, 'https://labs.example.test');
    expect(Object.fromEntries(back.searchParams)).toEqual({ type: 'hackathon', openNow: 'true', featured: 'true', page: '2', lang: 'en' });
    expect(screen.getByRole('link', { name: /action.apply/ }).getAttribute('href')).toBe('/login?next=%2Fapp%2Fopportunities%2Fsprint');
    expect(document.body.textContent).not.toContain('private-course');
    expect(document.querySelectorAll('h1')).toHaveLength(1);
  });
});
