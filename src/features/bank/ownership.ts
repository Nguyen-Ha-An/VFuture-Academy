import { ID_PATTERN } from '@/content-engine/schema/common';
import type { Scope } from '@/lib/authorization';

export function contentOwnerScope(row: Record<string, unknown> | null): Scope | null {
  if (row?.ownership_kind === 'central' && row.owner_branch_id === null) return { kind: 'central' };
  if (row?.ownership_kind === 'branch' && typeof row.owner_branch_id === 'string' && ID_PATTERN.test(row.owner_branch_id)) {
    return { kind: 'branch', branchId: row.owner_branch_id };
  }
  return null;
}

export function canUseBankQuestion(courseOwner: Scope | null, question: Record<string, unknown> | null): boolean {
  const owner = contentOwnerScope(question);
  if (!courseOwner || !owner) return false;
  return owner.kind === 'central' || (courseOwner.kind === 'branch' && owner.branchId === courseOwner.branchId);
}
