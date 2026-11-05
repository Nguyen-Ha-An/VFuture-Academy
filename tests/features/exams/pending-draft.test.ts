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

    sessionStorage.setItem(store.key, JSON.stringify({ version: 99, answers: { q1: 'a' }, updatedAt: 1 }));
    expect(store.read()).toBeNull();
    expect(sessionStorage.getItem(store.key)).toBeNull();
  });

  it('refuses an unsendable answer without deleting the prior recovery journal', () => {
    const store = createPendingExamDraftStore('attempt-large');
    store.write({ q1: 'small' });
    store.write({ q1: 'x'.repeat(70_000) });

    expect(store.read()).toEqual({q1:'small'});
  });

  it('recovers a multi-question journal larger than one network batch', () => {
    const store=createPendingExamDraftStore('attempt-many');
    const answers=Object.fromEntries(Array.from({length:15},(_,i)=>[`q-${i}`,'a'.repeat(5000)]));
    expect(store.write(answers)).toBe(true);
    expect(store.read()).toEqual(answers);
  });

  it('reads a previously saved version-one recovery snapshot', () => {
    const store=createPendingExamDraftStore('attempt-v1');
    sessionStorage.setItem(store.key,JSON.stringify({version:1,answers:{q:'previous'},updatedAt:1}));
    expect(store.read()).toEqual({q:'previous'});
  });

  it('preserves the committed previous index and answers when a new generation hits quota', () => {
    const values=new Map<string,string>();let fail=false;let successfulWrites=0;
    const storage:Storage={get length(){return values.size;},clear:()=>values.clear(),getItem:key=>values.get(key)??null,key:index=>[...values.keys()][index]??null,removeItem:key=>{values.delete(key);},setItem:(key,value)=>{if(fail && ++successfulWrites===2)throw new DOMException('quota','QuotaExceededError');values.set(key,value);}};
    const store=createPendingExamDraftStore('attempt-atomic',storage);
    expect(store.write({q:'old'})).toBe(true);fail=true;
    expect(store.write({q:'new',other:'new'})).toBe(false);
    expect(store.read()).toEqual({q:'old'});
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
