import { itemRef, makeDiagnostic, toRef, type Diagnostic, type DocumentRef } from '../../diagnostics';
import { isAutoGradedType, isManualType, type Question } from '../../schema/questions';
import { resolvePlayer } from '../../manifest/players';
import { inspectSafeRegexPatterns } from '../../grading/safe-regex';
import { blankIdsOf, contentByLocale, forEachQuestion, itemEntriesOf, l10nValues, runsOf } from '../walk';
import { isBlankRun } from '../../schema/inline';
import type { ParsedWorkspace } from '../workspace';
import type { L10nRichContent } from '../../schema/types';

const setEq = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

function blankRunsAnywhere(q: Question): boolean {
  const contents: (L10nRichContent | undefined)[] = [q.content, q.explanation, q.hint];
  if ('options' in q) q.options.forEach((o) => contents.push(o.content, o.feedback));
  if (q.type === 'matching') [...q.left, ...q.right].forEach((i) => contents.push(i.content));
  if (q.type === 'ordering' || q.type === 'classification') q.items.forEach((i) => contents.push(i.content));
  if (q.type === 'question_group') contents.push(q.sharedContent);
  return contents.some((c) => Object.values(contentByLocale(c)).some((rc) => runsOf(rc.blocks).some(isBlankRun)));
}

