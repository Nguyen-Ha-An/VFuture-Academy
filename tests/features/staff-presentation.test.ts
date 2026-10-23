import { describe, expect, it } from 'vitest';
import { staffPresentationEnabled } from '@/features/workspace/presentation';

describe('staff presentation rollout', () => {
  it('keeps rollout off unless the workspace is explicitly selected', () => {
    expect(staffPresentationEnabled('studio', undefined)).toBe(false);
    expect(staffPresentationEnabled('admin', 'all')).toBe(false);
    expect(staffPresentationEnabled('grading', 'admin, studio')).toBe(false);
    expect(staffPresentationEnabled('studio', 'admin, studio')).toBe(true);
  });
});
