import { isDeepStrictEqual } from 'node:util';

import type {
  ExamAnswerRecord,
  ExamAttemptRecord,
  ExamEventRecord,
  ExamGradeRecord,
  ExamRepo,
} from './types';
import { ExamError } from './types';

const clone = <T>(value: T): T => structuredClone(value);
const answerKey = (answer: Pick<ExamAnswerRecord, 'attemptId' | 'questionId'>) => `${answer.attemptId}:${answer.questionId}`;
const gradeKey = (grade: Pick<ExamGradeRecord, 'userId' | 'courseVersionId' | 'itemId'>) => `${grade.userId}:${grade.courseVersionId}:${grade.itemId}`;
const answerSnapshot = (answers: readonly ExamAnswerRecord[]) => Object.fromEntries(
  [...answers]
    .sort((left, right) => left.questionId.localeCompare(right.questionId))
    .map(({ questionId, answer }) => [questionId, answer]),
);
/**
 * Completion compares manual points as well as answers: a grading draft saved
 * between the caller's read and the write changes only `manualPoints`, and it must
 * still abort the completion rather than publish a stale total.
 */
const gradingSnapshotOf = (answers: readonly ExamAnswerRecord[]) => Object.fromEntries(
  [...answers]
    .sort((left, right) => left.questionId.localeCompare(right.questionId))
    .map(({ questionId, answer, manualPoints }) => [questionId, { answer, manualPoints }]),
);

export interface InMemoryExamRepoSeed {
  attempts?: readonly ExamAttemptRecord[];
  answers?: readonly ExamAnswerRecord[];
  grades?: readonly ExamGradeRecord[];
  events?: readonly ExamEventRecord[];
}

export class InMemoryExamRepo implements ExamRepo {
  private readonly attempts = new Map<string, ExamAttemptRecord>();
  private readonly answers = new Map<string, ExamAnswerRecord>();
  private readonly grades = new Map<string, ExamGradeRecord>();
  private readonly storedEvents: ExamEventRecord[] = [];

  constructor(seed: InMemoryExamRepoSeed = {}) {
    for (const attempt of seed.attempts ?? []) this.attempts.set(attempt.id, clone(attempt));
    for (const answer of seed.answers ?? []) this.answers.set(answerKey(answer), clone(answer));
    for (const grade of seed.grades ?? []) this.grades.set(gradeKey(grade), clone(grade));
    this.storedEvents.push(...clone(seed.events ?? []));
  }

  async getAttempt(id: string) {
    const attempt = this.attempts.get(id);
    return attempt ? clone(attempt) : null;
  }

  async listAttempts(userId: string | null, itemId: string, courseVersionId?: string) {
    return [...this.attempts.values()]
      .filter((attempt) =>
        (userId === null || attempt.userId === userId)
        && attempt.itemId === itemId
        && (courseVersionId === undefined || attempt.courseVersionId === courseVersionId))
      .sort((a, b) => a.attemptNo - b.attemptNo)
      .map(clone);
  }

  async insertAttempt(attempt: ExamAttemptRecord, attemptsAllowed: number) {
    const matching = [...this.attempts.values()]
      .filter((candidate) => candidate.userId === attempt.userId
        && candidate.courseVersionId === attempt.courseVersionId
        && candidate.itemId === attempt.itemId);
    const active = matching.find((candidate) => candidate.status === 'in_progress');
    if (active) return clone(active);
    if (matching.length >= attemptsAllowed) {
      throw new ExamError('NO_ATTEMPTS', 'No exam attempts remain.');
    }
    if (this.attempts.has(attempt.id)) throw new Error(`attempt already exists: ${attempt.id}`);
    const admitted = { ...attempt, attemptNo: matching.length + 1 };
    this.attempts.set(attempt.id, clone(admitted));
    return clone(admitted);
  }

  async updateAttempt(id: string, patch: Partial<ExamAttemptRecord>) {
    const existing = this.attempts.get(id);
    if (!existing) throw new Error(`unknown attempt: ${id}`);
    const updated = { ...existing, ...clone(patch), id };
    this.attempts.set(id, updated);
    return clone(updated);
  }

  async saveActiveAnswers(attemptId: string, userId: string, answers: readonly ExamAnswerRecord[]) {
    const attempt = this.attempts.get(attemptId);
    if (!attempt || attempt.userId !== userId || attempt.status !== 'in_progress') return false;
    for (const answer of answers) this.answers.set(answerKey(answer), clone(answer));
    return true;
  }

