import { stableStringify } from '@/content-engine/compile/checksum';
import { COURSE_REF, itemRef, makeDiagnostic, refKey, type Diagnostic, type DocumentRef } from '@/content-engine/diagnostics';
import type { CourseDocument } from '@/content-engine/schema/course';
import { checkIds } from '@/content-engine/validate/semantic/ids';
import { ITEM_KINDS, type ItemDocument, type ParsedWorkspace } from '@/content-engine/validate/workspace';
import {
  analyzeWorkspaceSource, record, refFromSourceKey, workspaceRefs,
  type WorkspaceSnapshot, type WorkspaceSourceAnalysis, type WorkspaceState,
} from '../workspace-state';

export type WorkspaceAnalysis = { payload: WorkspaceSnapshot | null; diagnostics: Diagnostic[] };
export type WorkspaceAnalysisCache = {
  analyze: (state: WorkspaceState, ref: DocumentRef) => WorkspaceSourceAnalysis;
  stats: () => { hits: number; misses: number; size: number; limit: number };
};

function declaredKind(state: WorkspaceState, id: string): string {
  const modules = record(state.manifest)?.modules;
  if (!Array.isArray(modules)) return '';
  for (const moduleValue of modules) {
    const items = record(moduleValue)?.items;
    if (!Array.isArray(items)) continue;
    for (const itemValue of items) {
      const item = record(itemValue);
      if (item?.id === id && typeof item.type === 'string') return item.type;
    }
  }
  return '';
}

function sourceCacheKey(state: WorkspaceState, ref: DocumentRef): string {
  const source = state.sources[refKey(ref)] ?? '';
  if (ref.kind === 'course') return `${JSON.stringify(['course', state.courseId])}\u0000${source}`;
  const storedKind = record(state.items[ref.id])?.kind;
  const expectedKind = typeof storedKind === 'string' ? storedKind : declaredKind(state, ref.id);
  return `${JSON.stringify(['item', ref.id, expectedKind])}\u0000${source}`;
}

/** Cached parsed values are shared read-only; freezing prevents accidental mutation. */
function freezeJson(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) freezeJson(child, seen);
  Object.freeze(value);
}

export function createWorkspaceAnalysisCache(limit = 64): WorkspaceAnalysisCache {
  const maximum = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 64;
  const entries = new Map<string, WorkspaceSourceAnalysis>();
  let hits = 0;
  let misses = 0;
  return {
    analyze(state, ref) {
      const key = sourceCacheKey(state, ref);
      const cached = entries.get(key);
      if (cached) {
        hits += 1;
        entries.delete(key);
        entries.set(key, cached);
        return cached;
      }
      misses += 1;
      const analysis = analyzeWorkspaceSource(state, ref);
      freezeJson(analysis.value);
      entries.set(key, analysis);
      while (entries.size > maximum) entries.delete(entries.keys().next().value!);
      return analysis;
    },
    stats: () => ({ hits, misses, size: entries.size, limit: maximum }),
  };
}

const defaultCache = createWorkspaceAnalysisCache();

function declaredItems(manifest: CourseDocument): Array<{ id: string; type: string }> {
  return manifest.modules.flatMap(moduleValue => moduleValue.items.map(item => ({ id: item.id, type: item.type })));
}

function parsedFrom(sources: Map<string, WorkspaceSourceAnalysis>): ParsedWorkspace | null {
  if ([...sources.values()].some(value => value.diagnostics.length > 0)) return null;
  const manifest = sources.get(refKey(COURSE_REF))?.value as CourseDocument | undefined;
  if (!manifest) return null;

  const items = Object.create(null) as Record<string, ItemDocument>;
  for (const [key, analysis] of sources) {
    if (key === refKey(COURSE_REF)) continue;
    const ref = refFromSourceKey(key);
    const value = record(analysis.value);
    if (!ref || ref.kind !== 'item' || !value || !(ITEM_KINDS as readonly string[]).includes(String(value.kind))) return null;
    items[ref.id] = analysis.value as ItemDocument;
  }
  return { manifest, items, invalidItemIds: [] };
}

/** Builds a payload from cached parsed documents; workspace relations remain fresh. */
function payloadFrom(state: WorkspaceState, sources: Map<string, WorkspaceSourceAnalysis>): WorkspaceSnapshot | null {
  const parsed = parsedFrom(sources);
  if (!parsed || stableStringify(parsed.manifest) !== stableStringify(state.manifest)) return null;

  const declared = declaredItems(parsed.manifest);
  const declaredIds = new Set(declared.map(item => item.id));
  if (declared.some(item => !Object.hasOwn(parsed.items, item.id))) return null;
  if (Object.keys(parsed.items).some(id => !declaredIds.has(id))) return null;
  if (declared.some(item => record(parsed.items[item.id])?.kind !== item.type)) return null;
  if (checkIds(parsed).length > 0) return null;
  return { manifest: parsed.manifest, items: parsed.items, baseVersionId: state.baseVersionId };
}

/** Missing/orphan relations are recomputed even when every document is cached. */
function structureDiagnostics(sources: Map<string, WorkspaceSourceAnalysis>): Diagnostic[] {
  const manifestAnalysis = sources.get(refKey(COURSE_REF));
  if (!manifestAnalysis || manifestAnalysis.diagnostics.length > 0) return [];
  const manifest = manifestAnalysis.value as CourseDocument;
  const declared = new Map(declaredItems(manifest).map(item => [item.id, item.type]));
  const held = new Set([...sources.keys()].flatMap(key => {
    const ref = refFromSourceKey(key);
    return ref?.kind === 'item' ? [ref.id] : [];
  }));
  return [
    ...[...declared].filter(([id]) => !held.has(id)).map(([id, type]) => makeDiagnostic('E_MISSING_ITEM_DOCUMENT', { ref: itemRef(id), path: '', meta: { id, type } })),
    ...[...held].filter(id => !declared.has(id)).map(id => makeDiagnostic('W_ORPHAN_ITEM_DOCUMENT', { ref: itemRef(id), path: '', meta: { id } })),
  ];
}

export function analyzeWorkspaceState(state: WorkspaceState, cache: WorkspaceAnalysisCache = defaultCache): WorkspaceAnalysis {
  const sources = new Map(workspaceRefs(state).map(ref => [refKey(ref), cache.analyze(state, ref)]));
  const parsed = parsedFrom(sources);
  return {
    payload: payloadFrom(state, sources),
    diagnostics: [
      ...[...sources.values()].flatMap(value => value.diagnostics),
      ...structureDiagnostics(sources),
      ...(parsed ? checkIds(parsed) : []),
    ],
  };
}

export type WorkspaceAnalysisRequest = { id: number; revision: string; state: WorkspaceState };
export type WorkspaceAnalysisResponse = { id: number; revision: string; analysis: WorkspaceAnalysis };
