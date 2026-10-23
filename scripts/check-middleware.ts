import assert from 'node:assert/strict';

// Run against either `next dev --turbopack` or `next start`; no account is needed.
async function main() {
  const baseURL = process.argv[2] ?? 'http://localhost:3000';
  const response = await fetch(new URL('/courses?lang=en', baseURL));
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('content-security-policy'), 'Middleware must attach CSP');
  assert.match(response.headers.get('set-cookie') ?? '', /locale=en/, 'Language query must persist the locale');
  assert.match(await response.text(), /<html[^>]*lang="en"/, 'Language query must affect the current render');

  for (const path of ['/app/courses/test/items/lesson', '/studio/courses/test', '/grading', '/grading/queue?tab=exams&branchId=school-a', '/grading/reports', '/admin/enrollment-migration']) {
    const result = await fetch(new URL(path, baseURL), { redirect: 'manual' });
    assert.equal(result.status, 307, `${path} must redirect unauthenticated visitors`);
    assert.equal(result.headers.get('location'), `/login?next=${encodeURIComponent(path)}`);
    assert.ok(result.headers.get('content-security-policy'), `${path} must include CSP`);
  }
  console.log('Middleware checks passed: CSP, locale cookie, current-page language and protected deep links.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
