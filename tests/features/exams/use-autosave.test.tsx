// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExamAnswerRecord } from '@/features/exams/types';
import { createHttpExamClient, ExamRequestError, type ExamAnswerAck } from '@/features/exams/ui/client';
import { createPendingExamDraftStore } from '@/features/exams/ui/pending-draft';
import {
  AUTOSAVE_MAX_BACKOFF_MS,
  AUTOSAVE_MAX_RETRY_AFTER_MS,
  autosaveBackoffMs,
  useAutosave,
  type SaveStatus,
  type TerminalResolution,
} from '@/features/exams/ui/useAutosave';

const ANSWER_GROUPS = {};

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

/** A server that stores every acknowledged answer and returns all of them, like PUT answers. */
function fakeServer() {
  const stored = new Map<string, unknown>();
  const save = vi.fn(async (answers: Record<string, unknown>): Promise<ExamAnswerRecord[]> => {
    for (const [questionId, answer] of Object.entries(answers)) stored.set(questionId, answer);
    return [...stored.entries()].map(([questionId, answer]) => ({
      attemptId: 'attempt-1',
      questionId,
      answer,
      result: null,
      manualPoints: null,
      manualFeedback: null,
      gradedBy: null,
      updatedAt: new Date('2026-09-03T05:01:00.000Z'),
    }));
  });
  return { save, stored };
}

const timeout = () => new ExamRequestError(0, 'REQUEST_TIMEOUT', 'Exam request timed out', { ambiguous: true });
const rateLimited = (retryAfterMs: number) => new ExamRequestError(429, 'RATE_LIMITED', 'Too many requests', { retryAfterMs });

type SaveFn = (answers: Record<string, unknown>) => Promise<ExamAnswerAck[]>;

