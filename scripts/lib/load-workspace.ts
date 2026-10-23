import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { CourseWorkspace } from '../../src/content-engine/validate/workspace';
import { sourceKeyOf, splitInlineCourse } from '../../src/content-engine/validate/workspace';
import { CourseDocumentSchema, isInlineItem } from '../../src/content-engine/schema/course';
import { InMemoryResolver, type ReferenceResolver } from '../../src/content-engine/validate/semantic/refs';
import { fixtureResolver } from '../../src/content-engine/fixtures/resolver';
import { documentSizeDiagnostics, MAX_DOCUMENT_BYTES, parseJsonDocument, parseJsonEnvelope, utf8ByteLength } from '../../src/content-engine/validate/parse';
import { COURSE_REF, itemRef, makeDiagnostic, type Diagnostic } from '../../src/content-engine/diagnostics';

export function loadWorkspaceFromPath(path: string): CourseWorkspace & { sources: Record<string, string> } {
  const courseKey = sourceKeyOf(COURSE_REF);
  if (statSync(path).isDirectory()) {
    const manifestText = readFileSync(join(path, 'course.json'), 'utf8');
    const manifest = parseJsonDocument(manifestText, COURSE_REF);
    const items: Record<string, unknown> = {};
    const sources: Record<string, string> = { [courseKey]: manifestText };
    const parseDiagnostics: Diagnostic[] = [...manifest.errors];
    const itemsDir = join(path, 'items');
    if (existsSync(itemsDir)) {
      for (const file of readdirSync(itemsDir).filter((f) => f.endsWith('.json')).sort()) {
        const text = readFileSync(join(itemsDir, file), 'utf8');
        const fallbackId = basename(file, '.json');
        const parsed = parseJsonDocument(text, itemRef(fallbackId));
        parseDiagnostics.push(...parsed.errors);
        if (parsed.value === undefined) { sources[sourceKeyOf(itemRef(fallbackId))] = text; continue; }
        const doc = parsed.value as { id?: unknown };
        const id = typeof doc.id === 'string' && doc.id ? doc.id : fallbackId;
        // Two files claiming the same id would otherwise let the later one win and
        // take the earlier document's source with it.
        if (Object.hasOwn(items, id)) {
          parseDiagnostics.push(makeDiagnostic('E_DUPLICATE_ITEM_DOCUMENT', { ref: itemRef(id), path: '/id', meta: { id } }));
          continue;
        }
        items[id] = doc;
        sources[sourceKeyOf(itemRef(id))] = text;
      }
    }
    return { manifest: manifest.value, items, sources, ...(parseDiagnostics.length ? { parseDiagnostics } : {}) };
  }

  // A single file is either a workspace envelope or one inline course document. The
  // envelope legitimately exceeds one document's byte limit, so it gets the envelope
  // budget with identical strictness.
  const text = readFileSync(path, 'utf8');
  const parsedRaw = parseJsonEnvelope(text, COURSE_REF);
  if (parsedRaw.errors.length) return { manifest: undefined, items: {}, sources: { [courseKey]: text }, parseDiagnostics: parsedRaw.errors };
  const raw = parsedRaw.value as Record<string, unknown>;
  if (Object.hasOwn(raw, 'manifest') && Object.hasOwn(raw, 'items')) {
    const items = (raw.items ?? {}) as Record<string, unknown>;
    const oversized = documentSizeDiagnostics(raw.manifest, items);
    return {
      manifest: raw.manifest,
      items,
      sources: { [courseKey]: text },
      ...(oversized.length ? { parseDiagnostics: oversized } : {}),
      sourceMaps: {
        [courseKey]: { sourceId: courseKey, basePath: '/manifest' },
        ...Object.fromEntries(Object.keys(items).map((id) => [sourceKeyOf(itemRef(id)), { sourceId: courseKey, basePath: `/items/${id}` }])),
      },
    };
  }
  // Not an envelope: this is one course document, and one document's limit applies.
  const bytes = utf8ByteLength(text);
  if (bytes > MAX_DOCUMENT_BYTES) {
    return {
      manifest: raw,
      items: {},
      sources: { [courseKey]: text },
      parseDiagnostics: [makeDiagnostic('E_LIMIT_EXCEEDED', { ref: COURSE_REF, path: '', meta: { limit: 'bytes', received: bytes, expected: MAX_DOCUMENT_BYTES } })],
    };
  }
  const parsed = CourseDocumentSchema.safeParse(raw);
  if (parsed.success) {
    const split = splitInlineCourse(parsed.data);
    const sourceMaps: NonNullable<CourseWorkspace['sourceMaps']> = { [courseKey]: { sourceId: courseKey, basePath: '' } };
    parsed.data.modules.forEach((module, moduleIndex) => {
      module.items.forEach((item, itemIndex) => {
        if (isInlineItem(item)) sourceMaps[sourceKeyOf(itemRef(item.id))] = { sourceId: courseKey, basePath: `/modules/${moduleIndex}/items/${itemIndex}` };
      });
    });
    return { manifest: split.manifest, items: split.items, sources: { [courseKey]: text }, sourceMaps };
  }
  return { manifest: raw, items: {}, sources: { [courseKey]: text } };
}

/**
 * Offline reference truth comes from `--refs` or `--fixtures`, and from nowhere else.
 *
 * The default used to be a resolver that claimed every reference existed, so a CLI
 * run could report a course as valid while the same course failed on the server. An
 * empty resolver says what is actually true offline: nothing can be resolved, and
 * unresolved references are reported as unresolved.
 */
export function loadRefsResolver(opts: { refs?: string; fixtures?: boolean }): ReferenceResolver {
  if (opts.refs) return new InMemoryResolver(JSON.parse(readFileSync(opts.refs, 'utf8')));
  if (opts.fixtures) return fixtureResolver;
  return new InMemoryResolver({});
}
