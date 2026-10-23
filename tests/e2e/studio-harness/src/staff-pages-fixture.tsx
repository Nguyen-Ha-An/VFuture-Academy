import { useEffect, useState } from 'react';
import type { ContentStage } from '../../../../src/features/content-review/lifecycle';
import type { CourseRow } from '../../../../src/features/studio/courses-data';
import type { StudioHomeData } from '../../../../src/features/studio/home-data';
import { CoursesView } from '../../../../src/features/studio/ui/CoursesView';
import { StudioHomeView } from '../../../../src/features/studio/ui/StudioHomeView';
import { MediaLibraryView } from '../../../../src/features/studio/ui/content/MediaLibraryView';
import type { MediaAssetWithUsages } from '../../../../src/features/studio/ui/MediaLibrary';
import { GradingHomeView, type GradingHomeOverview } from '../../../../src/features/grading/ui/GradingHomeView';
import { GradingOperations } from '../../../../src/features/instructor-grading/GradingOperations';
import type { QueueTitles } from '../../../../src/features/instructor-grading/SubmissionsWorkspace';
import type { AssignmentMetadata, ExamOption } from '../../../../src/features/instructor-grading/types';
import { GradingFixture, type QueueWorkbenchFixture } from './grading-fixture';

/**
 * Browser-harness-only page fixtures for the Catmin page views (studio home, courses, media,
 * grading home and queue). Every value is plain data, as the server pages pass it; the fetch
 * stubs below answer only this harness and never reach a real server.
 */

/** Relative to the real clock, so feeds and waiting times read naturally whenever the harness runs. */
const NOW = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
const DAY = 86_400_000;
const daysAgo = (days: number, hours = 0) => new Date(Date.parse(NOW) - days * DAY - hours * 3_600_000).toISOString();
const utcDay = (days: number) => daysAgo(days).slice(0, 10);

const PEOPLE = [
  'Nguyễn Minh Anh', 'Trần Gia Bảo', 'Lê Thu Hà', 'Phạm Quốc Huy', 'Hoàng Ngọc Diệp', 'Vũ Đức Thắng', 'Đặng Thảo Vy',
  'Bùi Khánh Linh', 'Đỗ Hải Nam', 'Ngô Phương Thảo', 'Dương Tuấn Kiệt', 'Lý Mỹ Duyên', 'Hồ Thanh Tùng', 'Mai Anh Thư',
];
const COURSE_TITLES = [
  'Python cơ bản', 'Nền tảng trí tuệ nhân tạo', 'Tư duy thiết kế', 'Khoa học dữ liệu nhập môn', 'Lập trình web với React',
  'Toán rời rạc ứng dụng', 'Kỹ năng thuyết trình', 'Tiếng Anh học thuật', 'Robot và vi điều khiển', 'An toàn thông tin số',
  'Thống kê cho người mới', 'Thiết kế trò chơi', 'Kinh tế học vi mô', 'Sáng tạo nội dung số', 'Vật lý qua thí nghiệm',
  'Lịch sử khoa học', 'Học máy thực hành',
];

/* ------------------------------------------------------------------ /studio */

const STAGE_COUNTS: Record<ContentStage, number> = { draft: 14, in_review: 6, changes_requested: 3, approved: 2, published: 41, archived: 5 };

