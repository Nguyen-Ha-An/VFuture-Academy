import { compileCourse } from '../../../src/content-engine/compile';
import { FIXTURES, fixtureResolver } from '../../../src/content-engine/fixtures';

/** Seed generation only. The running Next app imports its normal production services. */
export async function compileRoutingSeed() {
  const original = structuredClone(FIXTURES['all-question-types']);
  const lesson = original.items['every-type'] as { blocks: Array<{ type: string; questions?: unknown[] }> };
  const quiz = lesson.blocks.find(block => block.type === 'quiz' && Array.isArray(block.questions));
  if (!quiz?.questions?.length) throw new Error('Missing canonical all-question-types quiz');
  const id = 'academy-route-fixture';
  const exam = {
    schemaVersion: 1, kind: 'exam', id: 'exam-routing', title: { en: 'Routing fixture exam', vi: 'Bài kiểm tra định tuyến' },
    settings: { timeLimitMinutes: 30, attemptsAllowed: 5, scoringPolicy: 'latest', passPercent: 50,
      review: { showScore: 'immediately', showCorrectAnswers: 'never', showExplanations: 'never' },
      navigation: 'free', layout: 'single_page' },
    sections: [{ id: 'main', title: 'All question types', questions: quiz.questions }],
  };
  const workspace = { manifest: { ...original.manifest as object, id,
    title: { en: 'Routing fixture course', vi: 'Khóa học định tuyến' },
    languages: ['en', 'vi'], defaultLanguage: 'en', access: { scope: 'global' },
    modules: [{ id: 'main-module', title: 'Real local routing', items: [{ id: exam.id, type: 'exam' }] }],
  }, items: { [exam.id]: exam } };
  const result = await compileCourse(workspace, fixtureResolver, { locales: ['en', 'vi'] });
  if (!result.ok || !result.compiled) throw new Error('Canonical routing course did not compile');
  const item = result.compiled.items[exam.id];
  if (!item) throw new Error('Missing compiled routing exam');
  const rendered = item.renders.en as unknown as { sections: Array<{ questions: Array<{ id: string; type: string; questions?: Array<{ id: string; type: string }> }> }> };
  const questions = rendered.sections[0]?.questions ?? [];
  const group = questions.find(question => question.type === 'question_group');
  if (!group?.questions?.length) throw new Error('Missing compiled grouped questions');
  return { workspace, compiled: result.compiled, itemId: exam.id,
    questionTypes: questions.map(question => question.type),
    answers: {
      'main/q-match': [{ left: 'l-pdf', right: 'r-doc' }, { left: 'l-audio', right: 'r-sound' }],
      'main/q-essay': 'Evidence và lập luận. '.repeat(60),
      'main/q-upload': { links: [{ url: 'https://www.canva.com/design/local-routing-fixture' }] },
      [group.id]: Object.fromEntries(group.questions.map(question => [question.id, question.type === 'single_choice' ? 'three' : 'stepper'])),
    }, groupId: group.id };
}

