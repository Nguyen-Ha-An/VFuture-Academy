// Every lesson block inside the real activity frame, so the dark and light axe runs in student.spec.ts
// check colour contrast on engine output: a stepper advanced one step, tabs, each callout variant,
// code, a table, an accordion (one item open), a reveal (opened), flashcards and a submitted quiz
// with a correct and an incorrect answer revealed.
import Link from 'next/link';
import { BlockList } from '@/content-engine/render/BlockList';
import type { LessonRuntime } from '@/content-engine/render/runtime';
import type { LessonBlock } from '@/content-engine/schema/types';
import { FocusOutline } from '@/features/learner/ui/FocusOutline';
import { ActivityFrame } from '@/features/workspace-ui/learner/activity/ActivityFrame';
import { ActivityFooter } from '@/features/workspace-ui/learner/activity/ActivityFooter';

type Locale = 'vi' | 'en';
const text = (value: string) => [{ text: value }];
const rich = (value: string) => ({ blocks: [{ type: 'paragraph', content: text(value) }] });
const paragraph = (value: string) => ({ type: 'paragraph', content: text(value) });

const blocks = [
  paragraph('This fixture lesson renders every content block so contrast is checked in both themes.'),
  { type: 'heading', level: 2, content: text('Worked steps') },
  { id: 'fx-stepper', type: 'stepper', steps: [
    { id: 's1', title: 'Frame the question', blocks: [paragraph('Start from the decision the data should inform.')] },
    { id: 's2', title: 'Collect evidence', blocks: [paragraph('Gather the smallest dataset that can answer it.')] },
    { id: 's3', title: 'Decide', blocks: [paragraph('State the decision and what would change it.')] },
  ] },
  { id: 'fx-tabs', type: 'tabs', items: [
    { id: 't1', title: 'Python', blocks: [paragraph('Python keeps the analysis readable.')] },
    { id: 't2', title: 'Spreadsheet', blocks: [paragraph('A spreadsheet is enough for a first pass.')] },
  ] },
  ...(['info', 'tip', 'warning', 'danger', 'note'] as const).map((variant) => ({ type: 'callout', variant, title: `${variant[0].toUpperCase()}${variant.slice(1)} callout`, blocks: [paragraph(`A ${variant} callout keeps its text readable in both themes.`)] })),
  { type: 'code', language: 'python', filename: 'clean.py', code: 'import pandas as pd\n\nframe = pd.read_csv("survey.csv")\nprint(frame.describe())\n' },
  { type: 'table', caption: 'Survey sample', headers: [{ content: text('Region') }, { content: text('Responses'), align: 'right' }], rows: [
    [{ content: text('North') }, { content: text('128'), align: 'right' }],
    [{ content: text('Central') }, { content: text('96'), align: 'right' }],
    [{ content: text('South') }, { content: text('143'), align: 'right' }],
  ] },
  { id: 'fx-accordion', type: 'accordion', items: [
    { id: 'a1', title: 'Why sample first?', blocks: [paragraph('A sample shows the shape of the data before the full run.')] },
    { id: 'a2', title: 'When to stop?', blocks: [paragraph('Stop when another row would not change the decision.')] },
  ] },
  { id: 'fx-reveal', type: 'reveal', label: 'Show the answer', blocks: [paragraph('The median resists outliers better than the mean.')] },
  { id: 'fx-cards', type: 'flashcards', cards: [
    { id: 'c1', front: rich('Median'), back: rich('The middle value of a sorted list.') },
    { id: 'c2', front: rich('Mode'), back: rich('The most frequent value.') },
  ] },
  { id: 'fx-quiz', type: 'quiz', title: 'Check your understanding', settings: { mode: 'practice', feedback: 'after_submit' }, questions: [
    { id: 'fx-q1', type: 'single_choice', content: rich('Which value resists outliers?'), points: 1, options: [{ id: 'median', content: rich('Median') }, { id: 'mean', content: rich('Mean') }] },
    { id: 'fx-q2', type: 'single_choice', content: rich('Which value is the most frequent?'), points: 1, options: [{ id: 'mode', content: rich('Mode') }, { id: 'range', content: rich('Range') }] },
  ] },
] as unknown as LessonBlock[];

const unavailable = async (): Promise<never> => { throw new Error('Not part of fixture'); };

function lessonRuntime(locale: Locale): LessonRuntime {
  const state = new Map<string, unknown>([
    ['fx-stepper', { step: 1, maxReached: 1 }],
    ['fx-accordion', { open: ['a1'] }],
    ['fx-reveal', { opened: true }],
    ['fx-quiz', {
      answers: { 'fx-q1': 'median', 'fx-q2': 'range' },
      submissions: 1,
      checks: {},
      completed: true,
      last: {
        attemptId: 'fixture', points: 1, maxPoints: 2, percent: 50, attemptsRemaining: null,
        results: [
          { questionId: 'fx-q1', status: 'correct', points: 1, maxPoints: 1 },
          { questionId: 'fx-q2', status: 'incorrect', points: 0, maxPoints: 1 },
        ],
        revealed: { correctAnswers: { 'fx-q1': 'median', 'fx-q2': 'mode' }, explanations: { 'fx-q2': rich('The mode is the most frequent value.') } },
      },
    }],
  ]);
  return {
    mode: 'learner', locale,
    getBlockState: <T,>(id: string) => state.get(id) as T | undefined,
    setBlockState: (id, value) => { state.set(id, value); },
    checkQuestion: unavailable, submitQuiz: unavailable, getAssignmentSession: () => undefined, refreshAssignmentSession: unavailable,
    submitAssignment: unavailable, uploadAssignmentFile: unavailable, uploadFile: unavailable, resolveMedia: () => '', hrefFor: () => '/app',
    markViewed() {}, onActivityComplete() {},
  } as LessonRuntime;
}

const modules = [{ id: 'm1', title: 'Start here', items: [
  { id: 'lesson-1', title: 'First lesson', status: 'completed' },
  { id: 'lesson-blocks', title: 'Every lesson block', status: 'in_progress' },
  { id: 'lesson-2', title: 'A longer next lesson title to check wrapping', status: 'not_started' },
] }];

export function LessonBlocksPage({ locale }: { locale: Locale }) {
  const progress = { completed: 1, total: 3 };
  return <ActivityFrame
    kind="lesson"
    course={{ title: 'AI basics', href: '/app/courses/ai-basics' }}
    progress={progress}
    position={{ current: 2, total: 3 }}
    outline={<FocusOutline courseId="ai-basics" itemId="lesson-blocks" modules={modules} courseTitle="AI basics" progress={progress} />}
    head={{ kicker: <><span>Lesson</span><span aria-hidden="true"> · </span><span>Start here</span></>, title: 'Every lesson block', meta: ['M01 · 02 / 03', '12 min'], status: 'in_progress' }}
    pager={{ label: 'Previous and next', previous: { href: '/app/courses/ai-basics/items/lesson-1', title: 'First lesson', kicker: 'Previous · Lesson' }, next: { href: '/app/courses/ai-basics/items/lesson-2', title: 'A longer next lesson title to check wrapping', kicker: 'Next · Lesson' } }}
  >
    <div lang={locale} className="learner-reader-prose grid gap-6">
      <BlockList blocks={blocks} runtime={lessonRuntime(locale)} path="/blocks" depth={0} />
    </div>
    <ActivityFooter status={{ tone: 'signal', label: 'Completed' }} action={<Link className="vf-btn vf-btn-primary vf-btn-lg" href="/app/courses/ai-basics/items/lesson-2">Next: A longer next lesson title →</Link>} />
  </ActivityFrame>;
}