export const STUDIO_HOME: StudioHomeData = {
  generatedAt: NOW,
  shortcuts: [
    { key: 'courses', href: '/studio/courses' },
    { key: 'library', href: '/studio/library' },
    { key: 'questionBank', href: '/studio/bank' },
    { key: 'reviews', href: '/studio/reviews' },
  ],
  primary: { key: 'reviews', href: '/studio/reviews' },
  libraryHref: '/studio/library',
  reviewsHref: '/studio/reviews',
  reviewer: true,
  reviews: {
    state: 'ready',
    pending: STAGE_COUNTS.in_review,
    waiting: COURSE_TITLES.slice(0, 5).map((title, index) => ({
      id: `review-${index + 1}`,
      title,
      contentType: index % 2 ? 'resource' : 'course',
      owner: index % 3 === 2 ? { kind: 'branch', name: 'ANS · Hà Nội' } : { kind: 'central' },
      status: 'pending',
      submittedAt: daysAgo(6 - index, 3),
      submitter: PEOPLE[index],
    })),
  },
  content: {
    state: 'ready',
    total: Object.values(STAGE_COUNTS).reduce((sum, value) => sum + value, 0),
    stages: STAGE_COUNTS,
    byType: [
      { contentType: 'course', counts: { draft: 5, in_review: 3, changes_requested: 1, approved: 1, published: 17, archived: 2 } },
      { contentType: 'resource', counts: { draft: 4, in_review: 2, changes_requested: 1, approved: 1, published: 12, archived: 1 } },
      { contentType: 'opportunity', counts: { draft: 2, in_review: 1, changes_requested: 0, approved: 0, published: 6, archived: 1 } },
      { contentType: 'project', counts: { draft: 3, in_review: 0, changes_requested: 1, approved: 0, published: 6, archived: 1 } },
    ],
    recent: COURSE_TITLES.slice(5, 10).map((title, index) => ({
      key: `course:recent-${index}`,
      title,
      contentType: 'course',
      href: `/studio/courses/recent-${index}`,
      status: index === 0 ? 'published' : 'draft',
      stage: (['published', 'draft', 'in_review', 'changes_requested', 'approved'] as const)[index],
      updatedAt: daysAgo(index, 2),
    })),
  },
  activity: {
    state: 'ready',
    items: [
      { id: 'a1', kind: 'submitted', actor: { kind: 'person', name: 'Nguyễn Minh Anh', avatarUrl: null }, target: 'Python cơ bản', href: '/studio/reviews', at: daysAgo(0, 1) },
      { id: 'a2', kind: 'updated', actor: { kind: 'owner', owner: { kind: 'central' } }, target: 'Nền tảng trí tuệ nhân tạo', href: '/studio/courses/ai-foundations', at: daysAgo(0, 4) },
      { id: 'a3', kind: 'updated', actor: { kind: 'owner', owner: { kind: 'branch', name: 'ANS · Hà Nội' } }, target: 'Hướng dẫn học tập', href: '/studio/resources/huong-dan-hoc-tap', at: daysAgo(1, 2) },
      { id: 'a4', kind: 'submitted', actor: { kind: 'person', name: 'Trần Gia Bảo', avatarUrl: null }, target: 'Tư duy thiết kế', href: '/studio/reviews', at: daysAgo(1, 6) },
      { id: 'a5', kind: 'updated', actor: { kind: 'owner', owner: { kind: 'central' } }, target: 'Học bổng mùa thu 2026', href: '/studio/opportunities/hoc-bong', at: daysAgo(2, 1) },
      { id: 'a6', kind: 'submitted', actor: { kind: 'person', name: null, avatarUrl: null }, target: 'Khoa học dữ liệu nhập môn', href: null, at: daysAgo(3, 5) },
    ],
  },
};

export function StudioHomeFixture() {
  return <StudioHomeView data={STUDIO_HOME} />;
}

/* ---------------------------------------------------------- /studio/courses */

const COURSE_STAGES: Array<Pick<CourseRow, 'status' | 'reviewStatus' | 'stage'>> = [
  { status: 'published', reviewStatus: 'published', stage: 'published' },
  { status: 'draft', reviewStatus: null, stage: 'draft' },
  { status: 'draft', reviewStatus: 'pending', stage: 'in_review' },
  { status: 'published', reviewStatus: 'changes_requested', stage: 'changes_requested' },
  { status: 'draft', reviewStatus: 'approved', stage: 'approved' },
  { status: 'archived', reviewStatus: null, stage: 'archived' },
];

/** 34 courses: more than one 20-row page, so the footer pages with an honest total. */
export const COURSE_ROWS: CourseRow[] = Array.from({ length: 34 }, (_, index) => {
  const base = COURSE_TITLES[index % COURSE_TITLES.length]!;
  const round = Math.floor(index / COURSE_TITLES.length);
  return {
    id: index === 0 ? 'minimal' : `khoa-hoc-${index + 1}`,
    ...COURSE_STAGES[index % COURSE_STAGES.length]!,
    title: index === 0 ? 'Khóa học tối giản' : round ? `${base} (khóa ${round + 1})` : base,
    version: index % COURSE_STAGES.length === 1 ? null : 1 + (index % 4),
    updatedAt: daysAgo(index % 20, index % 7),
    owner: index % 5 === 4 ? 'ANS · Hà Nội' : null,
  };
});

