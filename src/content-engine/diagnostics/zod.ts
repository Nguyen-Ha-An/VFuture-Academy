import type { z } from 'zod';
import { makeDiagnostic } from './messages';
import type { Diagnostic } from './types';
import type { DiagnosticCode } from './codes';
import { toRef, type DocumentRef } from './refs';

export const toPointer = (path: readonly PropertyKey[]) => path.map((s) => '/' + String(s).replace(/~/g, '~0').replace(/\//g, '~1')).join('');
export const fromPointer = (pointer: string): (string | number)[] => pointer === '' ? [] : pointer.slice(1).split('/').map((s) => { const u = s.replace(/~1/g, '/').replace(/~0/g, '~'); return /^\d+$/.test(u) ? Number(u) : u; });

/** Refinement messages that deserve a dedicated code. */
const REFINE_CODE_MAP: Record<string, DiagnosticCode> = {
  'embed host is not allowlisted': 'E_EMBED_HOST_NOT_ALLOWED',
  'id must be kebab-case: a-z, 0-9, "-", max 64 chars': 'E_ID_FORMAT',
};

type Issue = z.core.$ZodIssue & { errors?: Issue[][]; issues?: Issue[] };

/** Branch issue paths are relative to the union node, so carry the union's own path down into them. */
function flatten(issues: Issue[], prefix: readonly PropertyKey[] = []): Issue[] {
  const out: Issue[] = [];
  for (const issue of issues) {
    const path = [...prefix, ...issue.path];
    if (issue.code === 'invalid_union' && Array.isArray(issue.errors) && issue.errors.length) {
      const branches = issue.errors.map((b) => flatten(b, path));
      const noDiscriminator = branches.filter((b) => !b.some((i) => ['type', 'kind', 'scope'].includes(String(i.path.at(-1)))));
      const pool = noDiscriminator.length ? noDiscriminator : branches;
      pool.sort((a, b) => a.length - b.length);
      out.push(...pool[0]);
    } else out.push({ ...issue, path } as Issue);
  }
  return out;
}

export function fromZodError(error: z.ZodError, doc: string | DocumentRef, basePath: readonly PropertyKey[] = []): Diagnostic[] {
  const ref = toRef(doc);
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const issue of flatten(error.issues as Issue[], basePath)) {
    const path = toPointer(issue.path);
    const key = `${path}|${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mapped = REFINE_CODE_MAP[issue.message];
    const host = issue.message.includes('host') && typeof (issue as { input?: unknown }).input === 'string' ? safeHost((issue as { input: string }).input) : undefined;
    out.push(makeDiagnostic(mapped ?? 'E_SCHEMA', { ref, path, meta: { detail: issue.message, zod: issue.code, ...(host ? { host } : {}) } }));
  }
  return out;
}
function safeHost(u: string) { try { return new URL(u).hostname; } catch { return u; } }