/** Separate opt-in observed-shape fixture. Baseline compilation above stays one item. */
export async function compileDenseDashboardSeed() {
  const courseId = 'academy-dense-route-fixture';
  const items: Record<string, unknown> = {};
  const references: Array<{ id: string; type: 'lesson' | 'assignment' | 'exam' }> = [];
  const text = (value: string) => ({ blocks: [{ type: 'paragraph', content: [{ text: value }] }] });
  for (let index = 1; index <= 39; index++) {
    const id = `dense-lesson-${String(index).padStart(2, '0')}`;
    items[id] = { schemaVersion: 1, kind: 'lesson', id, title: { en: `Synthetic lesson ${index}`, vi: `Bài học tổng hợp ${index}` }, estimatedMinutes: 10, completion: { mode: 'view' }, blocks: text('Synthetic lesson content; no embedded assessment.').blocks };
    references.push({ id, type: 'lesson' });
  }
  for (let index = 1; index <= 8; index++) {
    const id = `dense-assignment-${String(index).padStart(2, '0')}`;
    items[id] = { schemaVersion: 1, kind: 'assignment', id, title: { en: `Synthetic assignment ${index}`, vi: `Bài tập tổng hợp ${index}` }, instructions: text('Write a short synthetic response.'), submission: { accepts: ['text'] } };
    references.push({ id, type: 'assignment' });
  }
  for (let index = 1; index <= 2; index++) {
    const id = `dense-exam-${index}`;
    items[id] = { schemaVersion: 1, kind: 'exam', id, title: { en: `Synthetic exam ${index}`, vi: `Bài kiểm tra tổng hợp ${index}` }, settings: { attemptsAllowed: 3, timeLimitMinutes: 20, scoringPolicy: 'latest', passPercent: 50, navigation: 'free', layout: 'single_page', review: { showScore: 'immediately', showCorrectAnswers: 'never', showExplanations: 'never' } }, sections: [{ id: 'main', title: 'Synthetic section', questions: [{ id: 'question-one', type: 'single_choice', points: 1, content: text('Choose the first synthetic option.'), options: [{ id: 'first', content: text('First') }, { id: 'second', content: text('Second') }], correctAnswer: 'first' }] }] };
    references.push({ id, type: 'exam' });
  }
  const workspace = { manifest: { schemaVersion: 1, kind: 'course', id: courseId, title: { en: 'Synthetic dense dashboard course', vi: 'Khóa học tổng hợp cho bảng học tập' }, summary: { en: 'Entirely synthetic routing fixture.', vi: 'Dữ liệu tổng hợp dành cho kiểm tra định tuyến.' }, languages: ['en', 'vi'], defaultLanguage: 'en', level: 'foundation', difficulty: 'beginner', pathway: 'core-future-skills', learningOutcomes: ['Review synthetic learning content.'], access: { scope: 'global' }, skills: [], completion: { rules: [{ type: 'all_items' }], certificate: false }, modules: [{ id: 'dense-module', title: { en: 'Synthetic learning', vi: 'Nội dung học tổng hợp' }, items: references }] }, items };
  const result = await compileCourse(workspace, fixtureResolver, { locales: ['en', 'vi'] });
  if (!result.ok || !result.compiled) throw new Error('Synthetic dense course did not compile');
  const compiledItems = Object.values(result.compiled.items);
  if (compiledItems.length !== 49 || compiledItems.filter(item => item.kind === 'lesson').length !== 39 || compiledItems.filter(item => item.kind === 'assignment').length !== 8 || compiledItems.filter(item => item.kind === 'exam').length !== 2 || compiledItems.some(item => item.kind === 'lesson' && item.grading.activities.length !== 0)) throw new Error('Dense fixture shape differs from39lessons/8assignments/2exams');
  return { workspace, compiled: result.compiled };
}

/** Valid same-course V2 for explicit history proof; never mutates compiled grading. */
export async function compileRoutingUpgradeSeed() {
  const baseline = await compileRoutingSeed();
  const replacement = { schemaVersion: 1, kind: 'lesson', id: 'routing-v2-introduction', title: { en: 'Routing version two introduction', vi: 'Giới thiệu phiên bản định tuyến thứ hai' }, completion: { mode: 'view' }, blocks: [{ type: 'paragraph', content: [{ text: 'Entirely synthetic replacement content for a local enrollment upgrade.' }] }] };
  const workspace = { manifest: { ...baseline.workspace.manifest, modules: [{ id: 'version-two-module', title: { en: 'Synthetic version two', vi: 'Phiên bản tổng hợp thứ hai' }, items: [{ id: replacement.id, type: 'lesson' }] }] }, items: { [replacement.id]: replacement } };
  const result = await compileCourse(workspace, fixtureResolver, { locales: ['en', 'vi'] });
  if (!result.ok || !result.compiled || result.compiled.courseId !== baseline.compiled.courseId || Object.hasOwn(result.compiled.items, baseline.itemId) || Object.keys(result.compiled.items).length !== 1 || result.compiled.items[replacement.id]?.kind !== 'lesson') throw new Error('Invalid compiler-derived routing version two');
  return { workspace, compiled: result.compiled, removedItemId: baseline.itemId, replacementItemId: replacement.id };
}
