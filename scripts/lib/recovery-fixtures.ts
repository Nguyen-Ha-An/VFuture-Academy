import type { ResourceDocument } from '../../src/content-engine/schema/bundle';
import type { CourseDocument } from '../../src/content-engine/schema/course';
import type { OpportunityForm } from '../../src/features/opportunities/schema';
import type { ProjectInput } from '../../src/features/projects/service';

export type RecoveryCourseFixture = {
  document: CourseDocument;
  createInput: {
    id: string;
    title: CourseDocument['title'];
    languages: CourseDocument['languages'];
    defaultLanguage: CourseDocument['defaultLanguage'];
    pathway: CourseDocument['pathway'];
    level: CourseDocument['level'];
  };
  inlineJson: string;
};

export type RecoveryFixtureData = {
  courses: RecoveryCourseFixture[];
  resources: ResourceDocument[];
  opportunities: OpportunityForm[];
  projects: ProjectInput[];
};

export type RecoveryContentKind = 'course' | 'resource' | 'opportunity' | 'project';
export type RecoveryContentState = 'missing' | 'draft' | 'published';
export type RecoveryOpportunitySchedule = Pick<OpportunityForm, 'openAt' | 'closeAt' | 'startAt' | 'endAt'>;
export type RecoveryOpportunitySchedulePatch = {
  open_at: string | null;
  close_at: string | null;
  start_at: string | null;
  end_at: string | null;
};

/** Returns a schedule-only update for a recognized fixture row when its clock window is stale. */
export function recoveryOpportunitySchedulePatch(
  value: unknown,
  desired: RecoveryOpportunitySchedule,
): RecoveryOpportunitySchedulePatch | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const title = row.title;
  const markedTitle = typeof title === 'object' && title !== null && !Array.isArray(title)
    && typeof (title as Record<string, unknown>).vi === 'string'
    && ((title as Record<string, unknown>).vi as string).startsWith('[PHỤC HỒI]')
    && typeof (title as Record<string, unknown>).en === 'string'
    && ((title as Record<string, unknown>).en as string).startsWith('[RECOVERY]');
  if (typeof row.id !== 'string' || !row.id.startsWith('recovery-')
    || row.status !== 'published'
    || row.organization !== 'VFuture Labs — Recovery Sample'
    || !markedTitle) return null;
  const patch = {
    open_at: desired.openAt,
    close_at: desired.closeAt,
    start_at: desired.startAt,
    end_at: desired.endAt,
  };
  return row.open_at === patch.open_at
    && row.close_at === patch.close_at
    && row.start_at === patch.start_at
    && row.end_at === patch.end_at
    ? null
    : patch;
}

export interface RecoveryFixtureServices {
  contentState(kind: RecoveryContentKind, id: string): Promise<RecoveryContentState>;
  createCourse(fixture: RecoveryCourseFixture): Promise<void>;
  importCourse(fixture: RecoveryCourseFixture): Promise<void>;
  publishCourse(id: string): Promise<void>;
  saveResource(document: ResourceDocument): Promise<void>;
  publishResource(id: string): Promise<void>;
  saveOpportunity(document: OpportunityForm): Promise<void>;
  publishOpportunity(id: string): Promise<void>;
  refreshOpportunitySchedule(id: string, schedule: RecoveryOpportunitySchedule): Promise<boolean>;
  createProject(document: ProjectInput): Promise<void>;
}

export type RecoverySeedSummary = {
  coursesCreated: number;
  coursesPublished: number;
  resourcesCreated: number;
  resourcesPublished: number;
  opportunitiesCreated: number;
  opportunitiesPublished: number;
  opportunitySchedulesRefreshed: number;
  projectsCreated: number;
};

const DAY_MS = 24 * 60 * 60 * 1_000;

function atDay(now: Date, offset: number): string {
  return new Date(now.getTime() + offset * DAY_MS).toISOString();
}

