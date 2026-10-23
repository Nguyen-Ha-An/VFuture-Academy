import { redactAuditSnapshot } from '@/lib/audit';

/** Redacts payloads written by the transactional grading RPC using the shared audit boundary. */
export function submissionAuditSnapshot(value: unknown): unknown {
  return redactAuditSnapshot(value);
}
