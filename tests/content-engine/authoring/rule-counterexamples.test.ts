import { describe, expect, it } from 'vitest';
import { checkAuthoringProfile, PROFILE_RULES } from '@/content-engine/authoring';
import { staticProfileContext, type ProfileContext } from '@/content-engine/authoring/context';

type JsonObject = Record<string, unknown>;
type Fixture = 'lesson' | 'paragraph' | 'exam' | 'assignment' | 'essay' | 'multi' | 'short' | 'numeric' | 'upload' | 'group';
type RuleCase = {
  id: string;
  fixture: Fixture;
  path?: string;
  value?: unknown;
  remove?: boolean;
  build?: (document: JsonObject) => JsonObject;
  context?: () => ProfileContext;
};

const rich = (text: string) => ({ blocks: [{ type: 'paragraph', content: [{ text }] }] });
const single = (id = 'q-a') => ({
  id, type: 'single_choice', points: 1, content: rich('Prompt'), explanation: rich('Reason'),
  options: [{ id: 'a', content: rich('A') }, { id: 'b', content: rich('B') }], correctAnswer: 'a',
});
const quiz = () => ({ id: 'quiz-a', type: 'quiz', questions: [single()], settings: { mode: 'practice' } });
const rubric = () => ({ criteria: [{ id: 'quality', name: 'Quality', maxPoints: 5 }] });
const assignment = () => ({
  schemaVersion: 1, kind: 'assignment', id: 'assignment-a', title: 'Assignment',
  instructions: rich('Work'), submission: { accepts: ['text'] }, rubric: rubric(),
});
const exam = (question: unknown = single()) => ({
  schemaVersion: 1, kind: 'exam', id: 'exam-a', title: 'Exam',
  sections: [{ id: 'section-a', title: 'Section', questions: [question] }],
});
const lesson = (block: unknown = quiz()) => ({
  schemaVersion: 1, kind: 'lesson', id: 'lesson-a', title: 'Lesson', blocks: [block],
});
const paragraph = () => ({ id: 'paragraph-a', type: 'paragraph', content: [{ text: 'Hello' }] });
const essay = () => ({ id: 'q-essay', type: 'essay', points: 5, content: rich('Explain'), rubric: rubric() });
const multi = () => ({ ...single(), type: 'multiple_choice', correctAnswer: ['a'] });
const short = () => ({ id: 'q-short', type: 'short_answer', points: 1, content: rich('Answer'), explanation: rich('Reason'), matchMode: 'exact', correctAnswer: ['word'] });
const numeric = () => ({ id: 'q-numeric', type: 'numeric', points: 1, content: rich('Number'), explanation: rich('Reason'), correctAnswer: 2 });
const upload = () => ({ id: 'q-upload', type: 'upload_answer', points: 5, content: rich('Upload'), accepts: ['text'], rubric: rubric() });
const group = () => ({ id: 'q-group', type: 'question_group', sharedContent: rich('Passage'), questions: [single('q-child')] });

function fixture(name: Fixture): JsonObject {
  switch (name) {
    case 'lesson': return lesson();
    case 'paragraph': return lesson(paragraph());
    case 'exam': return exam();
    case 'assignment': return assignment();
    case 'essay': return exam(essay());
    case 'multi': return exam(multi());
    case 'short': return exam(short());
    case 'numeric': return exam(numeric());
    case 'upload': return exam(upload());
    case 'group': return exam(group());
  }
}

function mutate(document: JsonObject, path: string, value: unknown, remove = false): JsonObject {
  const tokens = path.slice(1).split('/').map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
  let cursor: unknown = document;
  for (const token of tokens.slice(0, -1)) {
    cursor = Array.isArray(cursor) ? cursor[Number(token)] : (cursor as JsonObject)[token];
  }
  const last = tokens.at(-1)!;
  if (Array.isArray(cursor)) {
    if (remove) cursor.splice(Number(last), 1);
    else cursor[Number(last)] = value;
  } else if (remove) delete (cursor as JsonObject)[last];
  else (cursor as JsonObject)[last] = value;
  return document;
}

const longExam = () => {
  const groups = Array.from({ length: 11 }, (_, groupIndex) => ({
    id: `group-${groupIndex}`, type: 'question_group', sharedContent: rich('Passage'),
    questions: Array.from({ length: 20 }, (_, childIndex) => ({
      id: `child-${groupIndex}-${childIndex}`, type: 'true_false', points: 1,
      content: rich('True?'), explanation: rich('Yes.'), correctAnswer: true,
    })),
  }));
  return exam(groups[0]) as JsonObject & { sections: Array<{ questions: unknown[] }> };
};

