import { z } from 'zod';
import { RESOURCE_TYPES } from '@/content-engine/schema/bundle';
import { PATHWAYS } from '@/content-engine/schema/course';
import type { LocalizedResource, ResourceContext, ResourcePage } from '../../../../src/features/resources/service';
import { ApiError } from '@/lib/api-error';
import { supportReviewParam } from '../../support/support-review-state';

// Rendering-only replica of the service schema. Real-schema normalization tests remain authoritative.
export const ResourceListFilterSchema = z.object({
 type: z.enum(RESOURCE_TYPES).optional(), tag: z.string().trim().min(1).max(40).optional(),
 pathway: z.enum(PATHWAYS).optional(), search: z.string().trim().min(1).max(200).optional(),
 page: z.coerce.number().int().min(1).max(10_000).optional(),
}).strict();
export type ResourceListFilter = z.infer<typeof ResourceListFilterSchema>;
// Rendering-only query state. Service failures reach the harness error boundary, not Next error.tsx.
const supportState = () => supportReviewParam('supportState');
function assertAvailable() {
 if (supportState() === 'error') throw new Error('Synthetic support fixture: resources unavailable');
}
function resource(locale: string): LocalizedResource {
 const vi = locale === 'vi';
 return {
  id: 'fixture-resource', title: vi ? 'Hướng dẫn thực hành tư duy hệ thống' : 'A practical guide to systems thinking',
  summary: vi ? 'Tài liệu học tập mẫu để kiểm tra bố cục và khả năng truy cập.' : 'Deterministic discovery content for browser geometry and accessibility.',
  resourceType: 'reading', tags: ['systems', 'learning'], skills: ['systems'], pathways: ['core-future-skills'],
  body: { blocks: [
   { type: 'heading', level: 2, content: [{ text: vi ? 'Quan sát các mối liên hệ' : 'Observe the connections' }] },
   { type: 'paragraph', content: [{ text: vi ? 'Ghi lại cách mỗi thành phần tác động đến toàn bộ hệ thống trước khi đề xuất thay đổi.' : 'Record how each part influences the whole system before proposing a change.' }] },
  ] },
  attachments: [{ label: vi ? 'Phiếu thực hành' : 'Practice worksheet', src: { url: 'https://example.test/worksheet.pdf' } }],
  publishedAt: '2026-09-01T00:00:00Z',
 };
}
// Directory rows beyond the routed fixture: a long title, several tags, and no pathway.
function listed(locale: string): LocalizedResource[] {
 const base = resource(locale);
 const vi = locale === 'vi';
 return [base, {
  ...base, id: 'fixture-resource-long', resourceType: 'project_walkthrough', pathways: ['ai-emerging-technology', 'research-innovation'],
  title: vi ? 'Hướng dẫn từng bước xây dựng, kiểm thử và trình bày một dự án thị giác máy tính nhận diện rác thải cho câu lạc bộ khoa học của trường' : 'A step-by-step walkthrough for building, testing and presenting a computer-vision waste-sorting project for a school science club',
  summary: vi ? 'Từ thu thập dữ liệu đến buổi trình bày cuối kỳ, kèm các lỗi thường gặp và cách khắc phục.' : 'From collecting data to the final showcase, with the common mistakes and how to fix them.',
  tags: ['computer-vision', 'datasets', 'python', 'sustainability', 'presentation', 'teamwork'],
 }, {
  ...base, id: 'fixture-resource-template', resourceType: 'template', pathways: [], tags: [],
  title: vi ? 'Mẫu kế hoạch dự án' : 'Project plan template',
  summary: vi ? 'Một trang để thống nhất mục tiêu, vai trò và mốc thời gian.' : 'One page to agree on goals, roles and milestones.',
 }];
}
export function createResourceService(_dependencies: unknown) { return {
 async listPage(filters: ResourceListFilter, context: ResourceContext): Promise<ResourcePage> {
  assertAvailable();
  const base = supportState() === 'empty' ? [] : listed(context.locale);
  // Dense rows test the actual 50-item pager; only the canonical detail ID is routed by main.tsx.
  const rows = supportState() === 'dense' ? Array.from({ length: 63 }, (_, index) => ({
   ...base[index % base.length],
   id: index === 0 ? 'fixture-resource' : `fixture-resource-dense-${index}`,
   title: `${base[index % base.length].title} · ${index + 1}`,
  })) : base;
  const matching = rows.filter(value => (!filters.type || filters.type === value.resourceType) && (!filters.tag || value.tags.includes(filters.tag)) && (!filters.pathway || value.pathways.includes(filters.pathway)) && (!filters.search || `${value.title} ${value.summary}`.toLowerCase().includes(filters.search.toLowerCase())));
  const page = filters.page ?? 1;
  return { page, pageSize: 50, total: matching.length, items: matching.slice((page - 1) * 50, page * 50) };
 },
 async get(id: string, context: ResourceContext): Promise<LocalizedResource> {
  assertAvailable();
  if (id !== 'fixture-resource') throw new ApiError(404, 'FIXTURE_NOT_FOUND', 'Resource fixture not found');
  const value = resource(context.locale);
  return supportState() === 'empty' ? { ...value, body: { blocks: [] }, attachments: [], tags: [], pathways: [] } : value;
 },
}; }
