import { countdown, ictDate, ictTime } from '../format';

/** Course progress for a tolerance bar. `band` only when a real schedule exists (spec section 8). */
export type BenchProgress = { completed: number; total: number; band?: readonly [number, number] | null; due?: string | null };

export type BenchCourseRow = {
  id: string;
  title: string;
  part: string;
  href: string;
  /** Mono sub line (items, minutes, level). */
  sub: string;
  /** Prerequisite part labels, when the read model provides them. */
  dependsOn?: string[];
  progress?: BenchProgress | null;
  next?: { code: string; title: string; href: string } | null;
};

export type DashboardResume = {
  title: string;
  href: string;
  courseTitle: string;
  part: string;
  /** `M2 · L2.3` when the outline is known. */
  position?: string;
  minutes?: number;
  progress?: BenchProgress | null;
};

export type DashboardExam = { title: string; courseTitle: string; part: string; href: string; openAt: string | null; closeAt: string | null };
export type DashboardFeedback = { title: string; courseTitle: string; href: string; decision: 'approved' | 'changes_requested'; message: string; at: string };

export type DashboardState = 'resume' | 'caught-up' | 'completed' | 'first-run';

export type LearnerDashboardData = {
  now: Date;
  name: string;
  state: DashboardState;
  resume: DashboardResume | null;
  courses: BenchCourseRow[];
  exam: DashboardExam | null;
  feedback: DashboardFeedback | null;
  /** A course completed (certificate issued) in the last 7 days. */
  completion: { courseTitle: string; part: string } | null;
};

export type ExamDeadline = { at: string; kind: 'opens' | 'closes'; countdown: string; stamp: string };

/** The next real deadline for an exam window: opening if it has not opened, otherwise closing. */
export function examDeadline(exam: { openAt: string | null; closeAt: string | null } | null, now: Date): ExamDeadline | null {
  if (!exam) return null;
  const opens = exam.openAt ? countdown(exam.openAt, now) : null;
  const at = opens ? exam.openAt : exam.closeAt;
  const remaining = opens ?? (exam.closeAt ? countdown(exam.closeAt, now) : null);
  if (!at || !remaining) return null;
  const date = new Date(at);
  return { at, kind: opens ? 'opens' : 'closes', countdown: remaining, stamp: `${ictDate(date).slice(0, 5)} ${ictTime(date)}` };
}

export const percentOf = (progress: Pick<BenchProgress, 'completed' | 'total'>) => progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