function setup(save: SaveFn, options: { random?: () => number; onTerminal?: () => void | TerminalResolution | Promise<void | TerminalResolution>; groups?: Record<string,string> } = {}) {
  const storage = memoryStorage();
  const draftStore = createPendingExamDraftStore('attempt-1', storage);
  const answersRef = { current: {} as Record<string, unknown> };
  const submittingRef = { current: false };
  const client = { save };
  const statuses: SaveStatus[] = [];
  const hook = renderHook(({ revision }: { revision: number }) => {
    const value = useAutosave({
      answerGroups: options.groups ?? ANSWER_GROUPS,
      answersRef,
      client,
      draftStore,
      initialAcceptedAnswers: {},
      onTerminal: options.onTerminal,
      revision,
      submittingRef,
      random: options.random,
    });
    statuses.push(value.saveStatus);
    return value;
  }, { initialProps: { revision: 0 } });

  let revision = 0;
  const start = Date.now();
  return {
    hook,
    draftStore,
    submittingRef,
    statuses,
    /** Mirrors ExamPlayer: update the ref, mark dirty, bump the revision. */
    edit(answers: Record<string, unknown>) {
      answersRef.current = answers;
      act(() => { hook.result.current.markDirty(); });
      revision += 1;
      hook.rerender({ revision });
    },
    /** Advances fake time to `elapsedMs` after setup, flushing timers and promises. */
    async at(elapsedMs: number) {
      await act(async () => { await vi.advanceTimersByTimeAsync(start + elapsedMs - Date.now()); });
    },
    status: () => hook.result.current.saveStatus,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-03T05:00:00.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('autosave backoff formula', () => {
  it('is full-jitter exponential from 1s, doubling, capped at 30s', () => {
    const top = 0.999999;
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((failures) => autosaveBackoffMs(failures, () => top)))
      .toEqual([999, 1_999, 3_999, 7_999, 15_999, 29_999, 29_999, 29_999]);
    expect(autosaveBackoffMs(3, () => 0)).toBe(0);
    expect(autosaveBackoffMs(3, () => 0.5)).toBe(2_000);
    expect(AUTOSAVE_MAX_BACKOFF_MS).toBe(30_000);
  });

  it('never waits less than the server asked, and caps a huge Retry-After at 120s', () => {
    expect(autosaveBackoffMs(1, () => 0.5, 20_000)).toBe(20_000);
    expect(autosaveBackoffMs(1, () => 0.5, 600_000)).toBe(AUTOSAVE_MAX_RETRY_AFTER_MS);
    expect(AUTOSAVE_MAX_RETRY_AFTER_MS).toBe(120_000);
  });

  it.each([undefined, Number.NaN, -1_000, Number.POSITIVE_INFINITY])('ignores an unusable Retry-After (%s)', (retryAfterMs) => {
    expect(autosaveBackoffMs(2, () => 0.5, retryAfterMs)).toBe(1_000);
  });

  it('treats an out-of-range random source as the nearest valid value', () => {
    expect(autosaveBackoffMs(1, () => 5)).toBe(999);
    expect(autosaveBackoffMs(1, () => -5)).toBe(0);
  });
});

describe('autosave acknowledgement', () => {
  it('does not merge a partial acknowledgement into the accepted map',async()=>{
    const h=setup(async()=>[{questionId:'q1',answer:'one'}],{groups:{q1:'section',q2:'section'}});
    h.edit({q1:'one',q2:'two'});
    let saved=true;await act(async()=>{saved=await h.hook.result.current.persistAnswers();});
    expect(saved).toBe(false);expect(h.status()).toBe('failed');
    expect(h.draftStore.read()).toEqual({q1:'one',q2:'two'});
  });
  it('retains only unsaved entries after a later byte-bounded batch fails',async()=>{
    const server=fakeServer();let calls=0;
    const groups=Object.fromEntries(Array.from({length:15},(_,i)=>[`q-${i}`,'section']));
    const h=setup(async answers=>{calls++;if(calls===2)throw new Error('network');return server.save(answers);},{groups});
    h.edit(Object.fromEntries(Array.from({length:15},(_,i)=>[`q-${i}`,'a'.repeat(5000)])));
    let saved=true;await act(async()=>{saved=await h.hook.result.current.persistAnswers();});
    expect(saved).toBe(false);expect(h.status()).toBe('failed');
    const pending=h.draftStore.read();expect(pending).not.toBeNull();
    expect(Object.keys(pending!).length).toBeGreaterThan(0);
    expect(Object.keys(pending!).length).toBeLessThan(15);
  });
  it('reports a single oversized keyed answer without retrying until an edit',async()=>{
    const server=fakeServer();const h=setup(server.save);
    h.edit({'q1':'x'.repeat(65534)});
    let saved=true;await act(async()=>{saved=await h.hook.result.current.persistAnswers();});
    expect(saved).toBe(false);expect(h.hook.result.current.lastSaveErrorCode()).toBe('ANSWER_TOO_LARGE');
    expect(h.hook.result.current.oversizedQuestionId).toBe('q1');expect(server.save).not.toHaveBeenCalled();
    await h.at(31_000);expect(server.save).not.toHaveBeenCalled();
    h.edit({'q1':'shortened'});
    expect(h.hook.result.current.oversizedQuestionId).toBeNull();
    await act(async()=>{saved=await h.hook.result.current.persistAnswers();});
    expect(saved).toBe(true);expect(server.stored.get('q1')).toBe('shortened');
  });
  it('round-trips a cleared dropdown through the real HTTP client before allowing final save', async () => {
    const stored = new Map<string, unknown>();
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {answers:Record<string,unknown>};
      bodies.push(body.answers);
      for (const [questionId, answer] of Object.entries(body.answers)) stored.set(questionId, answer);
      const data = {format:'compact-v1',answers:Object.keys(body.answers).map(questionId => ({questionId,answer:stored.get(questionId)}))};
      return new Response(JSON.stringify({data}),{status:200,headers:{'content-type':'application/json'}});
    };
    const client = createHttpExamClient({courseId:'course-one',itemId:'exam-one',attemptId:'00000000-0000-4000-8000-000000000003',fetcher});
    const h=setup(client.save);
    h.edit({'section/question':'choice-one'});
    let saved=false;
    await act(async()=>{saved=await h.hook.result.current.persistAnswers();});
    expect(saved).toBe(true);
    h.edit({'section/question':undefined});
    await act(async()=>{saved=await h.hook.result.current.persistAnswers();});
    expect(saved).toBe(true);
    expect(bodies.at(-1)).toHaveProperty('section/question',null);
    expect(stored.get('section/question')).toBeNull();
    expect(h.status()).toBe('saved');
  });
  it('refuses the final save when the server omits acknowledgement of a pending answer', async () => {
    const h = setup(async () => []);
    h.edit({ q1: 'final answer' });
    let saved = true;

    await act(async () => { saved = await h.hook.result.current.persistAnswers(); });

    expect(saved).toBe(false);
    expect(h.status()).toBe('failed');
    expect(h.draftStore.read()).toEqual({ q1: 'final answer' });
  });

  it('keeps the pending draft and never reports saved when a save is ambiguous', async () => {
    const server = fakeServer();
    const save = vi.fn<SaveFn>().mockRejectedValueOnce(timeout()).mockImplementation(server.save);
    const h = setup(save);
    h.statuses.length = 0;

    h.edit({ q1: 'a' });
    await h.at(1_000);

    expect(save).toHaveBeenCalledOnce();
    expect(h.status()).toBe('failed');
    expect(h.statuses).not.toContain('saved');
    expect(h.draftStore.read()).toEqual({ q1: 'a' });
  });

  it('reports saved only after a later acknowledgement, which also clears the draft', async () => {
    const server = fakeServer();
    const save = vi.fn<SaveFn>().mockRejectedValueOnce(timeout()).mockImplementation(server.save);
    const h = setup(save);
    h.edit({ q1: 'a' });
    await h.at(1_000);
    expect(h.status()).toBe('failed');

    await act(async () => { await h.hook.result.current.retryNow(); });

    expect(h.status()).toBe('saved');
    expect(h.draftStore.read()).toBeNull();
    expect(server.stored.get('q1')).toBe('a');
  });

  it('keeps reporting failed, not saving, while edits wait out a backoff', async () => {
    const save = vi.fn<SaveFn>().mockRejectedValue(rateLimited(20_000));
    const h = setup(save);
    h.edit({ q1: 'a' });
    await h.at(1_000);

    h.edit({ q1: 'ab' });

    expect(h.status()).toBe('failed');
    expect(h.draftStore.read()).toEqual({ q1: 'ab' });
  });
});