function bilingualParagraph(vi: string, en: string) {
  return {
    vi: { blocks: [{ type: 'paragraph' as const, content: [{ text: vi }] }] },
    en: { blocks: [{ type: 'paragraph' as const, content: [{ text: en }] }] },
  };
}

function courseFixture(
  id: string,
  title: CourseDocument['title'],
  summary: CourseDocument['summary'],
  access: CourseDocument['access'],
  lessonTitle: CourseDocument['title'],
): RecoveryCourseFixture {
  const document: CourseDocument = {
    schemaVersion: 1,
    kind: 'course',
    id,
    slug: id,
    title,
    summary,
    description: bilingualParagraph(
      'Mẫu dữ liệu phục hồi dùng để kiểm tra luồng học tập trên môi trường staging.',
      'A recovery sample used to verify the staging learning flow.',
    ),
    languages: ['vi', 'en'],
    defaultLanguage: 'vi',
    level: 'foundation',
    difficulty: 'beginner',
    pathway: 'core-future-skills',
    tags: ['recovery-sample', 'staging'],
    estimatedMinutes: 25,
    learningOutcomes: [{
      vi: 'Hoàn thành một bài học ngắn và xác nhận quyền truy cập.',
      en: 'Complete a short lesson and confirm access behavior.',
    }],
    access,
    enrollment: 'open',
    completion: { rules: [{ type: 'all_items' }], certificate: false },
    modules: [{
      id: `${id}-module`,
      title: { vi: 'Bắt đầu', en: 'Getting started' },
      items: [{
        type: 'lesson',
        id: `${id}-lesson`,
        title: lessonTitle,
        objectives: [{ vi: 'Hiểu mục đích của mẫu.', en: 'Understand the purpose of this sample.' }],
        estimatedMinutes: 5,
        blocks: [{
          type: 'paragraph',
          content: [{ text: 'Đây là nội dung mẫu phục hồi. / This is recovery sample content.' }],
        }],
      }],
    }],
  };
  return {
    document,
    createInput: {
      id: document.id,
      title: document.title,
      languages: document.languages,
      defaultLanguage: document.defaultLanguage,
      pathway: document.pathway,
      level: document.level,
    },
    inlineJson: JSON.stringify(document, null, 2),
  };
}

