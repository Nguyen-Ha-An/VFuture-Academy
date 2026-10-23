import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'src', 'content-engine');
const FORBIDDEN_EVERYWHERE = [/from\s+['"]next(\/|['"])/, /from\s+['"]@supabase\//, /from\s+['"]@\/app\//, /from\s+['"]@\/features\//, /from\s+['"]@\/lib\//];
const FORBIDDEN_OUTSIDE_RENDER = [/from\s+['"]react(-dom)?(\/|['"])/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : [];
  });
}

describe('content-engine import boundary', () => {
  it('has an index.ts entry point', () => {
    expect(statSync(join(ROOT, 'index.ts')).isFile()).toBe(true);
  });
  it('never imports next, supabase or app layers; react only under render/', () => {
    const offenders: string[] = [];
    for (const file of files(ROOT)) {
      const src = readFileSync(file, 'utf8');
      const rel = relative(ROOT, file).replaceAll('\\', '/');
      for (const re of FORBIDDEN_EVERYWHERE) if (re.test(src)) offenders.push(`${rel}: ${re}`);
      if (!rel.startsWith('render/')) for (const re of FORBIDDEN_OUTSIDE_RENDER) if (re.test(src)) offenders.push(`${rel}: ${re}`);
    }
    expect(offenders).toEqual([]);
  });
});