export function CoursesListFixture() {
  return <CoursesView rows={COURSE_ROWS} reviews="ready" canCreate />;
}

/* ------------------------------------------------------------ /studio/media */

const MEDIA: Array<[string, string, number, boolean]> = [
  ['so-do-mang-no-ron.png', 'image/png', 184_320, true],
  ['anh-bia-python-co-ban.jpg', 'image/jpeg', 402_113, true],
  ['bai-giang-tu-duy-thiet-ke.pdf', 'application/pdf', 2_310_442, false],
  ['thi-nghiem-con-lac.mp4', 'video/mp4', 18_402_118, true],
  ['phat-am-tieng-anh.mp3', 'audio/mpeg', 3_120_774, false],
  ['bieu-do-thong-ke.png', 'image/png', 96_222, false],
  ['robot-arduino.jpg', 'image/jpeg', 512_900, true],
  ['phieu-bai-tap-toan.pdf', 'application/pdf', 812_004, true],
  ['giao-dien-react.png', 'image/png', 233_510, true],
  ['ban-do-lich-su-khoa-hoc.jpg', 'image/jpeg', 1_004_883, false],
  ['huong-dan-an-toan-so.pdf', 'application/pdf', 640_000, true],
  ['nhac-nen-thuyet-trinh.mp3', 'audio/mpeg', 2_048_000, true],
];

export const MEDIA_ASSETS: MediaAssetWithUsages[] = MEDIA.map(([filename, mime, sizeBytes, hasAlt], index) => ({
  id: `asset_${String(index + 1).padStart(4, '0')}`,
  mime,
  sizeBytes,
  width: mime.startsWith('image/') ? 1600 : null,
  height: mime.startsWith('image/') ? 900 : null,
  filename,
  alt: hasAlt ? { vi: `Hình minh họa: ${filename.replace(/\.[a-z0-9]+$/, '').replaceAll('-', ' ')}`, en: `Illustration: ${filename}` } : { vi: '', en: '' },
  createdAt: daysAgo(index * 2, 3),
  usages: index % 3 === 0 ? [{ source: 'version', courseId: 'python-co-ban', itemId: 'bai-tap-vong-lap', version: 2 }] : index % 4 === 1 ? [{ source: 'resource', resourceId: 'huong-dan-hoc-tap' }] : [],
}));

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Installs local answers for the given fetch routes while the fixture is mounted. */
function useFetchStub(handler: (url: URL, init?: RequestInit) => Response | Promise<Response> | undefined) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url = new URL(String(input instanceof Request ? input.url : input), location.origin);
      return (await handler(url, init)) ?? original(input, init);
    };
    setReady(true);
    return () => { window.fetch = original; };
  // The handler is a module-level closure per fixture; installing it once is intended.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ready;
}

export function MediaFixture() {
  const ready = useFetchStub((url, init) => {
    if (url.pathname.includes('/workflow')) {
      const id = url.pathname.split('/').at(-2) ?? 'asset_0001';
      return jsonResponse({ content: { contentType: 'media_asset', contentId: id, revisionKey: 'rev-1', status: 'draft', publishedRevisionKey: null }, activeReview: null, publication: null, actions: { requestReview: true, withdrawReview: false, approveAndPublish: false, mutate: true } });
    }
    const match = /\/api\/v1\/studio\/media\/([^/]+)$/.exec(url.pathname);
    if (match) {
      const asset = MEDIA_ASSETS.find((entry) => entry.id === decodeURIComponent(match[1]!));
      if (init?.method === 'PUT') return jsonResponse({ id: asset?.id, alt: JSON.parse(String(init.body)).alt, revisionKey: 'rev-2' });
      return jsonResponse({ id: asset?.id, alt: asset?.alt ?? { vi: '', en: '' }, revisionKey: 'rev-1' });
    }
    return undefined;
  });
  return ready ? <MediaLibraryView assets={MEDIA_ASSETS} recoveryKeyPrefix="harness-media" /> : null;
}

