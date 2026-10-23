import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/features/certificates/service', () => ({ issue: vi.fn() }));
vi.mock('@/features/xp/service', () => ({ award: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));

import { createCourseCompletionEffect } from '@/features/completion/effects';
import { SupabaseStub, successful } from '../learner/test-kit';

const completion = {
  user_id: 'learner-1',
  course_id: 'course-1',
  course_version_id: 'version-1',
  completed_at: '2026-09-03T12:00:00.000Z',
};

describe('course completion effect', () => {
  it('attempts XP when certificate issuance fails, then rejects for the outbox retry', async () => {
    const database = new SupabaseStub({
      course_version_outline: [successful({ completion: { certificate: true } })],
    });
    const issueCertificate = vi.fn().mockRejectedValue(new Error('PDF unavailable'));
    const awardXp = vi.fn().mockResolvedValue(undefined);
    const effect = createCourseCompletionEffect({ database, issueCertificate, awardXp });

    await expect(effect(completion)).rejects.toThrow('Course completion effects failed');
    expect(issueCertificate).toHaveBeenCalledWith('learner-1', 'course-1', 'version-1');
    expect(awardXp).toHaveBeenCalledWith('learner-1', 'course_completed', 'course', 'course-1');
  });
});
