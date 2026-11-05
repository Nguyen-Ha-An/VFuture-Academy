/** Learner projections keep the enrollment's pinned version and embedded block identity. */
export type CourseworkIdentity = {
  courseId: string;
  courseVersionId: string;
  branchId: string | null;
  itemId: string;
  blockId: string | null;
  title: string;
  courseTitle: string;
  href: string;
};
export type CourseTask = CourseworkIdentity & {
  id: string;
  kind: 'assignment' | 'exam';
  status: string;
  dueAt: string | null;
  submissionId: string | null;
  late: boolean | null;
};
export type CourseResult = CourseworkIdentity & {
  id: string;
  kind: 'assignment' | 'exam' | 'quiz';
  status: string;
  points: number;
  maxPoints: number;
  percent: number | null;
  passed: boolean | null;
  recordedAt: string;
};
export type LearningCalendarEvent = CourseworkIdentity & {
  id: string;
  kind: 'assignment_due' | 'exam_open' | 'exam_close';
  at: string;
};
export type LearningCalendar = { timeZone: 'Asia/Ho_Chi_Minh'; events: LearningCalendarEvent[] };
export type LearningAnnouncement = {
  id: string;
  branchId: string;
  courseId: string;
  courseTitle: string;
  title: string;
  body: string;
  publishedAt: string;
};
