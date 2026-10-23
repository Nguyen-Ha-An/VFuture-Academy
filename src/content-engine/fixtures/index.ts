import type { CourseWorkspace } from '../validate/workspace';
import type { DiagnosticCode } from '../diagnostics';
import minimalCourse from './minimal/course.json';
import minimalIntro from './minimal/items/intro.json';
import aiCourse from './ai-foundations/course.json';
import aiWhatIsAi from './ai-foundations/items/what-is-ai.json';
import aiMlVsRules from './ai-foundations/items/ml-vs-rules.json';
import aiExam from './ai-foundations/items/exam-m1.json';
import aiFinal from './ai-foundations/items/final-product.json';
import allCourse from './all-question-types/course.json';
import allLesson from './all-question-types/items/every-type.json';
import allExam from './all-question-types/items/exam-all.json';
import invalidDuplicateIds from './invalid/duplicate-ids.json';
import invalidMissingDoc from './invalid/missing-item-document.json';
import invalidAnswerKeys from './invalid/bad-answer-keys.json';
import invalidL10n from './invalid/l10n.json';
import invalidRefs from './invalid/unresolved-refs.json';
import invalidRenderer from './invalid/unsupported-renderer.json';
export { fixtureResolver } from './resolver';
export { AI_FOUNDATIONS_BANK_BUNDLE } from './bank';

export const FIXTURES: Record<'minimal' | 'ai-foundations' | 'all-question-types', CourseWorkspace> = {
  minimal: { manifest: minimalCourse, items: { intro: minimalIntro } },
  'ai-foundations': { manifest: aiCourse, items: { 'what-is-ai': aiWhatIsAi, 'ml-vs-rules': aiMlVsRules, 'exam-m1': aiExam, 'final-product': aiFinal } },
  'all-question-types': { manifest: allCourse, items: { 'every-type': allLesson, 'exam-all': allExam } },
};
export const fixtureNames = Object.keys(FIXTURES) as (keyof typeof FIXTURES)[];

type Invalid = { manifest: unknown; items: Record<string, unknown>; expect: DiagnosticCode[] };
const inv = (name: string, f: Invalid) => ({ name, workspace: { manifest: f.manifest, items: f.items } as CourseWorkspace, expect: f.expect });
export const INVALID_FIXTURES = [
  inv('duplicate-ids', invalidDuplicateIds as Invalid), inv('missing-item-document', invalidMissingDoc as Invalid), inv('bad-answer-keys', invalidAnswerKeys as Invalid),
  inv('l10n', invalidL10n as Invalid), inv('unresolved-refs', invalidRefs as Invalid), inv('unsupported-renderer', invalidRenderer as Invalid),
];
