import { describe, expect, it } from 'vitest';

import { routes, withQuery } from '@/lib/routes';

describe('route builders', () => {
  it('builds the public Academy gateway with the shared query policy', () => {
    expect(routes.public.academy({ lang: 'en' })).toBe('/academy?lang=en');
  });

  it('builds canonical learner, public, Studio, and authentication destinations', () => {
    expect(routes.public.course('ai foundations')).toBe('/courses/ai%20foundations');
    expect(routes.learner.dashboard()).toBe('/app');
    expect(routes.learner.courseItem('course/one', 'item?#one')).toBe('/app/courses/course%2Fone/items/item%3F%23one');
    expect(routes.learner.project('climate/lab')).toBe('/app/projects/climate%2Flab');
    expect(routes.learner.newProject()).toBe('/app/projects/new');
    expect(routes.learner.course('..')).toBe('/app/courses/%2E%2E');
    expect(routes.studio.bankItem('question one')).toBe('/studio/bank/question%20one');
    expect(routes.studio.library()).toBe('/studio/library');
    expect(routes.studio.courses()).toBe('/studio/courses');
    expect(routes.studio.reviews()).toBe('/studio/reviews');
    expect(routes.auth.login({ next: '/app/profile' })).toBe('/login?next=%2Fapp%2Fprofile');
  });

  it('builds the canonical Assessment & grading and Administration destinations', () => {
    expect(routes.grading.dashboard()).toBe('/grading');
    expect(routes.grading.assessments()).toBe('/grading/assessments');
    expect(routes.grading.queue({ branchId: 'vinsmc' })).toBe('/grading/queue?branchId=vinsmc');
    expect(routes.grading.assignment('submission/one')).toBe('/grading/assignments/submission%2Fone');
    expect(routes.grading.exam('attempt one', { back: '/grading/assessments' }))
      .toBe('/grading/exams/attempt%20one?back=%2Fgrading%2Fassessments');
    expect(routes.grading.reports()).toBe('/grading/reports');
    expect(routes.admin.enrollmentMigration()).toBe('/admin/enrollment-migration');
  });

  it('resolves the retained legacy builders directly to canonical grading paths', () => {
    expect(routes.studio.grading()).toBe('/grading/queue');
    expect(routes.studio.assessments()).toBe('/grading/assessments');
    expect(routes.studio.analytics()).toBe('/grading/reports');
    expect(routes.studio.gradingAssignment('s-1')).toBe('/grading/assignments/s-1');
    expect(routes.studio.gradingExam('a-1')).toBe('/grading/exams/a-1');
  });

  it('encodes query values and retains repeated values in order', () => {
    expect(withQuery('/app/courses', {
      tag: ['ai safety', 'climate'],
      page: 2,
      featured: false,
      omitted: undefined,
    })).toBe('/app/courses?tag=ai+safety&tag=climate&page=2&featured=false');

    expect(routes.learner.resources(new URLSearchParams('type=guide&type=video&q=a%26b')))
      .toBe('/app/resources?type=guide&type=video&q=a%26b');
  });
});


describe('legacy operator bookmarks',()=>{
  it('redirects before layout authorization and never targets another legacy entry',async()=>{
    const {staffLegacyRedirects}=await import('@/lib/staff-legacy-redirects');
    expect(staffLegacyRedirects).toContainEqual({source:'/admin/bank/:path*',destination:'/studio/bank/:path*',permanent:false});
    const sources=new Set(staffLegacyRedirects.map((route)=>route.source));
    for(const route of staffLegacyRedirects){
      expect(route.destination,route.source).toMatch(/^\/(studio|grading|admin)\//);
      expect(sources.has(route.destination),`${route.source} chains to another legacy source`).toBe(false);
      expect(route.destination).not.toBe(route.source);
    }
  });

  it('sends every superseded grading, report and enrollment bookmark to its canonical workspace',async()=>{
    const {staffLegacyRedirects}=await import('@/lib/staff-legacy-redirects');
    const map=new Map(staffLegacyRedirects.map((route)=>[route.source,route.destination]));
    expect(Object.fromEntries(map)).toMatchObject({
      '/studio/grading':'/grading/queue',
      '/studio/grading/assignments/:id':'/grading/assignments/:id',
      '/studio/grading/exams/:id':'/grading/exams/:id',
      '/studio/submissions':'/grading/queue',
      '/studio/assessments':'/grading/assessments',
      '/studio/exams':'/grading/assessments',
      '/studio/analytics':'/grading/reports',
      '/admin/submissions':'/grading/queue',
      '/admin/exams':'/grading/assessments',
      '/admin/analytics':'/grading/reports',
      '/studio/enrollment-migration':'/admin/enrollment-migration',
      '/studio/audit':'/admin/audit',
      '/studio/branches':'/admin/branches',
      '/studio/users':'/admin/users',
      '/admin/cms':'/studio/library',
      '/admin/reviews':'/studio/reviews',
    });
    expect(map.has('/admin/enrollment-migration')).toBe(false);
  });
});