const cases: RuleCase[] = [
  { id: 'AP-POINTS-REQUIRED', fixture: 'exam', path: '/sections/0/questions/0/points', remove: true },
  { id: 'AP-ANSWER-KEY-REQUIRED', fixture: 'exam', path: '/sections/0/questions/0/correctAnswer', remove: true },
  { id: 'AP-EXPLANATION-REQUIRED', fixture: 'exam', path: '/sections/0/questions/0/explanation', remove: true },
  { id: 'AP-RUBRIC-REQUIRED', fixture: 'essay', path: '/sections/0/questions/0/rubric', remove: true },
  { id: 'AP-RUBRIC-SUM', fixture: 'essay', path: '/sections/0/questions/0/rubric/criteria/0/maxPoints', value: 4 },
  { id: 'AP-RUBRIC-LEVELS', fixture: 'essay', path: '/sections/0/questions/0/rubric/criteria/0/levels', value: [{ label: 'High', points: 6 }, { label: 'Low', points: 0 }] },
  { id: 'AP-LENGTH-BOUNDS', fixture: 'essay', build: (doc) => mutate(mutate(doc, '/sections/0/questions/0/minWords', 200), '/sections/0/questions/0/maxWords', 100) },
  { id: 'AP-SELECTION-BOUNDS', fixture: 'multi', path: '/sections/0/questions/0/minSelections', value: 2 },
  { id: 'AP-GROUP-SHAPE', fixture: 'group', path: '/sections/0/questions/0/points', value: 1 },
  { id: 'AP-QUESTION-ID-DOCUMENT-UNIQUE', fixture: 'exam', build: (doc) => mutate(doc, '/sections/1', { id: 'section-b', title: 'Another', questions: [single()] }) },
  { id: 'AP-QUESTION-LIMIT', fixture: 'exam', build: () => { const doc = longExam(); doc.sections[0].questions = Array.from({ length: 11 }, (_, i) => ({ id: `group-${i}`, type: 'question_group', sharedContent: rich('Passage'), questions: Array.from({ length: 20 }, (_, j) => ({ id: `child-${i}-${j}`, type: 'true_false', points: 1, content: rich('True?'), explanation: rich('Yes.'), correctAnswer: true })) })); return doc; } },
  { id: 'AP-NO-BANK-REF', fixture: 'exam', path: '/sections/0/questions/0', value: { $ref: 'bank:new-question' } },
  { id: 'AP-NO-POOL', fixture: 'exam', path: '/sections/0/questions/0', value: { $pool: { id: 'pool-a', count: 1, from: ['bank:q-a'] } } },
  { id: 'AP-MEDIA-REF', fixture: 'paragraph', path: '/blocks/0', value: { id: 'image-a', type: 'image', src: { assetId: 'invented-asset' }, alt: 'Image' } },
  { id: 'AP-VIDEO-EMBED-HOSTS', fixture: 'paragraph', path: '/blocks/0', value: { id: 'video-a', type: 'video', provider: 'youtube', url: 'https://vimeo.com/123' } },
  { id: 'AP-NO-DISPLAY', fixture: 'exam', path: '/sections/0/questions/0/display', value: { layout: 'list' } },
  { id: 'AP-NO-SELF-ASSESSMENT', fixture: 'exam', path: '/sections/0/questions/0/selfAssessment', value: true },
  { id: 'AP-SKILLS-TAGS-WHITELIST', fixture: 'exam', path: '/sections/0/questions/0/tags', value: ['invented'] },
  { id: 'AP-NO-CHILD-LANGUAGES', fixture: 'lesson', path: '/languages', value: ['vi'] },
  { id: 'AP-NO-$SCHEMA', fixture: 'exam', path: '/$schema', value: 'https://example.org/schema' },
  { id: 'AP-RENDERABLE-BLOCKS-ONLY', fixture: 'paragraph', path: '/blocks/0', value: { id: 'math-a', type: 'math', latex: 'x' } },
  { id: 'AP-ID-TYPED-KEYS', fixture: 'exam', path: '/sections/0/questions/0/correctAnswer', value: 'BAD_ID' },
  { id: 'AP-NONEMPTY-TEXT', fixture: 'exam', path: '/title', value: '   ' },
  { id: 'AP-L10N-SHAPE', fixture: 'exam', path: '/title', value: { vi: 'Exam' } },
  { id: 'AP-MIME-ENUM', fixture: 'upload', path: '/sections/0/questions/0/allowedMimeTypes', value: ['application/x-invented'] },
  { id: 'AP-LINK-HOSTS', fixture: 'assignment', build: (doc) => mutate(mutate(doc, '/submission/accepts', ['link']), '/submission/linkHosts', ['https://example.org']) },
  { id: 'AP-BLANKS-ONLY-IN-FILL-BLANK', fixture: 'exam', path: '/sections/0/questions/0/content/blocks/0/content/0', value: { blank: 'blank-a' } },
  { id: 'AP-NUMERIC-TOLERANCE', fixture: 'numeric', build: (doc) => mutate(mutate(doc, '/sections/0/questions/0/tolerance', 1), '/sections/0/questions/0/tolerancePercent', 5) },
  { id: 'AP-SHORT-ANSWER-MATCH', fixture: 'short', path: '/sections/0/questions/0/matchMode', value: 'regex' },
  { id: 'AP-NO-SECTION-TIMERS', fixture: 'exam', path: '/sections/0/timeLimitMinutes', value: 10 },
  { id: 'AP-EXAM-AVAILABILITY-ORDER', fixture: 'exam', path: '/settings', value: { availability: { openAt: '2026-09-28T00:00:00Z', closeAt: '2026-09-27T00:00:00Z' } } },
  { id: 'AP-QUIZ-SETTINGS', fixture: 'lesson', path: '/blocks/0/settings', remove: true },
  { id: 'AP-QUESTION-SETTINGS-APPLICABLE', fixture: 'exam', path: '/sections/0/questions/0/settings', value: { partialScoring: true } },
  { id: 'AP-SUBMISSION-CONSISTENT', fixture: 'assignment', path: '/submission/accepts', value: ['code'] },
  { id: 'AP-PASS-POINTS', fixture: 'assignment', path: '/passPoints', value: 6 },
  { id: 'AP-NO-NOTEBOOK', fixture: 'assignment', path: '/notebook', value: {} },
  { id: 'AP-DISCRIMINATED-UNIONS', fixture: 'paragraph', path: '/blocks/0/type', value: 'imaginary' },
  { id: 'AP-BLOCK-IDS', fixture: 'paragraph', path: '/blocks/0/id', remove: true },
  { id: 'AP-NESTING', fixture: 'paragraph', path: '/blocks/0', value: { id: 'reveal-a', type: 'reveal', label: 'Show', blocks: [{ id: 'reveal-b', type: 'reveal', label: 'Again', blocks: [paragraph()] }] } },
  { id: 'AP-NO-COLOR', fixture: 'paragraph', path: '/blocks/0/content/0/annotations', value: { color: '#ff0000' } },
  { id: 'AP-QUESTION-CONTENT-BLOCKS', fixture: 'exam', path: '/sections/0/questions/0/content/blocks/0', value: { type: 'heading', level: 2, content: [{ text: 'Heading' }] } },
  { id: 'AP-TARGET-IDENTITY', fixture: 'lesson', context: () => ({ ...staticProfileContext('mono'), target: { kind: 'lesson', id: 'another-lesson' } }) },
  { id: 'AP-ESTIMATED-MINUTES', fixture: 'paragraph', path: '/estimatedMinutes', value: 601 },
  { id: 'AP-LINK-TARGETS-KNOWN', fixture: 'paragraph', path: '/blocks/0', value: { id: 'resource-a', type: 'resource_link', resourceId: 'invented-resource' } },
];

