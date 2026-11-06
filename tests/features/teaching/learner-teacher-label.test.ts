import { expect, it } from 'vitest';
import { learnerTeacherLabel } from '@/features/teaching/ui/learner-teacher-label';

it('distinguishes unknown enrollment school, unassigned and assigned teachers', () => {
  const base = { courseId: 'c', branchId: null, revision: 0, teachers: [] };
  expect(learnerTeacherLabel('en', true, { ...base, branchScopeKnown: false })).toMatch(/school unknown/);
  expect(learnerTeacherLabel('vi', true, { ...base, branchId: 'old-school', branchScopeKnown: true })).toBe('Chưa phân công giáo viên');
  expect(learnerTeacherLabel('en', true, { ...base, branchId: 'old-school', branchScopeKnown: true, teachers: [{ displayName: 'Lan', role: 'primary' }] })).toBe('Lan');
});
