import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildContentSecurityPolicy } from '@/lib/security-headers';

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('request-size platform hardening', () => {
  it('does not cache HTML route modules while the production nonce CSP is active', () => {
    expect(buildContentSecurityPolicy({ nodeEnv: 'production', nonce: 'route-nonce' }))
      .toContain("'strict-dynamic'");

    for (const path of sourceFiles(join(process.cwd(), 'src', 'app'))) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/export\s+const\s+revalidate\b/);
    }
  });

  it('keeps runtime-origin metadata routes dynamic for credential-free builds', () => {
    for (const route of ['src/app/robots.ts', 'src/app/sitemap.ts']) {
      expect(readFileSync(join(process.cwd(), ...route.split('/')), 'utf8'), route)
        .toMatch(/export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/);
    }
  });

  it('caps Next.js server action bodies at the largest accepted upload size', () => {
    const source = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');

    expect(source).toMatch(/serverActions\s*:\s*\{\s*bodySizeLimit\s*:\s*['"]50mb['"]/);
  });

  it('documents the matching reverse-proxy body ceiling', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');

    expect(readme).toContain('client_max_body_size 50m;');
  });

  it('keeps GitHub deployment free of validation jobs and application secrets', () => {
    const workflows = readdirSync(join(process.cwd(), '.github', 'workflows'));
    expect(workflows).toEqual(['deploy.yaml']);
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/deploy.yaml'), 'utf8');
    expect(workflow).toContain('vercel deploy --yes --prod');
    expect(workflow).not.toMatch(/SUPABASE_|SEED_|playwright|vitest|npm run (?:migrate|test|typecheck|lint|verify)/);
  });

  it('runs the secret-free Studio and other browser harnesses in the mandatory local gate', () => {
    const local = readFileSync(join(process.cwd(), 'scripts/verify-local.mjs'), 'utf8');
    expect(local).toContain("process.env.GITHUB_ACTIONS === 'true'");
    expect(local).toContain("'graphify:check', 'typecheck', 'verify:azure', 'lint'");
    expect(local).toContain("['studio', 'admin', 'student', 'student-runtime'");
    expect(local).toContain("'--maxWorkers=2'");
    expect(local).toContain("'--ignore-scripts'");
    expect(local).not.toContain('competition-database');
    const studio = readFileSync(join(process.cwd(), 'playwright.studio.config.ts'), 'utf8');
    expect(studio).not.toContain('SEED_');
    expect(studio).not.toContain('SUPABASE_');
  });

  it('documents local seeded accounts and keeps destructive resets opt-in', () => {
    const example = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
    for (const variable of ['SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'SEED_E2E_LEARNER_EMAIL', 'SEED_LEARNER_PASSWORD', 'SEED_E2E_INSTRUCTOR_EMAIL', 'SEED_INSTRUCTOR_PASSWORD', 'SEED_DEV_PROJECT_REF']) {
      expect(example).toContain(`${variable}=`);
    }
    expect(example).toContain('# E2E_RESET_SEEDED_LEARNERS=1');
    expect(example).not.toMatch(/^E2E_RESET_SEEDED_LEARNERS=1$/m);
  });

  it('uses production Playwright serving, retains failure artifacts, and declares its env loader', () => {
    const config = readFileSync(join(process.cwd(), 'playwright.config.ts'), 'utf8');
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      devDependencies?: Record<string, string>;
    };

    expect(config).toContain('trace: "retain-on-failure"');
    expect(config).toContain('screenshot: "only-on-failure"');
    const target = readFileSync(join(process.cwd(), 'scripts/lib/playwright-target.ts'), 'utf8');
    expect(config).toContain('playwrightTarget(process.env)');
    expect(target).toMatch(/PLAYWRIGHT_WEB_SERVER[\s\S]*npm run dev[\s\S]*npm run build && npm run start/);
    expect(packageJson.devDependencies?.['@next/env']).toBeDefined();
  });

  it('keeps destructive seeded-learner resets opt-in in the example environment', () => {
    const example = readFileSync(join(process.cwd(), '.env.example'), 'utf8');

    expect(example).toContain('# E2E_RESET_SEEDED_LEARNERS=1');
    expect(example).not.toMatch(/^E2E_RESET_SEEDED_LEARNERS=1$/m);
  });

  it('uses the shared PostgreSQL limiter on learner mutation routes instead of process-local stopgaps', () => {
    const routes = [
      'src/app/api/v1/quizzes/check/route.ts',
      'src/app/api/v1/quizzes/submit/route.ts',
      'src/app/api/v1/exams/[itemId]/attempts/route.ts',
      'src/app/api/v1/exams/attempts/[attemptId]/answers/route.ts',
      'src/app/api/v1/exams/attempts/[attemptId]/events/route.ts',
      'src/app/api/v1/exams/attempts/[attemptId]/submit/route.ts',
      'src/app/api/v1/progress/blocks/[blockId]/route.ts',
      'src/app/api/v1/progress/viewed/route.ts',
      'src/app/api/v1/profile/handle/route.ts',
      'src/app/api/v1/projects/[id]/interest/route.ts',
      'src/app/api/v1/uploads/reserve/route.ts',
    ];

    for (const route of routes) {
      const source = readFileSync(join(process.cwd(), ...route.split('/')), 'utf8');
      expect(source, route).toContain("from '@/lib/rate-limit'");
      expect(source, route).toMatch(/await\s+enforceRateLimit\s*\(/);
      expect(source, route).not.toMatch(/@\/features\/(?:quizzes|exams|progress|profile|projects)\/rate-limit/);
    }
  });
});