/** Builds stable, clearly labelled staging samples relative to an explicit clock. */
export function recoveryFixtureData(now: Date, ownerId: string): RecoveryFixtureData {
  const courses = [
    courseFixture(
      'recovery-course-global',
      { vi: '[PHỤC HỒI] Nền tảng làm việc nhóm', en: '[RECOVERY] Collaboration Foundations' },
      { vi: 'Khóa học mẫu công khai cho mọi chi nhánh.', en: 'A globally visible sample course for every branch.' },
      { scope: 'global' },
      { vi: 'Cộng tác có chủ đích', en: 'Intentional collaboration' },
    ),
    courseFixture(
      'recovery-course-vinsmc',
      { vi: '[PHỤC HỒI] Xưởng đổi mới VinSMC', en: '[RECOVERY] VinSMC Innovation Lab' },
      { vi: 'Khóa học mẫu giới hạn cho học viên VinSMC.', en: 'A sample course restricted to VinSMC learners.' },
      { scope: 'branches', branchIds: ['vinsmc'] },
      { vi: 'Xác định vấn đề thực tế', en: 'Frame a real problem' },
    ),
  ];

  const resources: ResourceDocument[] = [
    {
      schemaVersion: 1,
      kind: 'resource',
      id: 'recovery-resource-project-brief',
      languages: ['vi', 'en'],
      defaultLanguage: 'vi',
      title: { vi: '[PHỤC HỒI] Mẫu đề bài dự án', en: '[RECOVERY] Project Brief Template' },
      summary: { vi: 'Khung ngắn để biến một vấn đề thành kế hoạch dự án.', en: 'A concise framework for turning a problem into a project plan.' },
      resourceType: 'template',
      tags: ['recovery-sample', 'project-planning'],
      pathways: ['entrepreneurship-product'],
      branchScope: { scope: 'global' },
      body: bilingualParagraph(
        'Nêu người dùng, vấn đề, bằng chứng và kết quả mong muốn trước khi chọn giải pháp.',
        'Name the user, problem, evidence, and desired outcome before choosing a solution.',
      ),
    },
    {
      schemaVersion: 1,
      kind: 'resource',
      id: 'recovery-resource-vinsmc-field-guide',
      languages: ['vi', 'en'],
      defaultLanguage: 'vi',
      title: { vi: '[PHỤC HỒI] Cẩm nang khảo sát VinSMC', en: '[RECOVERY] VinSMC Fieldwork Guide' },
      summary: { vi: 'Hướng dẫn mẫu dành riêng cho hoạt động khảo sát tại VinSMC.', en: 'A sample guide for VinSMC field research.' },
      resourceType: 'guide',
      tags: ['recovery-sample', 'fieldwork'],
      pathways: ['research-innovation'],
      branchScope: { scope: 'branches', branchIds: ['vinsmc'] },
      body: bilingualParagraph(
        'Xin phép, ghi nhận bối cảnh và ẩn danh dữ liệu trước khi chia sẻ kết quả.',
        'Ask permission, capture context, and anonymize data before sharing findings.',
      ),
    },
  ];

  const opportunityBase: Pick<OpportunityForm,
    'organization' | 'description' | 'eligibility' | 'recommendedSkills' | 'requiredCourses'
    | 'applicationUrl' | 'internalApplication' | 'location' | 'online'
  > = {
    organization: 'VFuture Labs — Recovery Sample',
    description: bilingualParagraph(
      'Cơ hội mẫu phục vụ kiểm thử phục hồi trên staging.',
      'A sample opportunity for recovery testing in staging.',
    ),
    eligibility: { note: 'Recovery fixture only / Chỉ là dữ liệu mẫu phục hồi' },
    recommendedSkills: [],
    requiredCourses: [],
    applicationUrl: null,
    internalApplication: true,
    location: 'Hà Nội',
    online: true,
  };
  const opportunities: OpportunityForm[] = [
    {
      ...opportunityBase,
      id: 'recovery-opportunity-open',
      title: { vi: '[PHỤC HỒI] Sprint giải pháp khí hậu', en: '[RECOVERY] Climate Solutions Sprint' },
      type: 'hackathon',
      recommendedCourses: ['recovery-course-global'],
      openAt: atDay(now, -7), closeAt: atDay(now, 7), startAt: atDay(now, 10), endAt: atDay(now, 12),
      branchScope: { scope: 'global' },
      featured: true,
    },
    {
      ...opportunityBase,
      id: 'recovery-opportunity-upcoming',
      title: { vi: '[PHỤC HỒI] Nhóm nghiên cứu VinSMC', en: '[RECOVERY] VinSMC Research Cohort' },
      type: 'research_cohort',
      recommendedCourses: ['recovery-course-vinsmc'],
      openAt: atDay(now, 14), closeAt: atDay(now, 35), startAt: atDay(now, 42), endAt: atDay(now, 70),
      branchScope: { scope: 'branches', branchIds: ['vinsmc'] },
      featured: false,
    },
    {
      ...opportunityBase,
      id: 'recovery-opportunity-expired',
      title: { vi: '[PHỤC HỒI] Chương trình cố vấn mùa hè', en: '[RECOVERY] Summer Mentorship' },
      type: 'mentorship',
      recommendedCourses: ['recovery-course-global'],
      openAt: atDay(now, -45), closeAt: atDay(now, -15), startAt: atDay(now, -10), endAt: atDay(now, -2),
      branchScope: { scope: 'global' },
      featured: false,
    },
  ];

  const projectBase = {
    outputLinks: [],
    skills: [],
    coverAssetId: null,
    members: [{ userId: ownerId, role: 'owner' as const }],
  };
  const projects: ProjectInput[] = [
    {
      ...projectBase,
      id: 'recovery-project-campus-energy',
      title: { vi: '[PHỤC HỒI] Bản đồ năng lượng trường học', en: '[RECOVERY] Campus Energy Map' },
      summary: { vi: 'Nhóm học sinh trực quan hóa các điểm tiêu thụ năng lượng.', en: 'Students visualize the campus energy hotspots.' },
      status: 'active', approved: true, branchScope: { scope: 'global' },
      courseIds: ['recovery-course-global'],
    },
    {
      ...projectBase,
      id: 'recovery-project-vinsmc-air',
      title: { vi: '[PHỤC HỒI] Cảm biến không khí VinSMC', en: '[RECOVERY] VinSMC Air Sensors' },
      summary: { vi: 'Đề xuất đang chờ duyệt về theo dõi chất lượng không khí.', en: 'A pending proposal for tracking local air quality.' },
      status: 'forming', approved: false, branchScope: { scope: 'branches', branchIds: ['vinsmc'] },
      courseIds: ['recovery-course-vinsmc'],
    },
    {
      ...projectBase,
      id: 'recovery-project-water-stories',
      title: { vi: '[PHỤC HỒI] Câu chuyện nguồn nước', en: '[RECOVERY] Water Stories' },
      summary: { vi: 'Dự án VinSMC đã hoàn thành về dữ liệu và câu chuyện cộng đồng.', en: 'A completed VinSMC project combining data and community stories.' },
      status: 'completed', approved: true, branchScope: { scope: 'branches', branchIds: ['vinsmc'] },
      courseIds: ['recovery-course-vinsmc'],
    },
  ];

  return { courses, resources, opportunities, projects };
}

