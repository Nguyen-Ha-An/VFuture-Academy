import type { DocumentRef } from '@/content-engine/diagnostics';
import { parseJsonDocument } from '@/content-engine/validate';
import { record } from './workspace-state';

/** The visual editor reads and writes the same strict raw document as the JSON pane. */
export function visualDocument(source: string, ref: DocumentRef): Record<string, unknown> | null {
  const parsed = parseJsonDocument(source, ref);
  return parsed.errors.length ? null : record(parsed.value);
}

export type AuthoringSchema = {
  $ref?: string; $defs?: Record<string, AuthoringSchema>;
  type?: string | string[]; const?: unknown; enum?: unknown[];
  anyOf?: AuthoringSchema[]; oneOf?: AuthoringSchema[];
  properties?: Record<string, AuthoringSchema>; required?: string[];
  items?: AuthoringSchema; additionalProperties?: AuthoringSchema | boolean;
  minItems?: number; maxItems?: number; minimum?: number; maximum?: number;
  minLength?: number; maxLength?: number; description?: string;
};

export function resolveAuthoringSchema(schema: AuthoringSchema, root: AuthoringSchema): AuthoringSchema {
  let result = schema;
  const seen = new Set<string>();
  while (result.$ref?.startsWith('#/') && !seen.has(result.$ref)) {
    seen.add(result.$ref);
    const target = result.$ref.slice(2).split('/').reduce<unknown>((node, part) => record(node)?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], root);
    if (!record(target)) break;
    result = { ...result, ...target as AuthoringSchema, $ref: undefined };
  }
  return result;
}

export function schemaVariants(schema: AuthoringSchema, root: AuthoringSchema): AuthoringSchema[] {
  const resolved = resolveAuthoringSchema(schema, root);
  const options = resolved.anyOf ?? resolved.oneOf;
  return options ? options.flatMap(option => schemaVariants(option, root)) : [resolved];
}

export function schemaVariantLabel(schema: AuthoringSchema): string {
  const type = schema.properties?.type?.const;
  if (typeof type === 'string') return type.replaceAll('_', ' ');
  if (schema.const !== undefined) return String(schema.const);
  return schema.type === 'object' ? Object.keys(schema.properties ?? {}).join(' / ') : String(schema.type ?? 'value');
}

export function matchingSchema(schema: AuthoringSchema, root: AuthoringSchema, value: unknown): AuthoringSchema {
  const options = schemaVariants(schema, root);
  const score = (candidate: AuthoringSchema): number => {
    if (candidate.const !== undefined) return candidate.const === value ? 100 : -100;
    if (candidate.enum) return candidate.enum.includes(value) ? 20 : -100;
    const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    if (candidate.type && candidate.type !== type && !(type === 'number' && candidate.type === 'integer')) return -100;
    const row = record(value);
    if (!row) return 0;
    let points = 0;
    for (const [key, child] of Object.entries(candidate.properties ?? {})) {
      const resolved = resolveAuthoringSchema(child, root);
      if (resolved.const !== undefined) { if (row[key] !== resolved.const) return -100; points += 100; }
      if (Object.hasOwn(row, key)) points += 2;
    }
    for (const key of candidate.required ?? []) if (!Object.hasOwn(row, key)) points -= 5;
    for (const key of Object.keys(row)) if (!Object.hasOwn(candidate.properties ?? {}, key) && candidate.additionalProperties === false) points -= 20;
    return points;
  };
  return options.reduce((best, option) => score(option) > score(best) ? option : best, options[0] ?? {});
}

/** IDs are generated only for a deliberate Add action; existing values never pass through this. */
export function createAuthoringValue(schema: AuthoringSchema, root: AuthoringSchema, freshId: () => string, depth = 0): unknown {
  const node = schemaVariants(schema, root)[0] ?? {};
  if (node.const !== undefined) return node.const;
  if (node.enum?.length) return node.enum[0];
  if (node.type === 'object') return Object.fromEntries((node.required ?? []).map(key => [key,
    key === 'id' ? freshId() : depth > 14 ? null : createAuthoringValue(node.properties?.[key] ?? {}, root, freshId, depth + 1),
  ]));
  if (node.type === 'array') return Array.from({ length: Math.min(node.minItems ?? 0, 20) }, () => depth > 14 ? null : createAuthoringValue(node.items ?? {}, root, freshId, depth + 1));
  if (node.type === 'boolean') return false;
  if (node.type === 'number' || node.type === 'integer') return node.minimum ?? 0;
  if (node.type === 'null') return null;
  return '';
}

/** A stale visual event cannot erase newer raw edits, including malformed or duplicate-key JSON. */
export function visualSourceChange(currentSource: string, expectedSource: string, ref: DocumentRef, value: unknown): string | null {
  if (currentSource !== expectedSource) return null;
  const previous = visualDocument(currentSource, ref);
  const next = record(value);
  if (!previous || !next || next.id !== previous.id || next.kind !== previous.kind || next.schemaVersion !== previous.schemaVersion || next.type !== previous.type) return null;
  return JSON.stringify(next, null, 2);
}
