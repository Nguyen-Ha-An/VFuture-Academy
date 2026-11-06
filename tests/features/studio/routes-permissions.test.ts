import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const apiRouteRoot = join(process.cwd(), 'src', 'app', 'api', 'v1');
const routeRoot = join(apiRouteRoot, 'studio');
const nonLearnerRoute = /^(admin\/|analytics\/|certificates\/verify\/|grading\/|internal\/|notebooks\/submissions\/|public\/|schema\/|studio\/|teaching\/|u\/)/;
const requiredRoutes = [
  ['courses/route.ts', ['course.read', 'course.create']],
  ['courses/[courseId]/draft/route.ts', ['course.read', 'course.edit']],
  ['courses/[courseId]/draft/items/[itemId]/route.ts', ['course.edit', 'course.edit']],
  ['courses/[courseId]/draft/import/route.ts', ['course.edit']],
  ['courses/[courseId]/draft/validate/route.ts', ['course.read']],
  ['courses/[courseId]/draft/preview/[itemId]/route.ts', ['course.edit']],
  ['courses/[courseId]/publish/route.ts', ['course.publish']],
  ['courses/[courseId]/versions/route.ts', ['course.read']],
  ['courses/[courseId]/versions/[v]/restore/route.ts', ['course.edit']],
  ['courses/[courseId]/export/route.ts', ['course.read']],
  ['courses/[courseId]/enrollments/migrate/route.ts', ['course.publish']],
  ['prompt-pack/route.ts', ['course.read']],
  ['bank/validate/route.ts', ['bank.edit']],
  ['resources/route.ts', ['resource.edit', 'resource.edit']],
  ['resources/[id]/route.ts', ['resource.edit', 'resource.edit']],
  ['resources/[id]/publish/route.ts', ['resource.publish']],
  ['opportunities/route.ts', ['opportunity.edit', 'opportunity.edit']],
  ['opportunities/[id]/route.ts', ['opportunity.edit', 'opportunity.edit']],
  ['opportunities/[id]/publish/route.ts', ['opportunity.publish']],
] as const;

const branchScopedPermissions = new Set([
  'submission.grade',
  'teaching.assignment.manage',
  'teaching.scope.all',
  'teaching.announcement.manage',
  'teaching.schedule.manage',
  'exam.release',
  'user.manage.branch',
  'analytics.branch.read',
]);

function routeFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.isFile() && entry.name === 'route.ts' ? [path] : [];
  });
}

function reexportTarget(source: string): string | null {
  const match = source.match(/export\s*{[^}]+}\s*from\s*['"]@\/([^'"]+)['"]/);
  return match ? join(process.cwd(), 'src', `${match[1]}.ts`) : null;
}

function guardedRouteSource(path: string, visited = new Set<string>()): string {
  expect(visited.has(path), `circular route re-export: ${path}`).toBe(false);
  visited.add(path);
  const source = readFileSync(path, 'utf8');
  if (source.includes('notebookHandler')) {
    const studio = path.includes('/studio/notebooks/');
    expect(source, path).toMatch(studio ? /notebookHandler\s*\([^,]+,\s*true\s*\)/ : /notebookHandler\s*\([^,]+,\s*false\s*\)/);
    return source + '\n' + readFileSync(join(process.cwd(), 'src/features/notebooks/handlers.ts'), 'utf8')
      + '\n' + readFileSync(join(process.cwd(), 'src/features/notebooks/access.ts'), 'utf8');
  }
  const target = reexportTarget(source);
  if (!target) return source;
  expect(existsSync(target), `${path}: missing re-export target ${target}`).toBe(true);
  return guardedRouteSource(target, visited);
}