export function checkQuestion(q: Question, path: string, doc: string | DocumentRef): Diagnostic[] {
  const ref = toRef(doc);
  const out: Diagnostic[] = [];
  const err = (code: Parameters<typeof makeDiagnostic>[0], sub: string, meta?: Record<string, string | number>) => out.push(makeDiagnostic(code, { ref, path: `${path}${sub}`, meta }));
  const key: unknown = (q as { correctAnswer?: unknown }).correctAnswer;

  if (q.display?.interactionType) { const r = resolvePlayer(q.type, q.display.interactionType); if (!r.ok) err('E_PLAYER_UNKNOWN', '/display/interactionType', { type: q.type, received: q.display.interactionType, valid: r.valid.join(', ') }); }
  if (q.type !== 'fill_blank' && blankRunsAnywhere(q)) err('E_BLANK_OUTSIDE_FILL_BLANK', '/content');
  if (isManualType(q.type) && key !== undefined) err('W_IGNORED_ANSWER_KEY', '/correctAnswer', { type: q.type });
  if (isAutoGradedType(q.type) && key === undefined && !q.selfAssessment) { err('E_AUTO_TYPE_MISSING_KEY', '/correctAnswer', { type: q.type }); return out; }
  if (key === undefined) { if (q.type === 'question_group') q.questions.forEach((c, i) => out.push(...checkQuestion(c, `${path}/questions/${i}`, ref))); return out; }

  switch (q.type) {
    case 'single_choice': if (!q.options.some((o) => o.id === key)) err('E_ANSWER_REF_UNKNOWN', '/correctAnswer', { id: String(key) }); break;
    case 'multiple_choice': {
      const ids = new Set(q.options.map((o) => o.id)); const k = key as string[];
      if (new Set(k).size !== k.length) err('E_ANSWER_SHAPE', '/correctAnswer', { detail: 'duplicate option ids in key' });
      k.forEach((id, i) => { if (!ids.has(id)) err('E_ANSWER_REF_UNKNOWN', `/correctAnswer/${i}`, { id }); });
      if (q.maxSelections !== undefined && q.maxSelections < k.length) err('E_ANSWER_SHAPE', '/maxSelections', { detail: `maxSelections (${q.maxSelections}) < correct answers (${k.length})` });
      if (q.minSelections !== undefined && q.maxSelections !== undefined && q.minSelections > q.maxSelections) err('E_ANSWER_SHAPE', '/minSelections', { detail: 'minSelections > maxSelections' });
      break;
    }
    case 'fill_blank': {
      const declared = new Set(q.blanks.map((b) => b.id));
      const perLocale = blankIdsOf(q.content); const locales = Object.keys(perLocale);
      const used = perLocale[locales[0]] ?? new Set<string>();
      if (locales.some((l) => !setEq(perLocale[l], used))) err('E_ANSWER_SHAPE', '/content', { detail: 'blank ids differ between locales' });
      for (const id of used) if (!declared.has(id)) err('E_BLANK_UNDECLARED', '/content', { id });
      for (const id of declared) if (!used.has(id)) err('E_BLANK_UNUSED', '/blanks', { id });
      const k = key as Record<string, string | string[]>;
      for (const id of Object.keys(k)) if (!declared.has(id)) err('E_ANSWER_REF_UNKNOWN', `/correctAnswer/${id}`, { id });
      for (const id of declared) if (!(id in k)) err('E_ANSWER_SHAPE', '/correctAnswer', { detail: `missing answer for blank "${id}"` });
      const mode = q.display?.interactionType ?? 'text';
      if (mode === 'word_bank') {
        if (!q.wordBank) err('E_ANSWER_SHAPE', '/wordBank', { detail: 'word_bank interaction requires wordBank' });
        else { const words = new Set(q.wordBank.map((w) => w.id)); for (const [b, v] of Object.entries(k)) for (const w of ([] as string[]).concat(v)) if (!words.has(w)) err('E_ANSWER_REF_UNKNOWN', `/correctAnswer/${b}`, { id: w }); }
      }
      if (mode === 'dropdown') for (const b of q.blanks) {
        if (!b.options) { err('E_ANSWER_SHAPE', '/blanks', { detail: `blank "${b.id}" needs options for dropdown` }); continue; }
        const allowed = new Set(b.options.flatMap(l10nValues));
        for (const v of ([] as string[]).concat(k[b.id] ?? [])) if (!allowed.has(v)) err('E_ANSWER_REF_UNKNOWN', `/correctAnswer/${b.id}`, { id: v });
      }
      break;
    }
    case 'short_answer': if (q.matchMode === 'regex') for (const r of inspectSafeRegexPatterns(key as string[], { caseSensitive: q.settings?.caseSensitive === true })) err('E_ANSWER_SHAPE', r.index < 0 ? '/correctAnswer' : `/correctAnswer/${r.index}`, { detail: `unsupported regex: ${r.detail}`, reason: r.reason }); break;
    case 'numeric': if (q.tolerance !== undefined && q.tolerancePercent !== undefined) err('E_ANSWER_SHAPE', '/tolerance', { detail: 'use tolerance or tolerancePercent, not both' }); break;
    case 'matching': {
      const L = new Set(q.left.map((x) => x.id)), R = new Set(q.right.map((x) => x.id)); const edges = key as { left: string; right: string }[];
      edges.forEach((e, i) => { if (!L.has(e.left)) err('E_ANSWER_REF_UNKNOWN', `/correctAnswer/${i}/left`, { id: e.left }); if (!R.has(e.right)) err('E_ANSWER_REF_UNKNOWN', `/correctAnswer/${i}/right`, { id: e.right }); });
      const matchedLeft = new Set(edges.map((e) => e.left));
      for (const id of L) if (!matchedLeft.has(id)) err('E_ANSWER_SHAPE', '/correctAnswer', { detail: `left item "${id}" has no match` });
      if (!q.allowManyToOne) { const rights = edges.map((e) => e.right); if (new Set(rights).size !== rights.length) err('E_ANSWER_SHAPE', '/correctAnswer', { detail: 'a right item is used twice; set allowManyToOne' }); }
      break;
    }
    case 'ordering': {
      const ids = new Set(q.items.map((x) => x.id)); const k = key as string[];
      if (k.length !== ids.size || new Set(k).size !== k.length || k.some((id) => !ids.has(id))) err('E_ORDERING_NOT_PERMUTATION', '/correctAnswer');
      if (q.display?.interactionType === 'timeline' && (!q.slots || q.slots.length !== q.items.length)) err('E_ANSWER_SHAPE', '/slots', { detail: 'timeline needs one slot per item' });
      break;
    }
    case 'classification': {
      const ids = new Set(q.items.map((x) => x.id)), cats = new Set(q.categories.map((c) => c.id)); const k = key as Record<string, string>;
      for (const [item, cat] of Object.entries(k)) { if (!ids.has(item)) err('E_ANSWER_REF_UNKNOWN', `/correctAnswer/${item}`, { id: item }); else if (!cats.has(cat)) err('E_ANSWER_REF_UNKNOWN', `/correctAnswer/${item}`, { id: cat }); }
      for (const id of ids) if (!(id in k)) err('E_ANSWER_SHAPE', '/correctAnswer', { detail: `item "${id}" has no category` });
      break;
    }
    default: break;
  }
  return out;
}

export function checkAnswers(parsed: ParsedWorkspace): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const [docId, doc] of Object.entries(parsed.items)) for (const scope of itemEntriesOf(doc)) forEachQuestion(scope.entries, scope.path, ({ question, path, parentPath }) => { if (!parentPath) out.push(...checkQuestion(question, path, itemRef(docId))); });
  return out;
}
