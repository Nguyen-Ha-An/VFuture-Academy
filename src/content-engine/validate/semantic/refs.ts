import { COURSE_REF, itemRef, makeDiagnostic, type Diagnostic, type DocumentRef } from '../../diagnostics';
import { bankIdOf, isPoolDraw, isQuestionRef, type PoolDraw, type Question } from '../../schema/questions';
import type { ParsedWorkspace } from '../workspace';
import { itemEntriesOf, walkBlocks } from '../walk';

export interface BankQuestionSnapshot { id: string; versionId: string; question: unknown; tags?: string[]; difficulty?: string; type: string }
export interface ReferenceResolver {
  bankQuestion(id: string): Promise<BankQuestionSnapshot | null>;
  bankCandidates(filter: { tags?: string[]; difficulty?: string[]; types?: string[] }): Promise<string[]>;
  asset(id: string): Promise<{ id: string; url: string; mime: string } | null>;
  resourceExists(id: string): Promise<boolean>;
  opportunityExists(id: string): Promise<boolean>;
  branchExists(id: string): Promise<boolean>;
}

/**
 * "The lookup failed" and "the thing does not exist" are different answers, and
 * conflating them is how an outage starts reading as a clean bill of health — or as a
 * pile of phantom missing references. A resolver returns `null`/`false` only when it
 * actually established absence, and throws this when it could not establish anything.
 */
export class ResolverUnavailableError extends Error {
  constructor(public readonly operation: string, options?: { cause?: unknown }) {
    super(`Reference lookup "${operation}" is unavailable`, options);
    this.name = 'ResolverUnavailableError';
  }
}

export class InMemoryResolver implements ReferenceResolver {
  constructor(private readonly data: { bank?: BankQuestionSnapshot[]; assets?: string[]; resources?: string[]; opportunities?: string[]; branches?: string[] }) {}
  async bankQuestion(id: string) { return this.data.bank?.find((q) => q.id === id) ?? null; }
  async bankCandidates(f: { tags?: string[]; difficulty?: string[]; types?: string[] }) {
    return (this.data.bank ?? []).filter((q) => (!f.tags || f.tags.some((t) => q.tags?.includes(t))) && (!f.difficulty || (q.difficulty && f.difficulty.includes(q.difficulty))) && (!f.types || f.types.includes(q.type))).map((q) => q.id);
  }
  async asset(id: string) { return this.data.assets?.includes(id) ? { id, url: `memory://${id}`, mime: 'application/octet-stream' } : null; }
  async resourceExists(id: string) { return !!this.data.resources?.includes(id); }
  async opportunityExists(id: string) { return !!this.data.opportunities?.includes(id); }
  async branchExists(id: string) { return !!this.data.branches?.includes(id); }
}

/**
 * Memoizes reference lookups for the lifetime of **one** operation — a single
 * validate, compile or publish. A workspace asks about the same asset dozens of
 * times; a long-lived cache would instead keep answering with a world that has since
 * changed, so callers create one of these per operation and then drop it.
 */
export function perOperationResolver(inner: ReferenceResolver): ReferenceResolver {
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    if (hit) return hit as Promise<T>;
    const pending = run();
    cache.set(key, pending);
    return pending;
  };
  return {
    bankQuestion: (id) => once(`bankQuestion:${id}`, () => inner.bankQuestion(id)),
    bankCandidates: (filter) => once(`bankCandidates:${JSON.stringify({ tags: filter.tags ?? null, difficulty: filter.difficulty ?? null, types: filter.types ?? null })}`, () => inner.bankCandidates(filter)),
    asset: (id) => once(`asset:${id}`, () => inner.asset(id)),
    resourceExists: (id) => once(`resourceExists:${id}`, () => inner.resourceExists(id)),
    opportunityExists: (id) => once(`opportunityExists:${id}`, () => inner.opportunityExists(id)),
    branchExists: (id) => once(`branchExists:${id}`, () => inner.branchExists(id)),
  };
}

type Lookup<T> = { known: true; value: T } | { known: false };

/** Collect every { assetId } reference with its pointer path. */
export function collectAssetRefs(value: unknown, path = ''): { id: string; path: string }[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => collectAssetRefs(v, `${path}/${i}`));
  if (typeof value !== 'object' || value === null) return [];
  const o = value as Record<string, unknown>;
  const own = [
    ...(typeof o.assetId === 'string' ? [{ id: o.assetId, path: `${path}/assetId` }] : []),
    ...(typeof o.templateAssetId === 'string' ? [{ id: o.templateAssetId, path: `${path}/templateAssetId` }] : []),
  ];
  return own.concat(Object.entries(o)
    .filter(([key]) => key !== 'assetId' && key !== 'templateAssetId')
    .flatMap(([k, v]) => collectAssetRefs(v, `${path}/${k}`)));
}

/**
 * Runs one resolver call. An outage is reported where it happened and yields
 * `known: false`, so the caller neither accepts the reference nor claims it is missing.
 */
