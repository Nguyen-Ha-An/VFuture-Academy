import { COURSE_REF, itemRef, makeDiagnostic, refKey, type Diagnostic, type DocumentRef } from '../../diagnostics';
import type { Question } from '../../schema/questions';
import type { ParsedWorkspace } from '../workspace';
import { forEachQuestion, itemEntriesOf, walkBlocks } from '../walk';

function dupes(ref: DocumentRef, list: { id: string; path: string }[], out: Diagnostic[]) {
  const seen = new Set<string>();
  for (const { id, path } of list) { if (seen.has(id)) out.push(makeDiagnostic('E_DUPLICATE_ID', { ref, path: `${path}/id`, meta: { id } })); seen.add(id); }
}

function questionInnerIds(q: Question, path: string): { id: string; path: string }[][] {
  const groups: { id: string; path: string }[][] = [];
  const list = (arr: { id: string }[] | undefined, key: string) => arr && groups.push(arr.map((x, i) => ({ id: x.id, path: `${path}/${key}/${i}` })));
  if ('options' in q) list(q.options, 'options');
  if (q.type === 'fill_blank') { list(q.blanks, 'blanks'); list(q.wordBank, 'wordBank'); }
  if (q.type === 'matching') { list(q.left, 'left'); list(q.right, 'right'); } // separate namespaces: "1"/"2" may repeat across columns
  if (q.type === 'ordering') { list(q.items, 'items'); list(q.slots, 'slots'); }
  if (q.type === 'classification') { list(q.categories, 'categories'); list(q.items, 'items'); }
  if (q.type === 'question_group') list(q.questions, 'questions');
  if ('rubric' in q && q.rubric) list(q.rubric.criteria, 'rubric/criteria');
  return groups;
}

export function checkIds(parsed: ParsedWorkspace): Diagnostic[] {
  const out: Diagnostic[] = [];
  const { manifest, items } = parsed;
  const itemTypes = new Map(manifest.modules.flatMap((module) => module.items.map((item) => [item.id, item.type] as const)));
  const assignmentPresentations = new Map<string, { ref: DocumentRef; path: string }>();
  manifest.modules.forEach((module, moduleIndex) => module.items.forEach((item, itemIndex) => {
    if (item.type === 'assignment') {
      assignmentPresentations.set(item.id, { ref: COURSE_REF, path: `/modules/${moduleIndex}/items/${itemIndex}` });
    }
  }));
  const registerAssignmentPresentation = (ref: DocumentRef, id: string, path: string) => {
    const previous = assignmentPresentations.get(id);
    if (previous && refKey(previous.ref) !== refKey(ref)) {
      out.push(makeDiagnostic('E_DUPLICATE_ID', { ref, path: `${path}/id`, meta: { id } }));
      assignmentPresentations.set(id, { ref, path });
      return;
    }
    if (!previous) assignmentPresentations.set(id, { ref, path });
  };
  dupes(COURSE_REF, manifest.modules.map((m, i) => ({ id: m.id, path: `/modules/${i}` })), out);
  dupes(COURSE_REF, manifest.modules.flatMap((m, i) => m.items.map((it, j) => ({ id: it.id, path: `/modules/${i}/items/${j}` }))), out);
  if (manifest.skills) dupes(COURSE_REF, manifest.skills.map((s, i) => ({ id: s.id, path: `/skills/${i}` })), out);
  for (const [docId, doc] of Object.entries(items)) {
    const ref = itemRef(docId);
    if (doc.kind === 'lesson') {
      const blockIds: { id: string; path: string }[] = [];
      walkBlocks(doc.blocks, '/blocks', ({ block, path }) => {
        if ('id' in block && block.id) blockIds.push({ id: block.id, path });
        if (block.type === 'assignment' && itemTypes.get(docId) === 'lesson') {
          registerAssignmentPresentation(ref, block.id, path);
        }
        if ('items' in block && Array.isArray(block.items) && block.type !== 'list') dupes(ref, (block.items as { id: string }[]).map((x, i) => ({ id: x.id, path: `${path}/items/${i}` })), out);
        if (block.type === 'stepper') dupes(ref, block.steps.map((x, i) => ({ id: x.id, path: `${path}/steps/${i}` })), out);
        if (block.type === 'flashcards') dupes(ref, block.cards.map((x, i) => ({ id: x.id, path: `${path}/cards/${i}` })), out);
        if (block.type === 'assignment' && block.rubric) dupes(ref, block.rubric.criteria.map((x, i) => ({ id: x.id, path: `${path}/rubric/criteria/${i}` })), out);
      });
      dupes(ref, blockIds, out);
    }
    if (doc.kind === 'exam') dupes(ref, doc.sections.map((s, i) => ({ id: s.id, path: `/sections/${i}` })), out);
    if (doc.kind === 'assignment' && doc.rubric) dupes(ref, doc.rubric.criteria.map((x, i) => ({ id: x.id, path: `/rubric/criteria/${i}` })), out);
    for (const scope of itemEntriesOf(doc)) {
      const qids: { id: string; path: string }[] = [];
      forEachQuestion(scope.entries, scope.path, ({ question, path, parentPath }) => {
        if (!parentPath) qids.push({ id: question.id, path });
        for (const group of questionInnerIds(question, path)) dupes(ref, group, out);
      });
      dupes(ref, qids, out);
    }
  }
  return out;
}
