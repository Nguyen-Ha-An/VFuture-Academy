import { compileCourse } from '../../../src/content-engine/compile';
import { FIXTURES, fixtureResolver } from '../../../src/content-engine/fixtures';

export type QuizUploadLocator = {
  courseId: string;
  itemId: string;
  quizId: string;
  rootQuestionId: string;
  questionId: string;
};
export type QuizPracticeLocator = {
  courseId: string;
  itemId: string;
  quizId: string;
  questionIds: { matching: string; multipleChoice: string; numeric: string; trueFalse: string; group: string; groupChild: string };
};

/** Compile a synthetic course containing the real all-question-types quiz. */
export async function compileQuizUploadSeed() {
  const original = structuredClone(FIXTURES['all-question-types']);
  const source = original.items['every-type'] as { blocks: Array<{ id?: string; type: string; questions?: unknown[] }> };
  const quiz = source.blocks.find(block => block.type === 'quiz' && block.id === 'all-q');
  if (!quiz?.questions?.length) throw new Error('Missing canonical quiz fixture');
  const courseId = 'academy-quiz-upload-fixture';
  const itemId = 'every-type';
  // Both quizzes retain every canonical question. Distinct quiz IDs give the
  // compiler separate, real question namespaces for graded and practice paths.
  const practiceQuiz = { ...structuredClone(quiz), id: 'practice-q', title: 'Practice: one of every question type',
    settings: { mode: 'practice', feedback: 'per_question', showExplanations: true, attemptsAllowed: 0, passPercent: 0, required: true, shuffleQuestions: false } };
  // Other lesson blocks contain unrelated remote assets outside this fixture.
  const lesson = { ...source, blocks: [quiz, practiceQuiz] };
  const workspace = {
    manifest: { ...original.manifest as object, id: courseId,
      title: { en: 'Synthetic quiz upload course', vi: 'Khóa học tải tệp trắc nghiệm' },
      languages: ['en', 'vi'], defaultLanguage: 'en', access: { scope: 'global' },
      modules: [{ id: 'quiz-module', title: 'Synthetic quiz', items: [{ id: itemId, type: 'lesson' }] }],
    },
    items: { [itemId]: lesson },
  };
  const result = await compileCourse(workspace, fixtureResolver, { locales: ['en', 'vi'] });
  if (!result.ok || !result.compiled) throw new Error('Canonical quiz upload course did not compile');
  const item = result.compiled.items[itemId];
  type RenderedQuestion = { id?: string; type?: string; selfAssessment?: boolean; accepts?: string[]; questions?: RenderedQuestion[] };
  const rendered = item?.renders.en as unknown as { blocks?: Array<{ id?: string; type?: string; questions?: RenderedQuestion[] }> } | undefined;
  const compiledQuiz = rendered?.blocks?.find(block => block.id === 'all-q' && block.type === 'quiz');
  const upload = compiledQuiz?.questions?.find(question => question.type === 'upload_answer' && question.selfAssessment === true && question.accepts?.includes('file'));
  if (!upload?.id || !item || item.kind !== 'lesson') throw new Error('Compiled quiz lacks the self-assessed file-upload question');
  const locator: QuizUploadLocator = { courseId, itemId, quizId: 'all-q', rootQuestionId: upload.id, questionId: upload.id };
  const practice = rendered?.blocks?.find(block => block.id === 'practice-q' && block.type === 'quiz');
  const findId = (type: string): string => {
    const id = practice?.questions?.find(question => question.type === type)?.id;
    if (!id) throw new Error(`Compiled practice quiz lacks ${type}`);
    return id;
  };
  const group = practice?.questions?.find(question => question.type === 'question_group');
  const groupChild = group?.questions?.find(question => question.type === 'single_choice')?.id;
  if (!group?.id || !groupChild) throw new Error('Compiled practice quiz lacks grouped child');
  const practiceLocator: QuizPracticeLocator = { courseId, itemId, quizId: 'practice-q', questionIds: {
    matching: findId('matching'), multipleChoice: findId('multiple_choice'), numeric: findId('numeric'),
    trueFalse: findId('true_false'), group: group.id, groupChild,
  } };
  return { workspace, compiled: result.compiled, locator, practiceLocator };
}