export async function resolveOrReport<T>(
  out: Diagnostic[],
  where: { ref: DocumentRef; path: string },
  run: () => Promise<T>,
): Promise<Lookup<T>> {
  try {
    return { known: true, value: await run() };
  } catch (error) {
    if (error instanceof ResolverUnavailableError) {
      out.push(makeDiagnostic('E_REFERENCE_LOOKUP_FAILED', { ref: where.ref, path: where.path, meta: { operation: error.operation } }));
      return { known: false };
    }
    throw error;
  }
}

export async function checkReferences(parsed: ParsedWorkspace, resolver: ReferenceResolver): Promise<Diagnostic[]> {
  const out: Diagnostic[] = [];
  const { manifest, items } = parsed;
  const push = (code: Parameters<typeof makeDiagnostic>[0], ref: DocumentRef, path: string, meta: Record<string, string | number>) => out.push(makeDiagnostic(code, { ref, path, meta }));
  const missing = async (code: Parameters<typeof makeDiagnostic>[0], ref: DocumentRef, path: string, meta: Record<string, string | number>, run: () => Promise<boolean>) => {
    const result = await resolveOrReport(out, { ref, path }, run);
    if (result.known && !result.value) push(code, ref, path, meta);
  };

  if (manifest.access.scope === 'branches') {
    for (const [i, b] of manifest.access.branchIds.entries()) {
      await missing('E_BRANCH_UNKNOWN', COURSE_REF, `/access/branchIds/${i}`, { id: b }, () => resolver.branchExists(b));
    }
  }
  for (const [i, o] of (manifest.relatedOpportunities ?? []).entries()) {
    await missing('E_OPPORTUNITY_UNKNOWN', COURSE_REF, `/relatedOpportunities/${i}`, { id: o }, () => resolver.opportunityExists(o));
  }
  for (const { id, path } of collectAssetRefs(manifest)) {
    await missing('E_ASSET_UNKNOWN', COURSE_REF, path, { id }, async () => !!(await resolver.asset(id)));
  }

  for (const [docId, doc] of Object.entries(items)) {
    const ref = itemRef(docId);
    for (const { id, path } of collectAssetRefs(doc)) {
      await missing('E_ASSET_UNKNOWN', ref, path, { id }, async () => !!(await resolver.asset(id)));
    }
    if (doc.kind === 'lesson') {
      const pending: (() => Promise<void>)[] = [];
      walkBlocks(doc.blocks, '/blocks', ({ block, path }) => {
        if (block.type === 'resource_link') pending.push(() => missing('E_RESOURCE_UNKNOWN', ref, `${path}/resourceId`, { id: block.resourceId }, () => resolver.resourceExists(block.resourceId)));
        if (block.type === 'opportunity_link') pending.push(() => missing('E_OPPORTUNITY_UNKNOWN', ref, `${path}/opportunityId`, { id: block.opportunityId }, () => resolver.opportunityExists(block.opportunityId)));
        if (block.type === 'next_step' && block.target.kind === 'opportunity') {
          const target = block.target as { id: string };
          pending.push(() => missing('E_OPPORTUNITY_UNKNOWN', ref, `${path}/target/id`, { id: target.id }, () => resolver.opportunityExists(target.id)));
        }
      });
      for (const run of pending) await run();
    }
    for (const scope of itemEntriesOf(doc)) {
      // A pool cannot draw a question the same scope already pins, inline or by $ref.
      const takenIds = new Set(scope.entries.filter((e) => !isQuestionRef(e) && !isPoolDraw(e)).map((e) => (e as Question).id));
      for (const e of scope.entries) if (isQuestionRef(e)) takenIds.add(bankIdOf(e));
      for (const [i, e] of scope.entries.entries()) {
        const path = `${scope.path}/${i}`;
        if (isQuestionRef(e)) {
          const id = bankIdOf(e);
          await missing('E_REF_UNRESOLVED', ref, `${path}/$ref`, { id }, async () => !!(await resolver.bankQuestion(id)));
        }
        if (isPoolDraw(e)) {
          const pool = (e as PoolDraw).$pool;
          let candidates: string[] = [];
          let complete = true;
          if (pool.from) {
            for (const [j, refValue] of pool.from.entries()) {
              const id = refValue.slice(5);
              const found = await resolveOrReport(out, { ref, path: `${path}/$pool/from/${j}` }, () => resolver.bankQuestion(id));
              if (!found.known) { complete = false; continue; }
              if (found.value) candidates.push(id);
              else push('E_REF_UNRESOLVED', ref, `${path}/$pool/from/${j}`, { id });
            }
          } else if (pool.filter) {
            const found = await resolveOrReport(out, { ref, path: `${path}/$pool/filter` }, () => resolver.bankCandidates(pool.filter!));
            if (found.known) candidates = found.value;
            else complete = false;
          }
          candidates = candidates.filter((id) => !takenIds.has(id));
          // An incomplete candidate list cannot prove the pool is unsatisfiable; the
          // outage above is already the blocking error.
          if (complete && candidates.length < pool.count) push('E_POOL_UNSATISFIABLE', ref, `${path}/$pool/count`, { id: pool.id, expected: pool.count, received: candidates.length });
        }
      }
    }
  }
  return out;
}
