import { describe, expect, it } from 'vitest';
import { adminNavigation, firstAdminDestination } from '@/lib/admin-navigation';
import { gradingNavigation, firstGradingDestination } from '@/lib/grading-navigation';
import { studioNavigation, firstStudioDestination } from '@/lib/studio-navigation';
import { workspaceNavigationFor } from '@/lib/workspace-navigation';

describe('central administration entry point', () => {
  it('requires independent Admin entry authority', () => {
    expect(firstAdminDestination(['submission.grade'])).toBeNull();
    expect(firstAdminDestination(['admin.access'])).toBe('/admin');
    expect(firstAdminDestination(['analytics.branch.read'])).toBeNull();
    expect(firstAdminDestination(['course.read'])).toBeNull();
    expect(firstAdminDestination([])).toBeNull();
  });

  it('keeps authoring and review in Studio', () => {
    expect(firstStudioDestination(['course.read', 'bank.edit'])).toBe('/studio/courses');
    expect(firstStudioDestination(['media.upload', 'bank.edit'])).toBe('/studio/library');
    expect(firstStudioDestination(['bank.edit'])).toBe('/studio/bank');
    expect(firstStudioDestination(['content.review'])).toBe('/studio/reviews');
    expect(firstStudioDestination([])).toBeNull();
  });

  it('never offers a grading or reporting destination inside Studio', () => {
    const paths = studioNavigation.map(item => item.href);
    expect(paths).toEqual(['/studio', '/studio/courses', '/studio/library', '/studio/bank', '/studio/reviews', '/studio/mcp']);
    expect(firstStudioDestination(['submission.grade'])).toBeNull();
    expect(firstStudioDestination(['exam.release'])).toBeNull();
    expect(firstStudioDestination(['report.branch.read'])).toBeNull();
    expect(firstStudioDestination(['audit.read'])).toBeNull();
  });

  it('lands a grader on the queue and a report-only operator on reports without admin.access', () => {
    expect(gradingNavigation.map(item => item.href))
      .toEqual(['/grading', '/grading/assessments', '/grading/queue', '/grading/reports']);
    expect(firstGradingDestination(['submission.grade'])).toBe('/grading/queue');
    expect(firstGradingDestination(['exam.release'])).toBe('/grading/assessments');
    expect(firstGradingDestination(['report.branch.read'])).toBe('/grading/reports');
    expect(firstGradingDestination(['analytics.global.read'])).toBe('/grading/reports');
    expect(firstGradingDestination(['admin.access'])).toBeNull();
    expect(firstGradingDestination(['learning.read'])).toBeNull();
    expect(firstGradingDestination([])).toBeNull();
  });

  it('keeps people, roles, enrollment versions and audit in Admin', () => {
    const paths = adminNavigation.map(item => item.href);
    expect(paths).toEqual(expect.arrayContaining([
      '/admin', '/admin/roles', '/admin/users', '/admin/branches',
      '/admin/enrollment-migration', '/admin/audit',
    ]));
    expect(paths).not.toContain('/admin/cms');
    expect(paths).not.toContain('/admin/reviews');
    expect(paths).not.toContain('/admin/analytics');
    expect(paths).not.toContain('/studio/courses');
    expect(paths).not.toContain('/grading/queue');
  });

  it('keeps the existing course.publish permission on enrollment-version migration', () => {
    const migration = adminNavigation.find(item => item.key === 'enrollmentMigration');
    expect(migration?.permissions).toEqual(['course.publish']);
  });

  it('shows MCP access administration only to global user managers', () => {
    const entry = adminNavigation.find(item => item.href === '/admin/mcp');
    expect(entry?.permissions).toEqual(['user.manage.global']);
    expect(workspaceNavigationFor('admin', ['user.manage.global']).some(item => item.href === '/admin/mcp')).toBe(true);
    expect(workspaceNavigationFor('admin', ['member.read']).some(item => item.href === '/admin/mcp')).toBe(false);
  });
});
