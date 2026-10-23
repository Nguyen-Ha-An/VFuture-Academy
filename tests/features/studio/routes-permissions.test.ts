import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const apiRouteRoot = join(process.cwd(), 'src', 'app', 'api', 'v1');
const routeRoot = join(apiRouteRoot, 'studio');
const nonLearnerRoute = /^(admin\/|analytics\/|certificates\/verify\/|grading\/|internal\/|notebooks\/submissions\/|public\/|schema\/|studio\/|u\/)/;
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