/* ----------------------------------------------------------------- /grading */

const GRADING_COURSES = [
  { courseId: 'python-co-ban', title: 'Python cơ bản', versionId: '11111111-1111-4111-8111-111111111111', items: [['bai-tap-vong-lap', 'Bài tập vòng lặp'], ['du-an-cuoi-khoa', 'Dự án cuối khóa']] },
  { courseId: 'tu-duy-thiet-ke', title: 'Tư duy thiết kế', versionId: '22222222-2222-4222-8222-222222222222', items: [['phong-van-nguoi-dung', 'Phỏng vấn người dùng'], ['nguyen-mau-giay', 'Nguyên mẫu giấy']] },
  { courseId: 'khoa-hoc-du-lieu', title: 'Khoa học dữ liệu nhập môn', versionId: '33333333-3333-4333-8333-333333333333', items: [['lam-sach-du-lieu', 'Làm sạch dữ liệu']] },
] as const;

const ASSIGNMENTS: AssignmentMetadata[] = GRADING_COURSES.flatMap((course) => course.items.map(([itemId, itemTitle]) => ({
  courseId: course.courseId,
  courseTitle: course.title,
  courseVersionId: course.versionId,
  itemId,
  itemTitle,
  assignmentId: itemId,
  rubric: { criteria: [{ id: 'quality', name: { vi: 'Chất lượng', en: 'Quality' }, maxPoints: 4 }, { id: 'clarity', name: { vi: 'Trình bày', en: 'Clarity' }, maxPoints: 4 }] },
})));

const EXAMS: ExamOption[] = [{ courseId: 'python-co-ban', courseTitle: 'Python cơ bản', courseVersionId: GRADING_COURSES[0].versionId, version: 1, itemId: 'kiem-tra-giua-ky', itemTitle: 'Kiểm tra giữa kỳ' }];

export const QUEUE_TITLES: QueueTitles = Object.fromEntries(GRADING_COURSES.map((course) => [course.versionId, { courseTitle: course.title, items: Object.fromEntries(course.items) }]));

const RESPONSES = [
  'Em dùng vòng lặp for để duyệt danh sách điểm và tính trung bình, sau đó in ra các bạn đạt trên 8 điểm.',
  'Nhóm em phỏng vấn 5 bạn học sinh lớp 10 về thói quen học buổi tối và rút ra 3 vấn đề chính.',
  'Bộ dữ liệu có 12% giá trị thiếu ở cột tuổi; em thay bằng trung vị theo từng lớp.',
];

/** 62 waiting submissions, oldest first: one full 50-row page plus a second page behind "Load more". */
export const QUEUE_SUBMISSIONS = Array.from({ length: 62 }, (_, index) => {
  const assignment = ASSIGNMENTS[index % ASSIGNMENTS.length]!;
  return {
    id: `sub-${String(index + 1).padStart(3, '0')}`,
    userId: `learner-${index % PEOPLE.length}`,
    learnerName: PEOPLE[index % PEOPLE.length]!,
    branchId: 'school',
    courseVersionId: assignment.courseVersionId,
    itemId: assignment.itemId,
    blockId: assignment.assignmentId,
    assignmentId: assignment.assignmentId,
    attemptNo: 1 + (index % 3 === 2 ? 1 : 0),
    status: index % 9 === 4 ? 'in_review' : 'submitted',
    submittedAt: new Date(Date.parse(NOW) - (62 - index) * 3 * 3_600_000).toISOString(),
    payload: { text: RESPONSES[index % RESPONSES.length] },
    files: [],
  };
});

/** Oldest waiting after `id` (the server's "Next in queue"), or null at the end of the queue. */
export function nextQueueHref(id: string) {
  const index = QUEUE_SUBMISSIONS.findIndex((submission) => submission.id === id);
  const next = index >= 0 ? QUEUE_SUBMISSIONS[index + 1] : undefined;
  return next ? `/grading/assignments/${next.id}?branchId=school&back=${encodeURIComponent('/grading/queue')}` : null;
}

