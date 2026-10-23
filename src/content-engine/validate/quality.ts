import { COURSE_REF, itemRef, makeDiagnostic, type Diagnostic, type DocumentRef } from '../diagnostics';
import { isAutoGradedType } from '../schema/questions';
import type { ParsedWorkspace } from './workspace';
import { contentByLocale, forEachQuestion, itemEntriesOf, l10nValues, runsOf, walkBlocks } from './walk';
import { runsToPlainText } from '../schema/inline';
import { ACTIVITY_BLOCK_TYPES } from '../schema/activities';

export const LONG_LESSON_MINUTES = 60;
export const LONG_LESSON_BLOCKS = 150;

export function checkQuality(parsed: ParsedWorkspace): Diagnostic[] {
  const out: Diagnostic[] = [];
  const { manifest, items } = parsed;
  const warn = (code: Parameters<typeof makeDiagnostic>[0], ref: DocumentRef, path: string, meta?: Record<string, string | number>) => out.push(makeDiagnostic(code, { ref, path, meta }));

  let hasOutput = manifest.modules.some((m) => m.items.some((i) => i.type === 'assignment'));
  let hasNextStep = (manifest.relatedOpportunities?.length ?? 0) > 0;
  if (!manifest.skills?.length) warn('W_COURSE_NO_SKILLS', COURSE_REF, '/skills');

  for (const [docId, doc] of Object.entries(items)) {
    const ref = itemRef(docId);
    if (doc.kind === 'lesson') {
      if (!doc.objectives?.length) warn('W_NO_OBJECTIVES', ref, '/objectives');
      let blocks = 0, activities = 0;
      walkBlocks(doc.blocks, '/blocks', ({ block, path }) => {
        blocks++;
        if ((ACTIVITY_BLOCK_TYPES as readonly string[]).includes(block.type)) activities++;
        if (block.type === 'assignment') hasOutput = true;
        if (block.type === 'next_step' || block.type === 'opportunity_link') hasNextStep = true;
        if (block.type === 'image' && l10nValues(block.alt).every((a) => a.trim() === '')) warn('W_NO_ALT_TEXT', ref, `${path}/alt`);
      });
      if ((doc.estimatedMinutes ?? 0) > LONG_LESSON_MINUTES) warn('W_LESSON_TOO_LONG', ref, '/estimatedMinutes', { received: doc.estimatedMinutes!, limit: 'minutes' });
      else if (blocks > LONG_LESSON_BLOCKS) warn('W_LESSON_TOO_LONG', ref, '/blocks', { received: blocks, limit: 'blocks' });
      if (activities === 0) warn('W_LESSON_NO_ACTIVITY', ref, '/blocks');
    }
    if (doc.kind === 'exam' && !doc.settings?.timeLimitMinutes) warn('W_EXAM_NO_TIME_LIMIT', ref, '/settings');
    for (const scope of itemEntriesOf(doc)) forEachQuestion(scope.entries, scope.path, ({ question: q, path }) => {
      if (isAutoGradedType(q.type) && !q.explanation) warn('W_NO_EXPLANATION', ref, `${path}/explanation`);
      if (isAutoGradedType(q.type) && q.points === 0) warn('W_POINTS_ZERO', ref, `${path}/points`);
      if ('options' in q) {
        const duplicated = manifest.languages.some((locale) => {
          const texts = q.options.map((o) => {
            const byLocale = contentByLocale(o.content);
            const rc = byLocale[locale] ?? byLocale['*'] ?? Object.values(byLocale)[0];
            return rc ? runsToPlainText(runsOf(rc.blocks), locale).trim().toLowerCase() : '';
          });
          return new Set(texts).size !== texts.length;
        });
        if (duplicated) warn('W_DUPLICATE_OPTION_TEXT', ref, `${path}/options`);
      }
    });
  }
  if (!hasOutput) warn('W_COURSE_NO_OUTPUT', COURSE_REF, '/modules');
  if (!hasNextStep) warn('W_COURSE_NO_NEXT_STEP', COURSE_REF, '/relatedOpportunities');
  return out;
}
