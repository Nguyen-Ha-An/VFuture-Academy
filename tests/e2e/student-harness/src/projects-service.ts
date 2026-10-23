import type { ProjectDetail, ProjectFilters, ProjectListEntry } from '../../../../src/features/projects/service';
import { ApiError } from '@/lib/api-error';

// Exact browser-safe enumeration consumed by the real projectListContext normalizer.
export const PROJECT_STATUSES = ['idea', 'forming', 'active', 'completed', 'showcased'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type { ProjectFilters, ProjectListEntry };
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
 if (filters.statuses && !filters.statuses.includes(project.status)) return [];
 if (filters.skills?.some(skill => !project.skills.includes(skill))) return [];
 if (filters.courseIds?.some(id => !project.courseIds.includes(id))) return [];
 return [{ ...project, relationship: 'showcase' }];
}
export async function getProject(_userId: string, id: string): Promise<ProjectDetail> {
 if (id !== project.id) throw new ApiError(404, 'FIXTURE_NOT_FOUND', 'Project fixture not found');
 return project;
}
