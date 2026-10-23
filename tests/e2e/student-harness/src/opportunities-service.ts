import { z } from 'zod';
import { OPPORTUNITY_TYPES } from '@/features/opportunities/schema';
import type { LocalizedOpportunity, OpportunityContext, OpportunityPage } from '../../../../src/features/opportunities/service';
import { ApiError } from '@/lib/api-error';

// Browser-safe rendering replica; unit normalization tests use the production service schema.
export const OpportunityListFilterSchema = z.object({
 type: z.enum(OPPORTUNITY_TYPES).optional(), openNow: z.boolean().optional(), featured: z.boolean().optional(),
 page: z.coerce.number().int().min(1).max(10_000).optional(),
}).strict();
export type OpportunityListFilter = z.infer<typeof OpportunityListFilterSchema>;
function opportunity(locale: string): LocalizedOpportunity {
 const vi = locale === 'vi';
 return {
  id: 'fixture-opportunity', title: vi ? 'Xưởng thực hành thiết kế hệ thống' : 'Systems design practice workshop',
  organization: 'VFuture fixture learning group', type: 'workshop',
  description: { blocks: [
   { type: 'heading', level: 2, content: [{ text: vi ? 'Cùng học và thực hành' : 'Learn and practice together' }] },
   { type: 'paragraph', content: [{ text: vi ? 'Thảo luận một vấn đề thực tế và xây dựng bản đồ hệ thống cùng nhóm học tập.' : 'Discuss a practical problem and build a system map with your learning group.' }] },
  ] },
  eligibility: { Experience: 'Foundation course completed' }, recommendedSkills: ['systems'],
  recommendedCourses: ['ai-basics'], requiredCourses: ['ai-basics'], applicationUrl: null,
  internalApplication: true, openAt: '2020-01-01T00:00:00Z', closeAt: '2100-01-01T00:00:00Z',
  startAt: '2026-10-01T09:00:00Z', endAt: '2026-10-01T11:00:00Z', location: vi ? 'Trực tuyến' : 'Online',
  online: true, featured: true, interested: false,
 };
}
type FixtureRow = Pick<LocalizedOpportunity, 'id' | 'type' | 'openAt' | 'closeAt' | 'online' | 'featured'> & { title: [vi: string, en: string]; location: [vi: string, en: string] | null };
// Directory rows beyond the routed fixture: upcoming, closed, not featured, in person, and a long title.
const rows: FixtureRow[] = [
 { id: 'fixture-opportunity-upcoming', type: 'hackathon', openAt: '2099-06-01T00:00:00Z', closeAt: '2099-06-30T16:59:59Z', online: false, featured: false, location: ['Hà Nội', 'Hanoi'], title: ['Hackathon robot mùa hè', 'Summer robotics hackathon'] },
 { id: 'fixture-opportunity-closed', type: 'competition', openAt: '2020-01-01T00:00:00Z', closeAt: '2021-03-15T16:59:59Z', online: true, featured: false, location: null, title: ['Cuộc thi ý tưởng khởi nghiệp', 'Startup idea competition'] },
 { id: 'fixture-opportunity-long', type: 'research_cohort', openAt: null, closeAt: '2100-02-28T09:00:00Z', online: false, featured: false, location: ['Thành phố Hồ Chí Minh', 'Ho Chi Minh City'], title: [
  'Nhóm nghiên cứu liên trường về trí tuệ nhân tạo có trách nhiệm dành cho học sinh trung học phổ thông quan tâm đến chính sách công nghệ',
  'Inter-school responsible artificial intelligence research cohort for upper-secondary students interested in technology policy and ethics',
 ] },
];
function listed(locale: string): LocalizedOpportunity[] {
 const base = opportunity(locale);
 const vi = locale === 'vi';
 return [base, ...rows.map(({ title, location, ...row }): LocalizedOpportunity => ({
  ...base, ...row, title: vi ? title[0] : title[1], location: location ? (vi ? location[0] : location[1]) : null, interested: false,
 }))];
}
function openAt(value: LocalizedOpportunity, now: Date) {
 return (!value.openAt || Date.parse(value.openAt) <= now.getTime()) && (!value.closeAt || Date.parse(value.closeAt) >= now.getTime());
}
export function createOpportunityService(_dependencies: unknown) { return {
 async listPage(filters: OpportunityListFilter, context: OpportunityContext): Promise<OpportunityPage> {
  const now = context.now ?? new Date();
  const items = listed(context.locale).filter(value => (!filters.type || filters.type === value.type)
   && (filters.featured === undefined || value.featured === filters.featured)
   && (!filters.openNow || openAt(value, now)));
  return { page: filters.page ?? 1, pageSize: 50, total: items.length, items };
 },
 async get(id: string, context: OpportunityContext) {
  if (id !== 'fixture-opportunity') throw new ApiError(404, 'FIXTURE_NOT_FOUND', 'Opportunity fixture not found');
  return { ...opportunity(context.locale), courseStatuses: [{ courseId: 'ai-basics', status: 'completed' }] };
 },
}; }
