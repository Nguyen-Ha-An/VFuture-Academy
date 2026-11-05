import type { ProjectDetail, ProjectFilters, ProjectListEntry } from '../../../../src/features/projects/service';
import { ApiError } from '@/lib/api-error';
import { supportFixtureState } from '../../support/support-transport';
import { supportReviewParam } from '../../support/support-review-state';

// Exact browser-safe enumeration consumed by the real projectListContext normalizer.
export const PROJECT_STATUSES = ['idea', 'forming', 'active', 'completed', 'showcased'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type { ProjectFilters, ProjectListEntry };
const supportState = () => supportReviewParam('supportState');
function assertAvailable() {
 if (supportState() === 'error') throw new Error('Synthetic support fixture: projects unavailable');
}
const project: ProjectDetail = {
 id: 'fixture-project', title: { en: 'A community learning map', vi: 'Bản đồ học tập cộng đồng' },
 summary: { en: 'A student project connecting learning resources, peer practice and community questions.', vi: 'Dự án kết nối tài liệu học tập, thực hành theo nhóm và câu hỏi của cộng đồng.' },
 status: 'active', outputLinks: [{ label: { en: 'Project research notes', vi: 'Ghi chú nghiên cứu' }, url: 'https://example.test/project-notes' }],
 skills: ['systems', 'collaboration'], courseIds: ['ai-basics'], ownerId: 'fixture-owner', coverAssetId: null,
 approved: true, branchScope: { scope: 'global' }, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z',
 members: [{ userId: 'fixture-owner', role: 'owner', displayName: 'Fixture Student', handle: 'fixture-student' }, { userId: 'fixture-mentor', role: 'mentor', displayName: 'Learning Mentor', handle: null }],
 relatedCourses: [{ id: 'ai-basics', title: { en: 'AI foundations', vi: 'Nền tảng AI' } }],
 interested: false, viewerRole: null, canExpressInterest: true,
};
export async function listProjects(_userId: string, filters: ProjectFilters = {}): Promise<ProjectListEntry[]> {
 assertAvailable();
 if (supportState() === 'empty') return [];
 const pending = supportState() === 'pending';
 const base: ProjectListEntry = { ...project, ...(pending ? { status: 'idea', approved: false, viewerRole: 'owner' } as const : {}), relationship: pending ? 'proposal' : 'showcase' };
 // Dense data includes all three existing relationship groups, without inventing a new workflow.
 const rows: ProjectListEntry[] = supportState() === 'dense' ? Array.from({ length: 18 }, (_, index) => ({
  ...base, id: index === 0 ? project.id : `fixture-project-dense-${index}`,
  title: { en: `Synthetic community learning project ${index + 1}`, vi: `Dự án học tập cộng đồng mẫu ${index + 1}` },
  status: PROJECT_STATUSES[index % PROJECT_STATUSES.length], approved: index % 3 !== 0,
  relationship: index % 3 === 0 ? 'proposal' : index % 3 === 1 ? 'participation' : 'showcase',
  viewerRole: index % 3 === 0 ? 'owner' : index % 3 === 1 ? 'member' : null,
 })) : [base];
 return rows.filter(value => (!filters.statuses || filters.statuses.includes(value.status))
  && !filters.skills?.some(skill => !value.skills.includes(skill))
  && !filters.courseIds?.some(id => !value.courseIds.includes(id)));
}
export async function getProject(_userId: string, id: string): Promise<ProjectDetail> {
 assertAvailable();
 if (id !== project.id) throw new ApiError(404, 'FIXTURE_NOT_FOUND', 'Project fixture not found');
 const value = { ...project, interested: supportFixtureState().interests[`/api/v1/projects/${id}/interest`] ?? false };
 if (supportState() === 'pending') return { ...value, status: 'idea', approved: false, viewerRole: 'owner', canExpressInterest: false, outputLinks: [], interestList: [] };
 if (supportState() === 'empty') return { ...value, outputLinks: [], members: [], skills: [], relatedCourses: [] };
 if (supportState() === 'dense') return { ...value, viewerRole: 'owner', canExpressInterest: false,
  members: Array.from({ length: 12 }, (_, index): ProjectDetail['members'][number] => ({ userId: `fixture-member-${index}`, role: index === 0 ? 'owner' : index === 1 ? 'mentor' : 'member', displayName: `Synthetic project learner ${index + 1}`, handle: `fixture-member-${index}` })),
  interestList: Array.from({ length: 8 }, (_, index) => ({ userId: `fixture-interest-${index}`, displayName: `Synthetic interested learner ${index + 1}`, handle: null })),
 };
 return value;
}
