/** Disposable API fixture for the real assignment manager UI. */
export function teacherTransport(next: typeof fetch): typeof fetch {
  let revision = 1;
  let teachers: Array<{ userId: string; displayName: string; role: 'primary' | 'assistant' }> = [];
  const people = [{ userId: '00000000-0000-4000-8000-000000000101', displayName: 'An Nguyen', handle: 'an' }, { userId: '00000000-0000-4000-8000-000000000102', displayName: 'Be Tran', handle: 'be' }];
  return async (input, init) => {
    const url = new URL(String(input), location.origin);
    const response = (data: unknown) => new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/api/v1/teaching/options') return response({ courses: [{ id: 'fixture-course', title: 'Fixture course' }], versions: [] });
    if (url.pathname === '/api/v1/teaching/teacher-options') return response({ teachers: people, page: 1, pageSize: 100, hasMore: false });
    if (url.pathname === '/api/v1/teaching/courses/fixture-course/teachers') {
      const row = () => ({ courseId: 'fixture-course', branchId: 'ans', revision, teachers });
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        sessionStorage.setItem("teacher-fixture-last-save", JSON.stringify(body));
        if (body.expectedRevision !== revision) return new Response('', { status: 409 });
        if (revision === 1) { revision = 2; teachers = [{ ...people[1]!, role: 'primary' }]; return new Response('', { status: 409 }); }
        revision++; teachers = body.teachers.map((teacher: { userId: string; role: 'primary' | 'assistant' }) => ({ ...teacher, displayName: people.find(person => person.userId === teacher.userId)?.displayName ?? '' }));
      }
      return response(row());
    }
    return next(input, init);
  };
}
