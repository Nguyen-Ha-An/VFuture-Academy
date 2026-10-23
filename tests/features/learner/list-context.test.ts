import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  opportunityListContext,
  projectListContext,
  resourceListContext,
} from '@/features/learner/list-context';

describe('learner opportunity list context', () => {
  it('treats empty params from "any" options as absent (F1)', () => {
    expect(opportunityListContext({ type: '', openNow: 'true', featured: '' })).toEqual({
      filters: { openNow: true }, invalid: false, success: true,
    });
  });

  it('keeps a valid type beside an empty featured param', () => {
    expect(opportunityListContext({ type: 'hackathon', featured: '' })).toEqual({
      filters: { type: 'hackathon' }, invalid: false, success: true,
    });
  });

  it('keeps an explicit featured=false as a filter', () => {
    expect(opportunityListContext({ featured: 'false' }).filters).toEqual({ featured: false });
  });

  it('drops only the bad key and restarts at page 1', () => {
    expect(opportunityListContext({ type: 'bogus', openNow: 'true' })).toEqual({
      filters: { openNow: true, page: 1 }, invalid: true, success: false,
    });
    expect(opportunityListContext({ type: 'hackathon', featured: 'maybe', page: 'x' })).toEqual({
      filters: { type: 'hackathon', page: 1 }, invalid: true, success: false,
    });
  });

  it('keeps a valid page beside a bad key', () => {
    expect(opportunityListContext({ type: 'hackathon', openNow: 'true', featured: 'invalid', page: '2' }).filters)
      .toEqual({ type: 'hackathon', openNow: true, page: 2 });
  });

  it('reads the first non-empty repeated value', () => {
    expect(opportunityListContext({ type: ['', 'workshop'] }).filters).toEqual({ type: 'workshop' });
  });
});

describe('learner resource list context', () => {
  it('does not flag a whitespace-only search or tag as invalid', () => {
    expect(resourceListContext({ search: '  ', tag: ' ' })).toEqual({ filters: {}, invalid: false });
  });

  it('keeps the valid keys when one key is invalid', () => {
    expect(resourceListContext({ search: 'prompt', pathway: 'not-a-pathway' })).toEqual({
      filters: { search: 'prompt', page: 1 }, invalid: true,
    });
  });
});

describe('learner project list context', () => {
  it('ignores empty params', () => {
    expect(projectListContext({ status: '' })).toEqual({ filters: {}, query: {} });
    expect(projectListContext({ status: '', skill: ' ', course: '' })).toEqual({ filters: {}, query: {} });
  });

  it('keeps supported values', () => {
    expect(projectListContext({ status: 'active', skill: 'python' })).toEqual({
      filters: { statuses: ['active'], skills: ['python'] },
      query: { status: 'active', skill: 'python' },
    });
  });
});
