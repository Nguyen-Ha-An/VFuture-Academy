// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { supportReviewParam } from '../../e2e/support/support-review-state';

beforeEach(() => { sessionStorage.clear(); history.replaceState({}, '', '/app'); });

describe('support review settings', () => {
  it('preserves explicit fixture mode across native navigation without changing the destination URL', () => {
    history.replaceState({}, '', '/app/explore?lang=vi&theme=dark&supportState=dense&supportMutation=retry');
    expect(supportReviewParam('theme')).toBe('dark');
    history.replaceState({}, '', '/app/resources?page=2');
    expect(supportReviewParam('supportState')).toBe('dense');
    expect(supportReviewParam('supportMutation')).toBe('retry');
    expect(supportReviewParam('lang')).toBe('vi');
    expect(location.search).toBe('?page=2');
  });

  it('lets explicit settings override the session and baseline reset scenario and mutation', () => {
    history.replaceState({}, '', '/app?supportState=dense&supportMutation=error');
    supportReviewParam('supportState');
    history.replaceState({}, '', '/app?supportState=empty');
    expect(supportReviewParam('supportState')).toBe('empty');
    history.replaceState({}, '', '/app?supportState=baseline');
    expect(supportReviewParam('supportState')).toBe('baseline');
    expect(supportReviewParam('supportMutation')).toBeNull();
    history.replaceState({}, '', '/app/resources');
    expect(supportReviewParam('supportState')).toBeNull();
  });
});
