import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'src/features/studio-mcp');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('Studio MCP read-only import boundary', () => {
  it('keeps service credentials and mutation helpers out of tools and validators', () => {
    const facade = 'db/read-only-database.ts';
    for (const file of sourceFiles(root)) {
      const name = relative(root, file);
      const text = readFileSync(file, 'utf8');
      if (name === facade) continue;
      expect(text, `${name} imports a service client`).not.toMatch(/(?:from\s*|import\s*\()['"]@\/lib\/supabase\//);
      expect(text, `${name} accesses audit_log`).not.toMatch(/\.from\(['"]audit_log['"]\)/);
      expect(text, `${name} invokes a content write`).not.toMatch(/\b(?:saveWorkspace|saveManifest|saveItem|deleteItem|importSingle|importNewCourse|importBundle|publishPreparedCourse|restoreAsDraft)\s*\(/);
    }
    const facadeText = readFileSync(join(root, facade), 'utf8');
    expect(facadeText).toContain('new McpWriteAttemptError()');
    expect(facadeText).toContain("'rate_limit'");
  });
});
