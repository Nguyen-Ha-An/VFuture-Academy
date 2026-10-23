import { getDomain } from 'tldts';

export interface AssignmentPayload {
  text?: string;
  links?: { url: string; label?: string }[];
  files?: { assetId: string; name: string; size: number; mime: string }[];
  code?: { language: string; code: string };
  notebook?: NotebookSubmissionPayload;
}

export type NotebookSubmissionPayload = {
  assetId: string;
  checksum: string;
  format: 'ipynb';
  templateChecksum: string;
  runtimeProfileId?: string;
  runtimeProfileVersion?: string;
};

export interface UploadedFile { assetId: string; name: string; size: number; mime: string }
export interface UploadProgress { loaded: number; total: number; percent: number }

export type AssignmentLocator = Readonly<{
  courseId: string;
  itemId: string;
  blockId: string | null;
}>;

export type AssignmentTarget = Readonly<{ blockId: string | null }>;

export function assignmentId(locator: Pick<AssignmentLocator, 'itemId' | 'blockId'>): string {
  return locator.blockId ?? locator.itemId;
}

function timestampParts(value: string): { second: number; fraction: number } | null {
  const match = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  if (!match) return null;
  const zone = match[3] === 'Z'
    ? 'Z'
    : match[3].length === 3
      ? `${match[3]}:00`
      : match[3].includes(':') ? match[3] : `${match[3].slice(0, 3)}:${match[3].slice(3)}`;
  const epochMilliseconds = Date.parse(`${match[1].replace(' ', 'T')}${zone}`);
  if (!Number.isFinite(epochMilliseconds)) return null;
  return {
    second: epochMilliseconds / 1000,
    fraction: Number((match[2] ?? '').padEnd(9, '0')),
  };
}

/** Compares PostgreSQL timestamp strings without truncating fractional seconds. */
export function compareAssignmentTimestamps(left: string, right: string): -1 | 0 | 1 | null {
  const leftParts = timestampParts(left);
  const rightParts = timestampParts(right);
  if (!leftParts || !rightParts) return null;
  if (leftParts.second !== rightParts.second) return leftParts.second < rightParts.second ? -1 : 1;
  if (leftParts.fraction === rightParts.fraction) return 0;
  return leftParts.fraction < rightParts.fraction ? -1 : 1;
}

export type LearnerSubmissionStatus = 'submitted' | 'in_review' | 'approved' | 'changes_requested';

export type LearnerSubmissionFile = {
  assetId: string;
  name: string;
  size: number;
  mime: string;
};

export type LearnerReleasedGrade = {
  released: true;
  decision: 'approved' | 'changes_requested';
  rubricScores: Record<string, number>;
  totalPoints: number;
  maxPoints: number;
  passed: boolean;
  feedback: string | { vi?: string; en?: string };
  gradedAt: string;
};

export type LearnerAssignmentSubmission = {
  submissionId: string;
  attemptNo: number;
  status: LearnerSubmissionStatus;
  submittedAt: string;
  payload: AssignmentPayload;
  files: LearnerSubmissionFile[];
  grade?: LearnerReleasedGrade;
};

export type AssignmentAction =
  | { allowed: true; kind: 'initial' | 'revision'; expectedLatestSubmissionId: string | null; nextAttemptNo: number }
  | { allowed: false; reason: 'approved' | 'awaiting_review' | 'policy' | 'attempt_limit' };

export type AssignmentSessionResult = {
  locator: AssignmentLocator;
  courseVersionId: string;
  attemptsUsed: number;
  submissions: LearnerAssignmentSubmission[];
  action: AssignmentAction;
};

export type AssignmentSubmitResult = {
  created: boolean;
  session: AssignmentSessionResult;
};

/** Matches the published assignment link-host contract in browser and service code. */
export function allowedSubmissionUrl(url: string, hosts?: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (hosts === undefined) return true;
  if (!hosts.length) return false;
  const hostname = parsed.hostname.toLowerCase();
  return hosts.some((allowed) => {
    const normalized = allowed.toLowerCase();
    if (normalized.startsWith('*.')) {
      const suffix = normalized.slice(2);
      return hostname !== suffix && hostname.endsWith(`.${suffix}`);
    }
    if (hostname === normalized) return true;
    const registrable = getDomain(normalized, { allowPrivateDomains: true });
    return registrable === normalized && hostname.endsWith(`.${normalized}`);
  });
}