/** Creates only missing recovery fixtures and publishes missing or draft content. */
export async function runRecoveryFixtureSeed(
  fixtures: RecoveryFixtureData,
  services: RecoveryFixtureServices,
): Promise<RecoverySeedSummary> {
  const ids = [
    ...fixtures.courses.map(({ document }) => document.id),
    ...fixtures.resources.map(({ id }) => id),
    ...fixtures.opportunities.map(({ id }) => id),
    ...fixtures.projects.map(({ id }) => id),
  ];
  if (ids.some((id) => !id.startsWith('recovery-'))) {
    throw new Error('Recovery fixtures must stay inside the recovery-* namespace.');
  }
  const summary: RecoverySeedSummary = {
    coursesCreated: 0,
    coursesPublished: 0,
    resourcesCreated: 0,
    resourcesPublished: 0,
    opportunitiesCreated: 0,
    opportunitiesPublished: 0,
    opportunitySchedulesRefreshed: 0,
    projectsCreated: 0,
  };

  for (const fixture of fixtures.courses) {
    const state = await services.contentState('course', fixture.document.id);
    if (state === 'published') continue;
    if (state === 'missing') {
      await services.createCourse(fixture);
      summary.coursesCreated += 1;
    }
    await services.importCourse(fixture);
    await services.publishCourse(fixture.document.id);
    summary.coursesPublished += 1;
  }
  for (const document of fixtures.resources) {
    const state = await services.contentState('resource', document.id);
    if (state === 'published') continue;
    await services.saveResource(document);
    if (state === 'missing') summary.resourcesCreated += 1;
    await services.publishResource(document.id);
    summary.resourcesPublished += 1;
  }
  for (const document of fixtures.opportunities) {
    const state = await services.contentState('opportunity', document.id);
    if (state === 'published') {
      const changed = await services.refreshOpportunitySchedule(document.id, {
        openAt: document.openAt,
        closeAt: document.closeAt,
        startAt: document.startAt,
        endAt: document.endAt,
      });
      if (changed) summary.opportunitySchedulesRefreshed += 1;
      continue;
    }
    await services.saveOpportunity(document);
    if (state === 'missing') summary.opportunitiesCreated += 1;
    await services.publishOpportunity(document.id);
    summary.opportunitiesPublished += 1;
  }
  for (const document of fixtures.projects) {
    if (await services.contentState('project', document.id) !== 'missing') continue;
    await services.createProject(document);
    summary.projectsCreated += 1;
  }
  return summary;
}
