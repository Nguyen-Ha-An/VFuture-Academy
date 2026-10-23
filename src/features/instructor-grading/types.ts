import type { Actor } from '@/lib/permissions';

export type InstructorActor = Actor;

export type BranchOption = {
  id: string;
  name: string;
};

export type LocalizedLabel = string | { vi?: string; en?: string };

export type RubricLevel = {
  points: number;
  label: LocalizedLabel;
  description?: LocalizedLabel;
};

export type RubricCriterion = {
  id: string;
  name: LocalizedLabel;
  description?: LocalizedLabel;
  maxPoints: number;
  levels?: RubricLevel[];
};

export type InstructorRubric = {
  criteria: RubricCriterion[];
};

export type SubmissionPayload = {
  notebook?: import('@/content-engine/render/assignment-contracts').AssignmentPayload['notebook'];
  text?: string;
  links?: { url: string; label?: string }[];
  code?: { language: string; code: string };
};

export type SubmissionFile = {
  assetId: string;
  name: string;
  size: number;
  mime: string;
};

export type SubmissionStatus = 'submitted' | 'in_review' | 'approved' | 'changes_requested';

export type SubmissionGrade = {
  rubricScores: Record<string, number>;
  feedback: LocalizedLabel;
  decision: 'approved' | 'changes_requested';
  released: boolean;
  passed?: boolean;
  totalPoints?: number;
  maxPoints?: number;
  gradedAt?: string;
};

export type SubmissionQueueItem = {
  id: string;
  userId: string;
  learnerName: string;
  branchId: string | null;
  courseVersionId: string;
  courseId: string;
  courseTitle: string;
  itemId: string;
  blockId?: string | null;
  itemTitle: string;
  assignmentId: string;
  attemptNo: number;
  status: SubmissionStatus;
  submittedAt: string;
  payload: SubmissionPayload;
  files: SubmissionFile[];
  rubric: InstructorRubric;
  grade?: SubmissionGrade;
};

export type AssignmentMetadata = {
  courseId: string;
  courseTitle: string;
  courseVersionId: string;
  version?: number | null;
  itemId: string;
  itemTitle: string;
  assignmentId: string;
  rubric: InstructorRubric;
};

export type ExamOption = {
  courseId: string;
  courseTitle: string;
  courseVersionId: string;
  version: number;
  itemId: string;
  itemTitle: string;
};

export type CourseOption = {
  id: string;
  title: string;
};

export type InstructorMetadata = {
  courses: CourseOption[];
  assignments: AssignmentMetadata[];
  exams: ExamOption[];
};

export type PendingManualQuestion = {
  questionId: string;
  type: string;
  content?: unknown;
  answer: unknown;
  maxPoints: number;
  points: number | null;
  feedback: unknown | null;
};

export type ExamAttempt = {
  attemptId: string;
  userId: string;
  learnerName: string;
  courseVersionId: string;
  itemId: string;
  branchId: string | null;
  attemptNo: number;
  status: string;
  late: boolean;
  startedAt: string;
  deadlineAt: string | null;
  submittedAt: string | null;
  points: number | null;
  maxPoints: number | null;
  percent: number | null;
  /** Answer-key release. Independent of result availability. */
  releasedAt: string | null;
  /** Grading complete: the score and manual feedback are the learner's. Null on historical rows. */
  resultAvailableAt?: string | null;
  integrityEventCount: number;
  pendingManualQuestions: PendingManualQuestion[];
};

export type ExamReleaseResult = {
  released: { attemptId: string; releasedAt: string }[];
  skipped: {
    forbidden: number;
    unassigned: number;
    alreadyReleased: string[];
    notReleasable: string[];
  };
};
