import type { ProfileContext } from './context';

/** A profile diagnostic. Paths are RFC 6901 pointers into the submitted document. */
export interface AuthoringIssue {
  code: string;
  path: string;
  severity: 'error' | 'warning';
  message: string;
  meta?: Record<string, string | number>;
  /** Which unchanged base construct may be grandfathered by the legacy pass. */
  legacyMode?: 'none' | 'node' | 'value';
}

type JsonObject = Record<string, unknown>;

const QUESTION_TYPES = new Set([
  'single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer',
  'numeric', 'matching', 'ordering', 'classification', 'essay', 'upload_answer',
  'code_answer', 'question_group',
]);
const MANUAL_TYPES = new Set(['essay', 'upload_answer', 'code_answer']);

/** Settings actually read by the corresponding graders. */
const QUESTION_SETTINGS: Record<string, ReadonlySet<string>> = {
  single_choice: new Set(['shuffleOptions']),
  multiple_choice: new Set(['shuffleOptions', 'partialScoring']),
  true_false: new Set(),
  fill_blank: new Set(['caseSensitive', 'ignoreAccents', 'partialScoring']),
  short_answer: new Set(['caseSensitive', 'ignoreAccents']),
  numeric: new Set(['decimalComma']),
  matching: new Set(['partialScoring']),
  ordering: new Set(['partialScoring']),
  classification: new Set(['partialScoring']),
  essay: new Set(),
  upload_answer: new Set(),
  code_answer: new Set(),
  question_group: new Set(),
};

