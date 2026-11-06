/** Disposable learner fixture; the harness never contacts a database. */
export async function getCourseTeachers(_actor: unknown, courseId: string) {
  return { courseId, branchId: 'fixture-school', branchScopeKnown: true, revision: 0, teachers: [{ displayName: 'Teacher Lan', role: 'primary' as const }] };
}
