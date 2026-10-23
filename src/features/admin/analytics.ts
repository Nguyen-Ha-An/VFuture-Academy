import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { ApiError } from '@/lib/api';
import { can, hasPermission, type Actor } from '@/lib/permissions';

export type BranchDailyRow = {
  branchId: string;
  day: string;
  activeLearners7d: number;
  activeLearners30d: number;
  enrollments: number;
  lessonProgressTotal: number;
  lessonCompletions: number;
  quizAttempts: number;
  examAttempts: number;
};

export type BranchCourseDailyRow = {
  branchId: string;
  courseId: string;
  day: string;
  quizAttempts: number;
  examAttempts: number;
  averagePercent: number | null;
  scoreSum: number;
  scoreCount: number;
};

export type FailedQuestion = {
  courseId: string;
  questionId: string;
  failures: number;
  attempts: number;
  failureRate: number;
};

export interface AnalyticsRepository {
  daily(branchId: string, from: string, to: string): Promise<BranchDailyRow[]>;
  courses(branchId: string, from: string, to: string): Promise<BranchCourseDailyRow[]>;
  pending(branchId: string): Promise<number>;
  topFailed(branchId: string, from: string, to: string): Promise<FailedQuestion[]>;
}

type DailyDatabaseRow = {
  branch_id: string;
  day: string;
  active_learners_7d: number | string;
  active_learners_30d: number | string;
  enrollments: number | string;
  lesson_progress_total: number | string;
  lesson_completions: number | string;
  quiz_attempts: number | string;
  exam_attempts: number | string;
};

type CourseDatabaseRow = {
  branch_id: string;
  course_id: string;
  day: string;
  quiz_attempts: number | string;
  exam_attempts: number | string;
  average_percent: number | string | null;
  score_sum: number | string;
  score_count: number | string;
};

type FailedDatabaseRow = {
  course_id: string;
  question_id: string;
  failures: number | string;
  attempts: number | string;
  failure_rate: number | string;
};

const number = (value: number | string) => typeof value === 'number' ? value : Number(value);

export function createSupabaseAnalyticsRepository(client: SupabaseClient): AnalyticsRepository {
  return {
    async daily(branchId, from, to) {
      const { data, error } = await client
        .from('analytics_branch_daily')
        .select('branch_id, day, active_learners_7d, active_learners_30d, enrollments, lesson_progress_total, lesson_completions, quiz_attempts, exam_attempts')
        .eq('branch_id', branchId)
        .gte('day', from)
        .lte('day', to)
        .order('day', { ascending: true });
      if (error) throw new Error('Unable to load branch analytics');
      return ((data ?? []) as DailyDatabaseRow[]).map((row) => ({
        branchId: row.branch_id,
        day: row.day,
        activeLearners7d: number(row.active_learners_7d),
        activeLearners30d: number(row.active_learners_30d),
        enrollments: number(row.enrollments),
        lessonProgressTotal: number(row.lesson_progress_total),
        lessonCompletions: number(row.lesson_completions),
        quizAttempts: number(row.quiz_attempts),
        examAttempts: number(row.exam_attempts),
      }));
    },
    async courses(branchId, from, to) {
      const { data, error } = await client
        .from('analytics_branch_course_daily')
        .select('branch_id, course_id, day, quiz_attempts, exam_attempts, average_percent, score_sum, score_count')
        .eq('branch_id', branchId)
        .gte('day', from)
        .lte('day', to)
        .order('day', { ascending: true });
      if (error) throw new Error('Unable to load course analytics');
      return ((data ?? []) as CourseDatabaseRow[]).map((row) => ({
        branchId: row.branch_id,
        courseId: row.course_id,
        day: row.day,
        quizAttempts: number(row.quiz_attempts),
        examAttempts: number(row.exam_attempts),
        averagePercent: row.average_percent === null ? null : number(row.average_percent),
        scoreSum: number(row.score_sum),
        scoreCount: number(row.score_count),
      }));
    },
    async pending(branchId) {
      const { data, error } = await client.rpc('analytics_pending_grading', { p_branch_id: branchId });
      if (error) throw new Error('Unable to load grading workload');
      return Number(data ?? 0);
    },
    async topFailed(branchId, from, to) {
      const { data, error } = await client.rpc('top_failed_questions', {
        p_branch_id: branchId,
        p_from: from,
        p_to: to,
      });
      if (error) throw new Error('Unable to load question analytics');
      return ((data ?? []) as FailedDatabaseRow[]).map((row) => ({
        courseId: row.course_id,
        questionId: row.question_id,
        failures: number(row.failures),
        attempts: number(row.attempts),
        failureRate: number(row.failure_rate),
      }));
    },
  };
}

const dateString = (date: Date) => date.toISOString().slice(0, 10);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function createAdminAnalyticsService(dependencies: { repository: AnalyticsRepository; now?: () => Date }) {
  const { repository, now = () => new Date() } = dependencies;
  return {
    async branch(actor: Actor, branchId: string) {
      if (!hasPermission(actor, 'analytics.branch.read', { branchId }) && !can(actor, 'report.branch.read', {kind:'branch',branchId})) {
        throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
      }

      const toDate = now();
      const fromDate = new Date(toDate);
      fromDate.setUTCDate(fromDate.getUTCDate() - 29);
      const period = { from: dateString(fromDate), to: dateString(toDate) };
      const [daily, courseDaily, pendingGradingCount, topFailedQuestions] = await Promise.all([
        repository.daily(branchId, period.from, period.to),
        repository.courses(branchId, period.from, period.to),
        repository.pending(branchId),
        repository.topFailed(branchId, period.from, period.to),
      ]);
      const latest = [...daily].sort((left, right) => left.day.localeCompare(right.day)).at(-1);
      const lessonProgressTotal = sum(daily.map((row) => row.lessonProgressTotal));
      const lessonCompletions = sum(daily.map((row) => row.lessonCompletions));

      const courseTotals = new Map<string, {
        quizAttempts: number;
        examAttempts: number;
        scoreTotal: number;
        scoreAttempts: number;
      }>();
      for (const row of courseDaily) {
        const current = courseTotals.get(row.courseId) ?? {
          quizAttempts: 0,
          examAttempts: 0,
          scoreTotal: 0,
          scoreAttempts: 0,
        };
        current.quizAttempts += row.quizAttempts;
        current.examAttempts += row.examAttempts;
        current.scoreTotal += row.scoreSum;
        current.scoreAttempts += row.scoreCount;
        courseTotals.set(row.courseId, current);
      }

      return {
        branchId,
        period,
        activeLearners: {
          days7: latest?.activeLearners7d ?? 0,
          days30: latest?.activeLearners30d ?? 0,
        },
        enrollments: sum(daily.map((row) => row.enrollments)),
        lessonCompletionRate: lessonProgressTotal === 0 ? 0 : round2(100 * lessonCompletions / lessonProgressTotal),
        attempts: {
          quiz: sum(daily.map((row) => row.quizAttempts)),
          exam: sum(daily.map((row) => row.examAttempts)),
        },
        pendingGradingCount,
        courses: [...courseTotals.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([courseId, totals]) => ({
            courseId,
            quizAttempts: totals.quizAttempts,
            examAttempts: totals.examAttempts,
            averagePercent: totals.scoreAttempts === 0 ? null : round2(totals.scoreTotal / totals.scoreAttempts),
          })),
        topFailedQuestions,
      };
    },
  };
}

export type BranchAnalytics = Awaited<ReturnType<ReturnType<typeof createAdminAnalyticsService>['branch']>>;
