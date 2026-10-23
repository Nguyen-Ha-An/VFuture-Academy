import { COURSE_REF, itemRef, makeDiagnostic, type Diagnostic } from '../../diagnostics';
import { walkBlocks, isContainer, itemEntriesOf } from '../walk';
import type { ParsedWorkspace } from '../workspace';

export const MAX_CONTAINER_DEPTH = 3;
export const MAX_EXAM_QUESTIONS = 200;

/**
 * Structure that only makes sense across documents: nesting limits, cross-item
 * targets and size caps.
 *
 * Whether the manifest and the documents agree about identity — missing documents,
 * orphans, kind and title mismatches — is not here. That question had three
 * slightly different answers (this module, the Studio service, the editor) and the
 * disagreements were the bug; it now lives only in `assessWorkspace`.
 */
export function checkStructure(parsed: ParsedWorkspace): Diagnostic[] {
  const out: Diagnostic[] = [];
  const { manifest, items } = parsed;
  const referenced = new Set<string>();
  const itemTypes = new Map<string, string>();
  const inlineAssignmentIds = new Set<string>();
  const quizIdsByLesson = new Map<string, Set<string>>();

  manifest.modules.forEach((mod) => mod.items.forEach((item) => {
    referenced.add(item.id);
    itemTypes.set(item.id, item.type);
  }));

  for (const [docId, doc] of Object.entries(items)) {
    const ref = itemRef(docId);
    if (doc.kind === 'lesson') {
      const quizIds = new Set<string>();
      walkBlocks(doc.blocks, '/blocks', ({ block, path, depth }) => {
        if (isContainer(block.type) && depth >= MAX_CONTAINER_DEPTH) out.push(makeDiagnostic('E_NESTING_TOO_DEEP', { ref, path, meta: { limit: MAX_CONTAINER_DEPTH } }));
        if (block.type === 'quiz') quizIds.add(block.id);
        if (block.type === 'assignment' && itemTypes.get(docId) === 'lesson') inlineAssignmentIds.add(block.id);
        if (block.type === 'next_step' && (block.target.kind === 'lesson' || block.target.kind === 'exam') && !referenced.has(block.target.id)) out.push(makeDiagnostic('E_NEXT_STEP_TARGET_UNKNOWN', { ref, path: `${path}/target/id`, meta: { id: block.target.id } }));
      });
      quizIdsByLesson.set(docId, quizIds);
    }
    if (doc.kind === 'exam') {
      let n = 0;
      for (const s of itemEntriesOf(doc)) { n += s.entries.filter((e) => !(typeof e === 'object' && e && '$pool' in e)).length; s.entries.forEach((e) => { if (typeof e === 'object' && e && '$pool' in e) n += (e as { $pool: { count: number } }).$pool.count; }); }
      if (n > MAX_EXAM_QUESTIONS) out.push(makeDiagnostic('E_LIMIT_EXCEEDED', { ref, path: '/sections', meta: { limit: 'exam questions', received: n, expected: MAX_EXAM_QUESTIONS } }));
    }
  }

  (manifest.completion?.rules ?? []).forEach((rule, i) => {
    const path = `/completion/rules/${i}`;
    const need = (id: string, type: string, key: string) => { if (itemTypes.get(id) !== type) out.push(makeDiagnostic('E_COMPLETION_TARGET_UNKNOWN', { ref: COURSE_REF, path: `${path}/${key}`, meta: { id } })); };
    if (rule.type === 'exam_passed') need(rule.examId, 'exam', 'examId');
    if (rule.type === 'assignment_approved'
      && itemTypes.get(rule.assignmentId) !== 'assignment'
      && !inlineAssignmentIds.has(rule.assignmentId)) {
      out.push(makeDiagnostic('E_COMPLETION_TARGET_UNKNOWN', {
        ref: COURSE_REF,
        path: `${path}/assignmentId`,
        meta: { id: rule.assignmentId },
      }));
    }
    if (rule.type === 'lessons_completed' && rule.lessonIds !== 'all') rule.lessonIds.forEach((id) => need(id, 'lesson', 'lessonIds'));
    if (rule.type === 'quiz_min_score') { need(rule.lessonId, 'lesson', 'lessonId'); if (itemTypes.get(rule.lessonId) === 'lesson' && !quizIdsByLesson.get(rule.lessonId)?.has(rule.quizId)) out.push(makeDiagnostic('E_COMPLETION_TARGET_UNKNOWN', { ref: COURSE_REF, path: `${path}/quizId`, meta: { id: rule.quizId } })); }
  });
  (manifest.prerequisites ?? []).forEach((p, i) => { if (p.courseId === manifest.id) out.push(makeDiagnostic('E_PREREQ_SELF', { ref: COURSE_REF, path: `/prerequisites/${i}/courseId` })); });
  return out;
}
