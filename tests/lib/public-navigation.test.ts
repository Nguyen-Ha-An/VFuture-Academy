import { describe, expect, it } from 'vitest';
import { publicBackHref, publicDetailHref, publicHref, publicRouteKey, type PublicCatalog } from '@/features/public-site/public-navigation';

describe('public URL context', () => {
  it('keeps locale, repeated query values and anchors together', () => {
    expect(publicHref('/resources?tag=existing#library', 'en', { tag: ['web', 'data'], search: 'café & code' }))
      .toBe('/resources?tag=web&tag=data&search=caf%C3%A9+%26+code&lang=en#library');
    expect(publicHref('/#ecosystem', 'vi')).toBe('/?lang=vi#ecosystem');
  });

  it.each([
    '/login?next=%2Fapp%2Fcourses%2Fc1', '/app/resources/r1', '/studio/courses', '/api/v1/files?token=abc',
    'https://external.test/courses', '//external.test/courses', 'mailto:contact@vfuturelabs.org', '#main-content',
  ])('preserves non-public destination exactly: %s', (href) => {
    expect(publicHref(href, 'en', { search: 'ignored' })).toBe(href);
  });

  const cases: Array<[PublicCatalog, Record<string, string>, string]> = [
    ['courses', { pathway: 'ai', page: '2', search: 'discard', next: '/admin' }, 'pathway=ai&page=2'],
    ['projects', { skill: 'C++', course: 'course-1', page: '3', returnTo: 'https://external.test' }, 'skill=C%2B%2B&course=course-1&page=3'],
    ['opportunities', { type: 'challenge', openNow: 'true', featured: 'true', page: '2', token: 'discard' }, 'type=challenge&openNow=true&featured=true&page=2'],
    ['resources', { search: 'web design', type: 'article', tag: 'ui', pathway: 'design', page: '4', skill: 'discard' }, 'search=web+design&type=article&tag=ui&pathway=design&page=4'],
  ];
  it.each(cases)('round trips only allowlisted %s context through a detail', (catalog, params, context) => {
    expect(publicDetailHref(catalog, 'public-item', params, 'en')).toBe(`/${catalog}/public-item?${context}&lang=en`);
    const fromDetail = Object.fromEntries(new URL(publicDetailHref(catalog, 'public-item', params, 'en'), 'https://local.test').searchParams);
    expect(publicBackHref(catalog, fromDetail, 'en')).toBe(`/${catalog}?${context}&lang=en`);
  });

  it('uses server-compatible first repeated filter values and rejects invalid pages', () => {
    expect(publicBackHref('resources', { tag: ['first', 'second'], page: ['2', '3'] }, 'vi')).toBe('/resources?tag=first&page=2&lang=vi');
    for (const page of ['0', '-1', '1.2', 'Infinity', '1e5', '9007199254740992']) {
      expect(publicBackHref('courses', { page }, 'en')).toBe('/courses?lang=en');
    }
  });

  it('encodes identifiers as a single segment and never takes raw return URLs', () => {
    expect(publicDetailHref('projects', 'a/b ?#', { returnTo: '//external.test', lang: 'vi' }, 'en')).toBe('/projects/a%2Fb%20%3F%23?lang=en');
  });

  it('derives bounded analytics route keys without exposing identifiers or unknown paths', () => {
    expect(publicRouteKey('/')).toBe('home');
    expect(publicRouteKey('/courses/private-looking-id')).toBe('course_detail');
    expect(publicRouteKey('/resources')).toBe('resources');
    expect(publicRouteKey('/app/courses/secret')).toBeNull();
    expect(publicRouteKey('/resources/one/unknown')).toBeNull();
    expect(publicRouteKey('/constructor/item')).toBeNull();
    expect(publicRouteKey('/__proto__/item')).toBeNull();
  });
});
