// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createPendingExamDraftStore } from '@/features/exams/ui/pending-draft';

afterEach(() => sessionStorage.clear());

describe('pending exam draft storage', () => {
  it('keeps pending answers scoped to the exact opaque attempt', () => {
    const first = createPendingExamDraftStore('attempt-one');
    const second = createPendingExamDraftStore('attempt-two');

    first.write({ 'section/q1': 'a' });

    expect(first.read()).toEqual({ 'section/q1': 'a' });
    expect(second.read()).toBeNull();
  });

  it('ignores and removes corrupt or version-mismatched data', () => {
    const store = createPendingExamDraftStore('attempt-corrupt');
    sessionStorage.setItem(store.key, '{broken');
    expect(store.read()).toBeNull();
    expect(sessionStorage.getItem(store.key)).toBeNull();

    sessionStorage.setItem(store.key, JSON.stringify({ version: 2, answers: { q1: 'a' }, updatedAt: 1 }));
    expect(store.read()).toBeNull();
    expect(sessionStorage.getItem(store.key)).toBeNull();
  });

  it('refuses an oversized snapshot without retaining stale data', () => {
    const store = createPendingExamDraftStore('attempt-large');
    store.write({ q1: 'small' });
    store.write({ q1: 'x'.repeat(70_000) });

    expect(store.read()).toBeNull();
  });

  it('retains a large answer that remains within the server 64 KiB payload bound', () => {
    const store = createPendingExamDraftStore('attempt-large-valid');
    const answers = { q1: 'x'.repeat(63_000) };

    expect(store.write(answers)).toBe(true);
    expect(store.read()).toEqual(answers);
  });

  it('reports storage quota failure without throwing or retaining stale data', () => {
    const storage = {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
    } as unknown as Storage;
    const store = createPendingExamDraftStore('attempt-quota', storage);

    expect(store.write({ q1: 'pending' })).toBe(false);
    expect(store.read()).toBeNull();
  });

  it('clears a terminal attempt draft', () => {
    const store = createPendingExamDraftStore('attempt-terminal');
    store.write({ q1: 'pending' });
    store.clear();
    expect(store.read()).toBeNull();
  });
});
