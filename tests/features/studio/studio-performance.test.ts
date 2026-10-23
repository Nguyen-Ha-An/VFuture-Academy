import { afterEach, expect, it, vi } from 'vitest';

import { measureStudioOperation } from '@/features/studio/ui/studio-performance';

afterEach(() => vi.restoreAllMocks());

it('records named durations without including content in the metric', () => {
  const measure = vi.spyOn(performance, 'measure').mockImplementation(() => ({} as PerformanceMeasure));
  const value = measureStudioOperation('studio.workspace.save.prepare', () => ({ privateText: 'never logged' }));

  expect(value.privateText).toBe('never logged');
  expect(measure).toHaveBeenCalledWith('studio.workspace.save.prepare', expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) }));
  expect(JSON.stringify(measure.mock.calls)).not.toContain('never logged');
});