describe('Studio route authorization boundary', () => {
  it('follows Studio route re-exports to a handler guarded by a trusted server context', () => {
    const routes = routeFiles(routeRoot);

    expect(routes.length).toBeGreaterThan(0);
    for (const path of routes) {
      const source = guardedRouteSource(path);
      expect(source, path).toMatch(/withHandler\s*\(/);
      expect(source, path).toMatch(/authorizeStudioNotebook\s*\(|requirePermission\s*\(|requireSubmissionGrader\s*\(|getActor\s*\(|getAdminContext\s*\(|getAdminWorkspaceContext\s*\(|getWorkspaceContext\s*\(|getStudioContext\s*\(|getGradingContext\s*\(|legacyAdminContext\s*\(|contentReviewContext\s*\(|typedContentContext\s*\(|scopedContentContext\s*\(/);
    }
  });

  it('wraps every v1 API route with withHandler after resolving a local re-export', () => {
    const routes = routeFiles(apiRouteRoot);

    expect(routes.length).toBeGreaterThan(0);
    for (const path of routes) {
      expect(guardedRouteSource(path), path).toMatch(/withHandler\s*\(/);
    }
  });

  it('calls requireApiUser in every learner route', () => {
    const routes = routeFiles(apiRouteRoot);

    for (const path of routes) {
      const relative = path.slice(apiRouteRoot.length + 1).replaceAll('\\', '/');
      if (nonLearnerRoute.test(relative)) continue;
      const source = guardedRouteSource(path);
      const authImport = source.match(/import\s*{([^}]*)}\s*from\s*['"]@\/lib\/auth['"]/)?.[1] ?? '';
      const requireUserSpecifier = authImport.split(',')
        .map((specifier) => specifier.trim())
        .find((specifier) => /^requireApiUser(?:\s+as\s+\w+)?$/.test(specifier));
      expect(requireUserSpecifier, `${relative}: missing requireApiUser import`).toBeDefined();
      const binding = requireUserSpecifier?.match(/\bas\s+(\w+)$/)?.[1] ?? 'requireApiUser';
      expect(source, `${relative}: imported ${binding} is not called`).toMatch(new RegExp(`\\b${binding}\\s*\\(`));
    }
  });

  it('guards each teaching route according to its capability and learner-read contract', () => {
    const teachingRoot = join(apiRouteRoot, 'teaching');
    const routes = routeFiles(teachingRoot);
    expect(routes.length).toBeGreaterThan(0);
    for (const path of routes) {
      const relative = path.slice(teachingRoot.length + 1).replaceAll('\\', '/');
      const source = guardedRouteSource(path);
      if (relative.startsWith('announcements/')) {
        expect(source, path).toMatch(/requirePermission\s*\(\s*['"]teaching\.announcement\.manage['"]\s*,\s*{branchId:/);
      } else if (relative === 'schedules/route.ts') {
        expect(source, path).toMatch(/requirePermission\s*\(\s*['"]teaching\.schedule\.manage['"]\s*,\s*{branchId:/);
      } else if (relative === 'options/route.ts') {
        expect(source, path).toMatch(/await getActor\(\)/);
        expect(source, path).toMatch(/if\s*\(!actor\)\s*throw new ApiError\(401/);
        for (const permission of ['assignment', 'schedule', 'announcement']) {
          expect(source, path).toContain(`hasPermission(actor,'teaching.${permission}.manage',{branchId})`);
        }
        expect(source, path).toContain('teachingOptions(actor, branchId, locale)');
      } else if (relative === 'teacher-options/route.ts') {
        expect(source, path).toMatch(/requirePermission\(['"]teaching\.assignment\.manage['"],\s*{\s*branchId\s*}/);
        expect(source, path).toContain('teacherOptions(actor, branchId, page, pageSize)');
        expect(source, path).not.toMatch(/export const (POST|PUT|PATCH|DELETE)/);
      } else if (relative === 'courses/[courseId]/teachers/route.ts') {
        // GET permits an enrolled learner; SQL must resolve their historical
        // branch. PUT independently requires management at its body branch.
        expect(source, path).toMatch(/await getActor\(\)/);
        expect(source, path).toMatch(/if\s*\(!actor\)\s*throw new ApiError\(401/);
        expect(source, path).toContain('getCourseTeachers(actor, courseId, branchId)');
        expect(source, path).toMatch(/export const PUT = withHandler/);
        expect(source, path).toMatch(/requirePermission\(['"]teaching\.assignment\.manage['"],\s*{\s*branchId: input\.branchId\s*}/);
        expect(source, path).toContain('replaceCourseTeachers(actor, courseId, input)');
      } else if (relative === 'assigned-courses/route.ts') {
        // Own assignments are available to any live actor; ordinary learners
        // receive an empty list rather than needing a teaching permission.
        expect(source, path).toMatch(/await getActor\(\)/);
        expect(source, path).toMatch(/if\s*\(!actor\)\s*throw new ApiError\(401/);
        expect(source, path).toContain('assignedCourses(actor, locale)');
        expect(source, path).not.toMatch(/export const (POST|PUT|PATCH|DELETE)/);
      } else {
        throw new Error(`Teaching route needs an explicit authorization contract: ${relative}`);
      }
    }
  });

  it('binds assignment API services to actor-aware authoritative SQL RPCs', () => {
    const service = readFileSync(join(process.cwd(), 'src/features/teaching/assignments.ts'), 'utf8');
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261106010000_course_teaching_assignments.sql'), 'utf8');
    for (const rpc of ['teaching_course_teachers', 'replace_course_teachers', 'teaching_teacher_options', 'teaching_assigned_courses']) {
      expect(service).toMatch(new RegExp(`\\.rpc\\('${rpc}', \\{\\s*p_actor_id: actor\\.userId`));
    }
    expect(sql).toContain("authorization_assert_actor(p_actor_id,'teaching.assignment.manage','branch',p_branch_id)");
    expect(sql).toContain('e.user_id=p_actor_id and e.course_id=p_course_id');
    expect(sql).toContain('case when e.branch_scope_known then e.branch_id else null end');
    expect(sql).toContain('where a.user_id=p_actor_id and public.teaching_candidate(a.user_id,a.branch_id)');
    expect(sql).toContain('public.teaching_assigned_courses(uuid,text) from public,anon,authenticated');
    expect(sql).toContain('public.teaching_assigned_courses(uuid,text) to service_role');
  });

  it('keeps the grading namespace outside learner authentication and behind the grading workspace guard', () => {
    const gradingRoutes = routeFiles(join(apiRouteRoot, 'grading'));

    expect(gradingRoutes.length).toBeGreaterThan(0);
    for (const path of gradingRoutes) {
      const source = guardedRouteSource(path);
      expect(source, path).toMatch(/withHandler\s*\(/);
      expect(source, path).toMatch(/getGradingContext\s*\(/);
    }
  });

  it('keeps the explicit Admin namespace outside learner authentication and behind a server-side Admin guard', () => {
    const adminRoutes = routeFiles(join(apiRouteRoot, 'admin'));

    expect(adminRoutes.length).toBeGreaterThan(0);
    for (const path of adminRoutes) {
      const source = guardedRouteSource(path);
      // Scope selection is shared by the destination-authorized shell; its
      // handler validates the requested scope against that context's options.
      if (path === join(apiRouteRoot, 'admin', 'scope', 'route.ts')) {
        expect(source, path).toMatch(/getAdminWorkspaceContext\s*\(/);
        continue;
      }
      expect(source, path).toMatch(/getAdminContext\s*\(|getActor\s*\(|contentReviewContext\s*\(/);
    }
  });

  it.each(requiredRoutes)('%s exists and checks its exact permissions inside withHandler', (relativePath, expectedPermissions) => {
    const path = join(routeRoot, ...relativePath.split('/'));

    expect(existsSync(path), `missing ${relativePath}`).toBe(true);
    const source = existsSync(path) ? readFileSync(path, 'utf8') : '';
    expect(source).toMatch(/withHandler\s*\(/);
    const permissions = [
      ...source.matchAll(/requirePermission\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...source.matchAll(/assertAdminPermission\s*\(\s*[^,]+,\s*['"]([^'"]+)['"]\s*\)/g),
      ...source.matchAll(/scopedContentContext\s*\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*['"]([^'"]+)['"]/g),
      ...source.matchAll(/typedContentContext\s*\(\s*[^,]+,\s*[^,]+,\s*['"]([^'"]+)['"]/g),
    ].map((match) => match[1]);
    expect(permissions).toEqual(expectedPermissions);
  });

  it('passes a scope in every route call for a branch-scoped permission', () => {
    const routes = routeFiles(apiRouteRoot);

    expect(routes.length).toBeGreaterThan(0);
    for (const path of routes) {
      const source = readFileSync(path, 'utf8');
      const calls = source.matchAll(/requirePermission\s*\(\s*['"]([^'"]+)['"]([^)]*)\)/g);
      for (const [, permission, trailingArguments] of calls) {
        if (!branchScopedPermissions.has(permission)) continue;
        expect(trailingArguments, `${path}: ${permission} requires a scope`).toMatch(/^\s*,/);
      }
    }
  });
});