function objectOf(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function arrayOf(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pointer(path: string, token: string | number): string {
  return `${path}/${String(token).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function emit(
  issues: AuthoringIssue[], code: string, path: string, message: string,
  legacyMode: AuthoringIssue['legacyMode'] = 'none',
  meta?: AuthoringIssue['meta'],
): void {
  issues.push({ code, path, severity: 'error', message, ...(meta ? { meta } : {}), legacyMode });
}

function rubricTotal(rubric: unknown): number | null {
  const criteria = arrayOf(objectOf(rubric)?.criteria);
  if (!criteria?.length) return null;
  let sum = 0;
  for (const value of criteria) {
    const points = numberOf(objectOf(value)?.maxPoints);
    if (points === null) return null;
    sum += points;
  }
  return sum;
}

function checkRubricLevels(issues: AuthoringIssue[], rubric: unknown, rubricPath: string): void {
  const criteria = arrayOf(objectOf(rubric)?.criteria);
  if (!criteria) return;
  criteria.forEach((rawCriterion, criterionIndex) => {
    const criterion = objectOf(rawCriterion);
    const maxPoints = numberOf(criterion?.maxPoints);
    const levels = arrayOf(criterion?.levels);
    if (!levels) return;
    const seen = new Set<number>();
    levels.forEach((rawLevel, levelIndex) => {
      const points = numberOf(objectOf(rawLevel)?.points);
      if (points === null) return;
      const path = pointer(pointer(pointer(pointer(rubricPath, 'criteria'), criterionIndex), 'levels'), levelIndex);
      if (maxPoints !== null && (points < 0 || points > maxPoints)) {
        emit(issues, 'E_PROFILE_RUBRIC_LEVEL_RANGE', pointer(path, 'points'),
          'Rubric level points must be between zero and the criterion maximum.', 'node',
          { points, maxPoints });
      }
      if (seen.has(points)) {
        emit(issues, 'E_PROFILE_RUBRIC_LEVEL_RANGE', pointer(path, 'points'),
          'Rubric level points must be unique within a criterion.', 'node',
          { detail: 'duplicate level points' });
      }
      seen.add(points);
    });
  });
}

function checkBounds(
  issues: AuthoringIssue[], owner: JsonObject, ownerPath: string,
  minKey: 'minWords' | 'minChars', maxKey: 'maxWords' | 'maxChars',
): void {
  const min = numberOf(owner[minKey]);
  const max = numberOf(owner[maxKey]);
  if (min !== null && max !== null && min > max) {
    emit(issues, 'E_PROFILE_LENGTH_BOUNDS', pointer(ownerPath, minKey),
      `${minKey} must not exceed ${maxKey}.`, 'node',
      { minField: minKey, maxField: maxKey, min, max });
  }
}

function checkSelections(issues: AuthoringIssue[], question: JsonObject, questionPath: string): void {
  const options = arrayOf(question.options);
  const answer = arrayOf(question.correctAnswer);
  if (!options || !answer) return;
  const min = question.minSelections === undefined ? 1 : numberOf(question.minSelections);
  const max = question.maxSelections === undefined ? options.length : numberOf(question.maxSelections);
  if (min === null || max === null) return;
  const keyCount = answer.length;
  if (min > keyCount || min > max) {
    emit(issues, 'E_PROFILE_SELECTION_BOUNDS', pointer(questionPath, 'minSelections'),
      'Minimum selections must not exceed the answer count or maximum selections.',
      'node', { minSelections: min, keyCount, maxSelections: max });
  }
  if (keyCount > max || max > options.length) {
    emit(issues, 'E_PROFILE_SELECTION_BOUNDS', pointer(questionPath, 'maxSelections'),
      'Maximum selections must include the answer count and fit the options.',
      'node', { keyCount, maxSelections: max, optionCount: options.length });
  }
}

function checkQuestionSettings(issues: AuthoringIssue[], question: JsonObject, questionPath: string): void {
  const type = question.type;
  const settings = objectOf(question.settings);
  if (typeof type !== 'string' || !settings) return;
  const allowed = QUESTION_SETTINGS[type];
  if (!allowed) return;
  for (const key of Object.keys(settings)) {
    if (!allowed.has(key)) {
      emit(issues, 'E_PROFILE_SCHEMA', pointer(pointer(questionPath, 'settings'), key),
        'This setting does not apply to the question type.', 'value',
        { detail: 'question setting is not applicable' });
    }
  }
}

function checkQuestion(issues: AuthoringIssue[], question: JsonObject, path: string): void {
  const type = question.type;
  if (typeof type !== 'string' || !QUESTION_TYPES.has(type)) return;
  checkQuestionSettings(issues, question, path);
  if (MANUAL_TYPES.has(type)) {
    const rubricPath = pointer(path, 'rubric');
    checkRubricLevels(issues, question.rubric, rubricPath);
    const sum = rubricTotal(question.rubric);
    const points = numberOf(question.points);
    if (sum !== null && points !== null && Math.abs(sum - points) > 1e-6) {
      emit(issues, 'E_PROFILE_RUBRIC_POINTS_MISMATCH', rubricPath,
        'Rubric criterion points must sum to the question points.', 'node', { sum, points });
    }
  }
  if (type === 'essay') checkBounds(issues, question, path, 'minWords', 'maxWords');
  if (type === 'multiple_choice') checkSelections(issues, question, path);
}

function leafCount(entries: unknown[]): number {
  return entries.reduce<number>((count, entry) => {
    const value = objectOf(entry);
    if (!value) return count;
    if (value.type === 'question_group') return count + (arrayOf(value.questions)?.length ?? 0);
    const pool = objectOf(value.$pool);
    const poolCount = numberOf(pool?.count);
    if (poolCount !== null) return count + poolCount;
    return count + 1;
  }, 0);
}

function visitQuestionEntries(
  issues: AuthoringIssue[], entries: unknown, basePath: string,
  seenIds: Map<string, string>,
): number {
  const list = arrayOf(entries);
  if (!list) return 0;
  list.forEach((entry, index) => {
    const question = objectOf(entry);
    if (!question || typeof question.type !== 'string' || !QUESTION_TYPES.has(question.type)) return;
    const path = pointer(basePath, index);
    const visitOne = (q: JsonObject, qPath: string) => {
      const id = q.id;
      if (typeof id === 'string') {
        const previous = seenIds.get(id);
        if (previous !== undefined) {
          emit(issues, 'E_PROFILE_DUPLICATE_QUESTION_ID', pointer(qPath, 'id'),
            'Question ids must be unique across this document.', 'none', { id, firstPath: previous });
        } else seenIds.set(id, pointer(qPath, 'id'));
      }
      checkQuestion(issues, q, qPath);
    };
    visitOne(question, path);
    if (question.type === 'question_group') {
      arrayOf(question.questions)?.forEach((child, childIndex) => {
        const q = objectOf(child);
        if (q) visitOne(q, pointer(pointer(path, 'questions'), childIndex));
      });
    }
  });
  return leafCount(list);
}

/** Traverse lesson blocks, including the allowed container forms. */
function visitLessonBlocks(
  blocks: unknown, basePath: string,
  visit: (block: JsonObject, path: string) => void,
): void {
  arrayOf(blocks)?.forEach((rawBlock, index) => {
    const block = objectOf(rawBlock);
    if (!block) return;
    const path = pointer(basePath, index);
    visit(block, path);
    if (block.type === 'reveal' || block.type === 'callout') {
      visitLessonBlocks(block.blocks, pointer(path, 'blocks'), visit);
    } else if (block.type === 'accordion' || block.type === 'tabs' || block.type === 'stepper') {
      const key = block.type === 'stepper' ? 'steps' : 'items';
      arrayOf(block[key])?.forEach((entry, entryIndex) => {
        visitLessonBlocks(objectOf(entry)?.blocks,
          pointer(pointer(pointer(path, key), entryIndex), 'blocks'), visit);
      });
    }
  });
}

function checkSubmission(issues: AuthoringIssue[], owner: JsonObject, ownerPath: string): void {
  const submission = objectOf(owner.submission);
  if (!submission) return;
  const path = pointer(ownerPath, 'submission');
  const accepts = arrayOf(submission.accepts);
  if (!accepts) return;
  const has = (kind: string) => accepts.includes(kind);
  if (has('code') !== (submission.codeLanguage !== undefined)) {
    emit(issues, 'E_PROFILE_SUBMISSION_INCONSISTENT', pointer(path, 'codeLanguage'),
      'codeLanguage is required exactly when code submissions are accepted.', 'node');
  }
  if (!has('file')) {
    for (const key of ['maxFiles', 'maxFileSizeMB', 'allowedMimeTypes']) {
      if (submission[key] !== undefined) {
        emit(issues, 'E_PROFILE_SUBMISSION_INCONSISTENT', pointer(path, key),
          'File settings require file submissions.', 'node');
      }
    }
  }
  if (!has('link') && submission.linkHosts !== undefined) {
    emit(issues, 'E_PROFILE_SUBMISSION_INCONSISTENT', pointer(path, 'linkHosts'),
      'linkHosts requires link submissions.', 'node');
  }
}

function checkAssignment(issues: AuthoringIssue[], assignment: JsonObject, path: string): void {
  checkRubricLevels(issues, assignment.rubric, pointer(path, 'rubric'));
  checkSubmission(issues, assignment, path);
  const passPoints = numberOf(assignment.passPoints);
  const total = rubricTotal(assignment.rubric);
  if (passPoints !== null && total !== null && passPoints > total) {
    emit(issues, 'E_PROFILE_PASS_POINTS_RANGE', pointer(path, 'passPoints'),
      'passPoints must not exceed the rubric total.', 'node', { passPoints, rubricTotal: total });
  }
}

const UNIQUE_ARRAY_FIELDS = new Set(['skills', 'tags', 'accepts', 'allowedMimeTypes', 'linkHosts']);

function checkUniqueArrays(issues: AuthoringIssue[], value: unknown, path = ''): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => checkUniqueArrays(issues, child, pointer(path, index)));
    return;
  }
  const object = objectOf(value);
  if (!object) return;
  for (const [key, child] of Object.entries(object)) {
    const childPath = pointer(path, key);
    if (UNIQUE_ARRAY_FIELDS.has(key) && Array.isArray(child)) {
      const seen = new Set<string>();
      child.forEach((entry, index) => {
        if (typeof entry !== 'string') return;
        if (seen.has(entry)) {
          const legacyMode: AuthoringIssue['legacyMode'] = key === 'allowedMimeTypes' ? 'none'
            : key === 'accepts' ? 'node' : 'value';
          emit(issues, 'E_PROFILE_SCHEMA', pointer(childPath, index),
            'Array values must be unique.', legacyMode,
            { detail: `duplicate ${key} value` });
        }
        seen.add(entry);
      });
    }
    checkUniqueArrays(issues, child, childPath);
  }
}

function knownUrlsFrom(context: ProfileContext): ReadonlySet<string> | null {
  const urls: unknown = (context as { knownUrls?: unknown }).knownUrls;
  if (urls instanceof Set) return urls as Set<string>;
  if (Array.isArray(urls)) return new Set(urls.filter((value): value is string => typeof value === 'string'));
  return null;
}

function checkNewUrls(issues: AuthoringIssue[], value: unknown, knownUrls: ReadonlySet<string>, path = ''): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => checkNewUrls(issues, child, knownUrls, pointer(path, index)));
    return;
  }
  const object = objectOf(value);
  if (!object) return;
  for (const [key, child] of Object.entries(object)) {
    const childPath = pointer(path, key);
    if ((key === 'url' || key === 'href') && typeof child === 'string'
      && child.startsWith('https://') && !knownUrls.has(child)) {
      issues.push({ code: 'W_PROFILE_NEW_EXTERNAL_URL', path: childPath, severity: 'warning',
        message: 'This external URL was not present in the course draft.', legacyMode: 'none' });
    }
    if (key !== '$schema') checkNewUrls(issues, child, knownUrls, childPath);
  }
}

/** Rules that require the complete item or compare fields within a construct. */
export function checkAuthoringSemantics(document: unknown, context: ProfileContext): AuthoringIssue[] {
  const issues: AuthoringIssue[] = [];
  const doc = objectOf(document);
  if (!doc) return issues;
  const seenIds = new Map<string, string>();

  if (doc.kind === 'lesson') {
    visitLessonBlocks(doc.blocks, '/blocks', (block, path) => {
      if (block.type === 'quiz') {
        const questionsPath = pointer(path, 'questions');
        const count = visitQuestionEntries(issues, block.questions, questionsPath, seenIds);
        if (count > 50) {
          emit(issues, 'E_PROFILE_QUESTION_LIMIT', questionsPath,
            'A lesson quiz may contain at most 50 leaf questions.', 'none',
            { received: count, expected: 50, scope: 'quiz' });
        }
      } else if (block.type === 'reflection') {
        checkBounds(issues, block, path, 'minChars', 'maxChars');
      } else if (block.type === 'assignment') {
        checkAssignment(issues, block, path);
      }
    });
  } else if (doc.kind === 'exam') {
    let total = 0;
    arrayOf(doc.sections)?.forEach((rawSection, index) => {
      const section = objectOf(rawSection);
      if (section) total += visitQuestionEntries(issues, section.questions,
        pointer(pointer('/sections', index), 'questions'), seenIds);
    });
    if (total > 200) {
      emit(issues, 'E_PROFILE_QUESTION_LIMIT', '/sections',
        'An exam may contain at most 200 leaf questions.', 'none',
        { received: total, expected: 200, scope: 'exam' });
    }
  } else if (doc.kind === 'assignment') {
    checkAssignment(issues, doc, '');
  } else if (doc.kind === 'question_bundle') {
    visitQuestionEntries(issues, doc.questions, '/questions', seenIds);
  }

  checkUniqueArrays(issues, doc);
  const knownUrls = knownUrlsFrom(context);
  if (knownUrls) checkNewUrls(issues, doc, knownUrls);
  return issues;
}
