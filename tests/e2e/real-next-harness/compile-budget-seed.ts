import { compileCourse } from '../../../src/content-engine/compile';
import { fixtureResolver } from '../../../src/content-engine/fixtures';
import { MAX_EXAM_QUESTIONS } from '../../../src/content-engine/validate/semantic/structure';

/** Opt-in compiler input only; the actual application keeps its normal services and renderers. */
export async function compileBudgetSeed() {
  if (MAX_EXAM_QUESTIONS !== 200) throw new Error('Budget fixture requires the published 200-root cap');
  const courseId = 'academy-budget-route-fixture';
  const itemId = 'budget-exam';
  const rich = (text: string) => ({ blocks: [{ type: 'paragraph', content: [{ text }] }] });
  const essay = (id: string, label: string) => ({
    id, type: 'essay', points: 1, selfAssessment: true,
    content: rich(label), minWords: 1, maxWords: 10_000,
  });
  const questions = Array.from({ length: 199 }, (_, index) => essay(
    `response-${String(index + 1).padStart(3, '0')}`, `Budget response ${index + 1}`,
  ));
  const group = {
    id: 'budget-group', type: 'question_group', sharedContent: rich('Budget question group'),
    questions: [essay('child-one', 'Budget group child one'), essay('child-two', 'Budget group child two')],
  };
  const exam = {
    schemaVersion: 1, kind: 'exam', id: itemId,
    title: { en: 'Synthetic answer transport budget exam', vi: 'Bài kiểm tra tổng hợp về dung lượng câu trả lời' },
    settings: { timeLimitMinutes: 120, attemptsAllowed: 3, scoringPolicy: 'latest', passPercent: 50,
      navigation: 'free', layout: 'single_page',
      review: { showScore: 'immediately', showCorrectAnswers: 'never', showExplanations: 'never' } },
    sections: [{ id: 'main', title: { en: 'Synthetic responses', vi: 'Câu trả lời tổng hợp' }, questions: [...questions, group] }],
  };
  const workspace = {
    manifest: { schemaVersion: 1, kind: 'course', id: courseId,
      title: { en: 'Synthetic answer transport budget course', vi: 'Khóa học tổng hợp về dung lượng câu trả lời' },
      summary: { en: 'Disposable local measurement only.', vi: 'Chỉ dùng đo lường trong môi trường cục bộ.' },
      languages: ['en', 'vi'], defaultLanguage: 'en', level: 'foundation', difficulty: 'beginner',
      pathway: 'core-future-skills', learningOutcomes: ['Write synthetic bounded responses.'],
      access: { scope: 'global' }, skills: [], completion: { rules: [{ type: 'all_items' }], certificate: false },
      modules: [{ id: 'budget-module', title: { en: 'Synthetic assessment', vi: 'Đánh giá tổng hợp' }, items: [{ id: itemId, type: 'exam' }] }] },
    items: { [itemId]: exam },
  };
  const result = await compileCourse(workspace, fixtureResolver, { locales: ['en', 'vi'] });
  if (!result.ok || !result.compiled) throw new Error('Budget course did not pass the real compiler');
  const compiledItem = result.compiled.items[itemId];
  if (!compiledItem || compiledItem.kind !== 'exam') throw new Error('Compiled budget exam missing');
  const rendered = compiledItem.renders.en as unknown as {
    sections: Array<{ questions: Array<{ id: string; type: string; questions?: Array<{ id: string; type: string }> }> }>;
  };
  const roots = rendered.sections.flatMap(section => section.questions);
  const last = roots[199];
  if (roots.length !== 200 || roots.slice(0, 199).some(question => question.type !== 'essay')
    || last?.type !== 'question_group' || last.questions?.length !== 2
    || last.questions.some(question => question.type !== 'essay')) throw new Error('Compiled budget shape changed');
  return { workspace, compiled: result.compiled, itemId,
    simpleQuestionIds: roots.slice(0, 199).map(question => question.id),
    groupQuestionId: last.id, groupChildQuestionIds: last.questions.map(question => question.id),
    shape: { topLevelQuestions: 200, simpleEssays: 199, groupedEssays: 2, timeLimitMinutes: 120, attemptsAllowed: 3 } };
}
