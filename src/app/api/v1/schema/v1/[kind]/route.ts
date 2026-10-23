import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DOCUMENT_KINDS } from '@/content-engine/schema/common';
import { ApiError, withHandler } from '@/lib/api';

type RouteContext = { params: Promise<{ kind: string }> };

const allowedKinds = new Set<string>(DOCUMENT_KINDS);

/** Serves one checked-in JSON Schema without accepting arbitrary filesystem paths. */
export const GET = withHandler(async (_request, context) => {
  const { kind: rawKind } = await (context as RouteContext).params;
  const kind = rawKind.endsWith('.json') ? rawKind.slice(0, -'.json'.length) : '';
  if (!allowedKinds.has(kind)) throw new ApiError(404, 'SCHEMA_NOT_FOUND', 'Schema not found');

  const body = await readFile(join(process.cwd(), 'public', 'schemas', 'v1', `${kind}.json`), 'utf8');
  return new Response(body, {
    headers: {
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      'Content-Type': 'application/schema+json; charset=utf-8',
    },
  });
});