export function queueSubmission(id: string) {
  const submission = QUEUE_SUBMISSIONS.find((entry) => entry.id === id);
  if (!submission) return null;
  const course = GRADING_COURSES.find((entry) => entry.versionId === submission.courseVersionId)!;
  return { submission, titles: { course: course.title, item: QUEUE_TITLES[course.versionId]!.items[submission.itemId] ?? null } };
}

const QUEUE_PAGE = 50;

export function GradingQueueFixture() {
  const ready = useFetchStub((url) => {
    if (url.pathname === '/api/v1/studio/submissions') {
      const status = url.searchParams.get('status');
      const rows = QUEUE_SUBMISSIONS.filter((row) => !status || status === 'pending' ? true : row.status === status);
      const start = Number(url.searchParams.get('cursor') ?? 0);
      const items = rows.slice(start, start + QUEUE_PAGE);
      return jsonResponse({ items, nextCursor: start + QUEUE_PAGE < rows.length ? String(start + QUEUE_PAGE) : null });
    }
    if (url.pathname.startsWith('/api/v1/studio/exams/')) return jsonResponse({ items: [], nextCursor: null });
    return undefined;
  });
  return ready ? <GradingOperations branches={[{ id: 'school', name: 'VFuture school' }]} courses={GRADING_COURSES.map((course) => ({ id: course.courseId, title: course.title }))} assignments={ASSIGNMENTS} exams={EXAMS} gradingBranchIds={['school']} titles={QUEUE_TITLES} /> : null;
}

const oldest = QUEUE_SUBMISSIONS.slice(0, 5);

export const GRADING_OVERVIEW: GradingHomeOverview = {
  generatedAt: NOW,
  statusCounts: { submitted: 55, in_review: 7, approved: 318, changes_requested: 24 },
  waiting: 62,
  examsAwaitingManual: 4,
  gradedLast7Days: 46,
  gradedPrior7Days: 39,
  oldest: oldest.map((submission) => {
    const titles = queueSubmission(submission.id)!.titles;
    return {
      id: submission.id,
      learnerName: submission.learnerName,
      courseTitle: titles.course,
      itemTitle: titles.item ?? submission.itemId,
      status: submission.status as 'submitted' | 'in_review',
      submittedAt: submission.submittedAt,
      href: `/grading/assignments/${submission.id}?branchId=school&back=${encodeURIComponent('/grading/queue?status=pending')}`,
    };
  }),
  throughput: Array.from({ length: 30 }, (_, index) => ({
    day: utcDay(29 - index),
    received: [4, 6, 3, 8, 5, 2, 1][index % 7]! + (index % 5),
    released: [3, 5, 4, 6, 6, 1, 0][index % 7]! + (index % 4),
  })),
  recent: PEOPLE.slice(3, 9).map((learnerName, index) => ({
    id: `grade-${index + 1}`,
    graderName: index % 3 === 2 ? null : ['Trần Thu Hà', 'Lê Văn Bình'][index % 2]!,
    graderAvatarUrl: null,
    learnerName,
    itemTitle: ASSIGNMENTS[index % ASSIGNMENTS.length]!.itemTitle,
    released: index !== 1,
    decision: index === 4 ? 'changes_requested' : 'approved',
    gradedAt: daysAgo(0, index * 3 + 1),
    href: `/grading/assignments/graded-${index + 1}`,
  })),
};

export function GradingHomeFixture() {
  return <GradingHomeView destinations={[{ key: 'queue', href: '/grading/queue' }, { key: 'assessments', href: '/grading/assessments' }, { key: 'reports', href: '/grading/reports' }]} overview={GRADING_OVERVIEW} />;
}

/** `/grading/assignments/sub-…`: the workbench for a queue fixture submission, with its titles and "Next in queue". */
export function QueuedWorkbenchFixture({ id }: { id: string }) {
  const [queued] = useState<QueueWorkbenchFixture | null>(() => {
    const found = queueSubmission(id);
    return found ? { submission: found.submission, titles: found.titles, nextHref: nextQueueHref(id) } : null;
  });
  return <GradingFixture kind="assignments" queued={queued} />;
}
