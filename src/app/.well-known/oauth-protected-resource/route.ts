import { mcpEnabled } from '@/features/studio-mcp/config';
import { mcpProtectedResourceMetadata } from '@/features/studio-mcp/http/challenge';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  const headers = { 'Cache-Control': 'no-store' };
  if (!mcpEnabled()) return new Response(null, { status: 404, headers });
  return Response.json(mcpProtectedResourceMetadata(), { headers });
}