describe('one counterexample per structural or semantic profile rule', () => {
  it('starts each mutation from a valid profile item', () => {
    for (const name of ['lesson', 'paragraph', 'exam', 'assignment', 'essay', 'multi', 'short', 'numeric', 'upload', 'group'] as const) {
      const result = checkAuthoringProfile(fixture(name), null, staticProfileContext('mono'));
      expect(result.ok, `${name}: ${result.errors.map((issue) => `${issue.code} ${issue.path}`).join(', ')}`).toBe(true);
    }
  });

  it('covers every Appendix B rule except the separately tested legacy passthrough', () => {
    const covered = cases.map((entry) => entry.id).sort();
    const required = PROFILE_RULES.map((rule) => rule.id).filter((id) => id !== 'AP-LEGACY-UNCHANGED').sort();
    expect(covered).toEqual(required);
  });

  it.each(cases)('$id rejects its counterexample', ({ fixture: base, path, value, remove, build, context }) => {
    const document = fixture(base);
    const candidate = build ? build(document) : path ? mutate(document, path, value, remove) : document;
    const result = checkAuthoringProfile(candidate, null, context?.() ?? staticProfileContext('mono'));
    expect(result.ok, `${result.errors.map((issue) => `${issue.code} ${issue.path}`).join(', ')}`).toBe(false);
  });
});