  async finalizeAttempt(
    id: string,
    patch: Partial<ExamAttemptRecord>,
    expectedAnswers: readonly ExamAnswerRecord[],
    resultAnswers: readonly ExamAnswerRecord[],
  ) {
    const existing = this.attempts.get(id);
    if (!existing) throw new Error(`unknown attempt: ${id}`);
    if (existing.status !== 'in_progress') {
      return { attempt: clone(existing), answersChanged: false, transitioned: false };
    }
    const currentAnswers = [...this.answers.values()]
      .filter((answer) => answer.attemptId === id)
      .map(clone);
    if (!isDeepStrictEqual(answerSnapshot(currentAnswers), answerSnapshot(expectedAnswers))) {
      return { attempt: clone(existing), answersChanged: true, transitioned: false };
    }
    for (const answer of resultAnswers) this.answers.set(answerKey(answer), clone(answer));
    const updated = { ...existing, ...clone(patch), id };
    this.attempts.set(id, updated);
    return { attempt: clone(updated), answersChanged: false, transitioned: true };
  }

  async saveManualDraft(attemptId: string, answer: ExamAnswerRecord) {
    const attempt = this.attempts.get(attemptId);
    if (!attempt || attempt.status !== 'pending_manual') return false;
    this.answers.set(answerKey(answer), clone(answer));
    return true;
  }

  async completeManualGrading(
    id: string,
    patch: Pick<ExamAttemptRecord, 'points' | 'maxPoints' | 'percent' | 'resultAvailableAt'>,
    expectedAnswers: readonly ExamAnswerRecord[],
    resultAnswers: readonly ExamAnswerRecord[],
  ) {
    const existing = this.attempts.get(id);
    if (!existing) throw new Error(`unknown attempt: ${id}`);
    if (existing.status !== 'pending_manual') {
      return { attempt: clone(existing), answersChanged: false, transitioned: false };
    }
    const currentAnswers = [...this.answers.values()]
      .filter((answer) => answer.attemptId === id)
      .map(clone);
    if (!isDeepStrictEqual(gradingSnapshotOf(currentAnswers), gradingSnapshotOf(expectedAnswers))) {
      return { attempt: clone(existing), answersChanged: true, transitioned: false };
    }
    for (const answer of resultAnswers) this.answers.set(answerKey(answer), clone(answer));
    const updated: ExamAttemptRecord = {
      ...existing,
      status: 'graded',
      points: patch.points,
      maxPoints: patch.maxPoints,
      percent: patch.percent,
      resultAvailableAt: existing.resultAvailableAt ?? clone(patch.resultAvailableAt),
    };
    this.attempts.set(id, updated);
    return { attempt: clone(updated), answersChanged: false, transitioned: true };
  }

  async releaseAttempt(id: string, releasedAt: Date) {
    const existing = this.attempts.get(id);
    if (!existing) throw new Error(`unknown attempt: ${id}`);
    if (existing.status !== 'graded' || existing.releasedAt !== null) {
      return { attempt: clone(existing), transitioned: false };
    }
    const updated = { ...existing, releasedAt: new Date(releasedAt) };
    this.attempts.set(id, updated);
    return { attempt: clone(updated), transitioned: true };
  }

  async upsertAnswers(answers: readonly ExamAnswerRecord[]) {
    for (const answer of answers) this.answers.set(answerKey(answer), clone(answer));
  }

  async listAnswers(attemptId: string) {
    return [...this.answers.values()]
      .filter((answer) => answer.attemptId === attemptId)
      .sort((a, b) => a.questionId.localeCompare(b.questionId))
      .map(clone);
  }

  async upsertGrade(grade: ExamGradeRecord) {
    this.grades.set(gradeKey(grade), clone(grade));
    return clone(grade);
  }

  async insertEvents(events: readonly ExamEventRecord[], limit: number) {
    let accepted = 0;
    for (const event of events) {
      if (this.storedEvents.filter((stored) => stored.attemptId === event.attemptId).length >= limit) continue;
      this.storedEvents.push(clone(event));
      accepted += 1;
    }
    return accepted;
  }

  async countEvents(attemptId: string) {
    return this.storedEvents.filter((event) => event.attemptId === attemptId).length;
  }

  async listExpiredInProgress(now: Date) {
    return [...this.attempts.values()]
      .filter((attempt) =>
        attempt.status === 'in_progress'
        && attempt.deadlineAt !== null
        && attempt.deadlineAt.getTime() + 30_000 < now.getTime())
      .map(clone);
  }

  getGrade(userId: string, itemId: string, courseVersionId?: string) {
    const grade = [...this.grades.values()].find((candidate) =>
      candidate.userId === userId
      && candidate.itemId === itemId
      && (courseVersionId === undefined || candidate.courseVersionId === courseVersionId));
    return grade ? clone(grade) : null;
  }

  listEvents(attemptId: string) {
    return this.storedEvents.filter((event) => event.attemptId === attemptId).map(clone);
  }
}
