export const STUDIO_REPORT_TIMEZONE = 'Asia/Ho_Chi_Minh' as const;

export type ReportPublication = 'released' | 'unreleased' | 'all';
export type StudioReportQuery = {
  from?: string;
  to?: string;
  branchId?: string;
  courseId?: string;
  publication?: ReportPublication;
};

export type ReportRate = { percent: number | null; sampleSize: number };
export type ReportKinds<T> = { quiz: T; exam: T; assignment: T };

export type StudioLearningReport = {
  period: { from: string; to: string; timezone: typeof STUDIO_REPORT_TIMEZONE };
  filters: { branchId: string | null; courseId: string | null; publication: ReportPublication };
  visibility: { unknownHistoricalBranch: boolean };
  overview: {
    activeUsers: number;
    newEnrollments: number;
    cohort: { enrollments: number; completedByPeriodEnd: number; completionRate: number | null };
    attempts: ReportKinds<number>;
    averages: ReportKinds<ReportRate>;
    passRates: ReportKinds<ReportRate>;
  };
  courses: Array<{
    courseId: string;
    title: string | null;
    newEnrollments: number;
    completedByPeriodEnd: number;
    completionRate: number | null;
    attempts: ReportKinds<number>;
    averages: ReportKinds<ReportRate>;
    passRates: ReportKinds<ReportRate>;
  }>;
  questions: Array<{
    courseId: string;
    courseVersionId: string;
    itemId: string;
    itemTitle: string | null;
    questionId: string;
    questionVersionId: string | null;
    prompt: string | null;
    zeroPointAnswers: number;
    gradedAnswers: number;
    zeroPointRate: number | null;
    sourceHref: string;
  }>;
  grading: {
    asOf: string;
    label: 'current';
    assignments: { pending: number; unpublished: number };
    exams: { pendingManualAttempts: number; pendingManualQuestions: number; unpublished: number };
  };
};
