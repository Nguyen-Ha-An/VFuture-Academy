import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = join(process.cwd(), 'scripts', 'expire-orphan-uploads.ts');

describe('expire-orphan-uploads skeleton', () => {
  it('scopes candidates to old unreferenced submission assets and keeps deletion disabled', () => {
    expect(existsSync(scriptPath)).toBe(true);
    const source = existsSync(scriptPath) ? readFileSync(scriptPath, 'utf8') : '';

    expect(source).toMatch(/media_assets/);
    expect(source).toMatch(/submission_files/);
    expect(source).toMatch(/item_id/);
    expect(source).toMatch(/created_at/);
    expect(source).toMatch(/dry.run|deletion is intentionally disabled/i);
  });
});