describe('autosave backoff scheduling', () => {
  it('does not queue automatic edits behind an in-flight save and bypass its later backoff', async () => {
    let rejectFirst!: (error: Error) => void;
    const server = fakeServer();
    const save = vi.fn<SaveFn>()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
      .mockImplementation(server.save);
    const h = setup(save);
    h.edit({ q1: 'a' });
    await h.at(1_000);
    h.edit({ q1: 'b' });
    await h.at(2_000);
    await act(async () => { rejectFirst(rateLimited(20_000)); });

    expect(save).toHaveBeenCalledOnce();
    expect(h.draftStore.read()).toEqual({ q1: 'b' });
    await h.at(21_999);
    expect(save).toHaveBeenCalledOnce();
    await h.at(22_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ q1: 'b' });
    expect(h.draftStore.read()).toBeNull();
  });

  it('defers automatic saves until the Retry-After passes, then makes exactly one deferred attempt', async () => {
    const server = fakeServer();
    const save = vi.fn<SaveFn>().mockRejectedValueOnce(rateLimited(20_000)).mockImplementation(server.save);
    const h = setup(save, { random: () => 0.5 });
    h.edit({ q1: 'a' });
    await h.at(1_000);
    expect(save).toHaveBeenCalledTimes(1);

    await h.at(1_500);
    h.edit({ q1: 'b' });
    await h.at(2_500); // the 1s debounce fires inside the backoff window
    expect(save).toHaveBeenCalledTimes(1);
    expect(h.draftStore.read()).toEqual({ q1: 'b' });

    await h.at(20_999);
    expect(save).toHaveBeenCalledTimes(1);
    await h.at(21_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ q1: 'b' });
    expect(h.status()).toBe('saved');
    expect(h.draftStore.read()).toBeNull();

    await h.at(60_000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('defers the 30 second interval too, instead of dropping the save', async () => {
    const server = fakeServer();
    const save = vi.fn<SaveFn>().mockRejectedValueOnce(rateLimited(60_000)).mockImplementation(server.save);
    const h = setup(save);
    h.edit({ q1: 'a' });
    await h.at(1_000); // fails; allowed again at 61s

    await h.at(31_500); // interval tick deferred
    expect(save).toHaveBeenCalledTimes(1);
    await h.at(60_999);
    expect(save).toHaveBeenCalledTimes(1);
    await h.at(61_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(h.status()).toBe('saved');
  });

  it('escalates the wait with consecutive failures', async () => {
    const server = fakeServer();
    const save = vi.fn<SaveFn>()
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(timeout())
      .mockImplementation(server.save);
    const h = setup(save, { random: () => 0.999999 });
    h.edit({ q1: 'a' });
    await h.at(1_000); // failure 1 (window 1s)
    await act(async () => { await h.hook.result.current.retryNow(); }); // failure 2 (window 2s)
    await act(async () => { await h.hook.result.current.retryNow(); }); // failure 3 (window 4s) at t=1000
    expect(save).toHaveBeenCalledTimes(3);

    h.edit({ q1: 'b' });
    await h.at(2_000);
    expect(save).toHaveBeenCalledTimes(3); // deferred by the 4s window, not the 1s debounce
    await h.at(4_998);
    expect(save).toHaveBeenCalledTimes(3);
    await h.at(4_999);
    expect(save).toHaveBeenCalledTimes(4);
    expect(h.status()).toBe('saved');
  });

  it('caps the server Retry-After at two minutes', async () => {
    const server = fakeServer();
    const save = vi.fn<SaveFn>().mockRejectedValueOnce(rateLimited(600_000)).mockImplementation(server.save);
    const h = setup(save);
    h.edit({ q1: 'a' });
    await h.at(1_000);
    h.edit({ q1: 'b' });

    await h.at(120_999);
    expect(save).toHaveBeenCalledTimes(1);
    await h.at(121_000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('runs an explicit retryNow immediately even inside the backoff window', async () => {
    const server = fakeServer();
    const save = vi.fn<SaveFn>().mockRejectedValueOnce(rateLimited(60_000)).mockImplementation(server.save);
    const h = setup(save);
    h.edit({ q1: 'a' });
    await h.at(1_000);
    await h.at(1_200);

    await act(async () => { await h.hook.result.current.retryNow(); });

    expect(save).toHaveBeenCalledTimes(2);
    expect(h.status()).toBe('saved');
  });

  it('runs the explicit pre-submit persistAnswers immediately, so a final save is never delayed', async () => {
    const server = fakeServer();
    const save = vi.fn<SaveFn>().mockRejectedValueOnce(rateLimited(60_000)).mockImplementation(server.save);
    const h = setup(save);
    h.edit({ q1: 'a' });
    await h.at(1_000);
    h.edit({ q1: 'final' });

    let saved = false;
    await act(async () => { saved = await h.hook.result.current.persistAnswers(); });

    expect(saved).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ q1: 'final' });
    expect(server.stored.get('q1')).toBe('final');
  });

  it('resets the backoff after a success, so the next automatic save is not delayed', async () => {
    const server = fakeServer();
    const save = vi.fn<SaveFn>().mockRejectedValueOnce(rateLimited(60_000)).mockImplementation(server.save);
    const h = setup(save);
    h.edit({ q1: 'a' });
    await h.at(1_000);
    await act(async () => { await h.hook.result.current.retryNow(); });
    expect(save).toHaveBeenCalledTimes(2);

    h.edit({ q1: 'b' });
    await h.at(2_000);

    expect(save).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenLastCalledWith({ q1: 'b' });
    expect(h.status()).toBe('saved');
  });

  it('does not delay automatic saves after a section deadline rejection', async () => {
    const server = fakeServer();
    const sectionClosed = Object.assign(new Error('closed'), { code: 'SECTION_DEADLINE_PASSED' });
    const save = vi.fn<SaveFn>().mockRejectedValueOnce(sectionClosed).mockImplementation(server.save);
    const h = setup(save);
    h.edit({ q1: 'a' });
    await h.at(1_000);
    expect(save).toHaveBeenCalledTimes(1);

    h.edit({ q1: 'b' });
    await h.at(2_000);

    expect(save).toHaveBeenCalledTimes(2);
  });

  it('keeps terminal handling exactly as before and starts no backoff for it', async () => {
    const terminal = Object.assign(new Error('expired'), { code: 'DEADLINE_PASSED' });
    const onTerminal = vi.fn();
    const save = vi.fn<SaveFn>().mockRejectedValue(terminal);
    const h = setup(save, { onTerminal });
    h.edit({ q1: 'a' });
    await h.at(1_000);

    expect(onTerminal).toHaveBeenCalledOnce();
    expect(h.draftStore.read()).toBeNull();
    expect(h.status()).toBe('failed');
  });

  it('keeps the pending journal after unconfirmed terminal status and allows reconciliation retry',async()=>{
    const terminal=Object.assign(new Error('not active'),{code:'ATTEMPT_NOT_ACTIVE'});
    const onTerminal=vi.fn().mockResolvedValueOnce({confirmed:false}).mockResolvedValueOnce({confirmed:true});
    const h=setup(vi.fn<SaveFn>().mockRejectedValue(terminal),{onTerminal});
    h.edit({q1:'pending'});await h.at(1_000);
    expect(h.draftStore.read()).toEqual({q1:'pending'});
    await act(async()=>{await h.hook.result.current.retryNow();});
    expect(onTerminal).toHaveBeenCalledTimes(2);expect(h.draftStore.read()).toBeNull();
  });

  it('retains the journal when terminal reconciliation identifies unsaved own answers',async()=>{
    const terminal=Object.assign(new Error('not active'),{code:'ATTEMPT_NOT_ACTIVE'});
    const h=setup(vi.fn<SaveFn>().mockRejectedValue(terminal),{onTerminal:async()=>({confirmed:true,preserveRecovery:true})});
    h.edit({q1:'pending'});await h.at(1_000);
    expect(h.draftStore.read()).toEqual({q1:'pending'});
    act(()=>h.hook.result.current.markSubmitted({preserveRecovery:true}));
    expect(h.draftStore.read()).toEqual({q1:'pending'});
  });

  it('retains the journal when terminal reconciliation itself fails',async()=>{
    const terminal=Object.assign(new Error('not active'),{code:'ATTEMPT_NOT_ACTIVE'});
    const onTerminal=vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({confirmed:true});
    const h=setup(vi.fn<SaveFn>().mockRejectedValue(terminal),{onTerminal});
    h.edit({q1:'pending'});await h.at(1_000);
    expect(h.draftStore.read()).toEqual({q1:'pending'});
    await act(async()=>{await h.hook.result.current.retryNow();});
    expect(onTerminal).toHaveBeenCalledTimes(2);expect(h.draftStore.read()).toBeNull();
  });

  it('cancels a deferred attempt when the player unmounts', async () => {
    const server = fakeServer();
    const save = vi.fn<SaveFn>().mockRejectedValueOnce(rateLimited(20_000)).mockImplementation(server.save);
    const h = setup(save);
    h.edit({ q1: 'a' });
    await h.at(1_000);
    h.edit({ q1: 'b' });
    await h.at(2_500);

    h.hook.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('skips a deferred attempt once final submission has begun', async () => {
    const server = fakeServer();
    const save = vi.fn<SaveFn>().mockRejectedValueOnce(rateLimited(20_000)).mockImplementation(server.save);
    const h = setup(save);
    h.edit({ q1: 'a' });
    await h.at(1_000);
    h.edit({ q1: 'b' });
    await h.at(2_500);

    h.submittingRef.current = true;
    await h.at(60_000);

    expect(save).toHaveBeenCalledTimes(1);
  });
});
