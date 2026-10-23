import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPublicPath, publicHref } from '@/features/public-site/public-navigation';
import { isPermission } from '@/lib/authorization';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('standalone Academy ownership', () => {
  it('retains complete learning, authoring, grading, administration and public APIs', () => {
    for (const path of [
      'src/app/(public)/courses/page.tsx', 'src/app/app/courses/[courseId]/items/[itemId]/page.tsx',
      'src/app/studio/courses/[courseId]/page.tsx', 'src/app/admin/users/page.tsx',
      'src/app/grading/page.tsx', 'src/app/api/v1/public/courses/route.ts',
      'src/app/api/mcp/route.ts', 'src/app/.well-known/oauth-protected-resource/route.ts',
      'src/content-engine/schema/bundle.ts', 'notebook-runtime/pyproject.toml',
    ]) expect(existsSync(join(process.cwd(), path)), path).toBe(true);
  });

  it('excludes Competition implementation, corporate landing and opposite-product migrations', () => {
    for (const path of ['src/features/competition', 'src/app/competition', 'tests/features/competition', 'src/features/labs', 'docs/competition']) {
      expect(existsSync(join(process.cwd(), path)), path).toBe(false);
    }
    const migrations = readdirSync(join(process.cwd(), 'supabase/migrations'));
    expect(migrations).toContain('0001_identity.sql');
    expect(migrations).toContain('20260926000000_studio_mcp_access_blocks.sql');
    expect(migrations.some((file) => file.includes('competition'))).toBe(false);
    expect(isPermission('competition.manage')).toBe(false);
    expect(isPermission('grading.manage')).toBe(true);
  });

  it('owns the Academy gateway at root and redirects the historical alias with browsing context', () => {
    expect(source('src/app/(public)/page.tsx')).toContain('AcademyGateway');
    expect(source('src/app/(public)/page.tsx')).toContain("pathname: '/'");
    expect(source('src/app/(public)/academy/page.tsx')).toContain("publicHref('/'");
    expect(publicHref('/', 'en', { pathway: 'research-innovation', lang: 'en' })).toBe('/?pathway=research-innovation&lang=en');
    expect(isPublicPath('/competition')).toBe(false);
  });

  it('keeps notebook isolation and independent cross-product links while removing event middleware', () => {
    const middleware = source('src/middleware.ts');
    expect(middleware).toContain('updateSession(request)');
    expect(middleware).toContain('Cross-Origin-Embedder-Policy');
    expect(middleware).not.toContain('competition');
    const header = source('src/features/public-site/AcademyHeader.tsx');
    expect(header).toContain('href: CENTRAL_URL');
    expect(header).toContain('href: COMPETITION_URL');
    expect(source('.env.example')).toContain('SUPABASE_PRODUCTION_PROJECT_REF=');
  });
});
