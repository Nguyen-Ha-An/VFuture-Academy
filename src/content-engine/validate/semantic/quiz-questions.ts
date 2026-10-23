import { itemRef, makeDiagnostic, type Diagnostic, type DocumentRef } from '../../diagnostics';
import { bankIdOf, isManualType, isQuestionRef } from '../../schema/questions';
import { itemEntriesOf } from '../walk';
import type { ItemDocument, ParsedWorkspace } from '../workspace';
import { resolveOrReport, type ReferenceResolver } from './refs';

/**
 * A quiz has no manual-grading workflow: nothing ever scores an essay, an upload or a
 * code answer that sits in one, and every learner who reaches it is refused at submit.
 * `selfAssessment: true` is the supported way to put a reflection in a quiz — it is
 * unscored by design and grading returns `self_assessed`, never `pending_manual`.
 *
 * Exams and assignments are unaffected: they own the manual-grading workflow.
 */
interface ManualLeaf {
  /** Pointer to the offending question, relative to the entry it was found under. */
  path: string;
  type: string;
  id?: string;
}

function collectManualLeaves(value: unknown, path: string, out: ManualLeaf[]): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const question = value as { type?: unknown; questions?: unknown; selfAssessment?: unknown; id?: unknown };
  if (typeof question.type !== 'string') return;
  if (question.type === 'question_group') {
    if (Array.isArray(question.questions)) {
      question.questions.forEach((child, index) => collectManualLeaves(child, `${path}/questions/${index}`, out));
    }
    return;
  }
  if (!isManualType(question.type) || question.selfAssessment === true) return;
  out.push({ path, type: question.type, ...(typeof question.id === 'string' ? { id: question.id } : {}) });
}

export interface QuizQuestionCheckOptions {
  /**
   * Whether this pass owns reporting for a quiz `$ref` it could not resolve. The
   * workspace pipeline runs `checkReferences`, which already reports every unresolved
   * or unavailable reference, so it leaves this off; a standalone document has no
   * other reference pass, so it turns it on. Either way an unresolved reference is a
   * blocking error and is never read as "no manual question here".
   */
  reportUnresolvedRefs?: boolean;
}

/** Quiz question-type rule for one item document, inline entries and resolved bank refs. */
export async function checkQuizQuestions(
  doc: ItemDocument,
  ref: DocumentRef,
  resolver: ReferenceResolver,
  opts: QuizQuestionCheckOptions = {},
): Promise<Diagnostic[]> {
  const out: Diagnostic[] = [];
  for (const scope of itemEntriesOf(doc)) {
    if (scope.kind !== 'quiz') continue;
    for (const [index, entry] of scope.entries.entries()) {
      const path = `${scope.path}/${index}`;
      if (!isQuestionRef(entry)) {
        const leaves: ManualLeaf[] = [];
        collectManualLeaves(entry, path, leaves);
        for (const leaf of leaves) out.push(makeDiagnostic('E_QUIZ_MANUAL_QUESTION', { ref, path: `${leaf.path}/type`, meta: { type: leaf.type } }));
        continue;
      }
      const id = bankIdOf(entry);
      const snapshot = await resolveOrReport(out, { ref, path: `${path}/$ref` }, () => resolver.bankQuestion(id));
      // A lookup that failed is already an error above; a reference that resolved to
      // nothing is one here or in checkReferences. Neither is silently accepted.
      if (!snapshot.known) continue;
      if (!snapshot.value) {
        if (opts.reportUnresolvedRefs) out.push(makeDiagnostic('E_REF_UNRESOLVED', { ref, path: `${path}/$ref`, meta: { id } }));
        continue;
      }
      const leaves: ManualLeaf[] = [];
      collectManualLeaves(snapshot.value.question, '', leaves);
      // The offending question lives in the bank, so the pointer the author can act on
      // is the reference itself; the bank id and the inner question id ride in `meta`.
      for (const leaf of leaves) {
        out.push(makeDiagnostic('E_QUIZ_MANUAL_QUESTION', { ref, path: `${path}/$ref`, meta: { type: leaf.type, id, question: leaf.id ?? id } }));
      }
    }
  }
  return out;
}

/** The same rule across a whole course workspace. */
export async function checkWorkspaceQuizQuestions(parsed: ParsedWorkspace, resolver: ReferenceResolver): Promise<Diagnostic[]> {
  const out: Diagnostic[] = [];
  for (const [docId, doc] of Object.entries(parsed.items)) out.push(...await checkQuizQuestions(doc, itemRef(docId), resolver));
  return out;
}
