import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { NOTEBOOK_ACTION_RATE_LIMITS } from '@/features/notebooks/handlers';
import { RATE_LIMITS } from '@/lib/rate-limit';

describe('notebook mutation rate limits', () => {
  it('uses the progress ceiling plus per-action caps that allow 3-second autosave cycles', () => {
    expect(RATE_LIMITS.progress).toEqual({ limit: 120, windowSeconds: 60 });
    expect(NOTEBOOK_ACTION_RATE_LIMITS).toEqual({
      upload: { limit: 30, windowSeconds: 60 },
      finalize: { limit: 30, windowSeconds: 60 },
      draft: { limit: 30, windowSeconds: 60 },
      config: { limit: 10, windowSeconds: 60 },
    });
  });
});
