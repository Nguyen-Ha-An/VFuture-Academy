import 'server-only';

import { createMcpHandler, McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import type { Actor } from '@/lib/permissions';
import { mcpCapability } from './authz/capabilities';
import { MCP_INSTRUCTIONS, MCP_MAX_BODY_BYTES, mcpResourceUrl } from './config';
import type { ReadOnlyDatabase } from './db/read-only-database';
import { logMcpEvent } from './log';
import { registerStudioAuthorInstructions, registerStudioReadInstructions } from './instructions-channel';
import type { McpPrincipal } from './auth/principal';
import type { StudioToolContext } from './tools/define-tool';
import { registerWhoamiTool } from './tools/whoami';
import { registerListCoursesTool } from './tools/list-courses';
import { registerGetCourseOutlineTool } from './tools/get-course-outline';
import { registerGetItemTool } from './tools/get-item';
import { registerGetAuthoringSchemaTool } from './tools/get-authoring-schema';
import { registerGetAuthoringGuideTool } from './tools/get-authoring-guide';
import { registerValidateItemTool } from './tools/validate-item';
import { registerPrepareImportTool } from './tools/prepare-import';
import { registerVerifyImportTool } from './tools/verify-import';

type RequestServerState = { toolContext: StudioToolContext; actor: Actor };

/** Each HTTP exchange gets a fresh server and a registry shaped by live permissions. */
export function createStudioServer(context: StudioToolContext, actor: Actor): McpServer {
  const server = new McpServer({ name: 'vfuture-studio', version: '1.0.0' }, {
    instructions: MCP_INSTRUCTIONS,
  });
  registerWhoamiTool(server, context);
  const capabilities = mcpCapability(actor);
  if (capabilities.read) {
    registerListCoursesTool(server, context);
    registerGetCourseOutlineTool(server, context);
    registerGetItemTool(server, context);
    registerGetAuthoringSchemaTool(server, context);
    registerGetAuthoringGuideTool(server, context);
    registerStudioReadInstructions(server, context);
  }
  if (capabilities.author) {
    registerValidateItemTool(server, context);
    registerPrepareImportTool(server, context);
    registerVerifyImportTool(server, context);
    registerStudioAuthorInstructions(server, context);
  }
  return server;
}

const handler = createMcpHandler(({ authInfo }) => {
  const state = authInfo?.extra?.studioState as RequestServerState | undefined;
  if (!state) throw new Error('MCP principal was not resolved');
  return createStudioServer(state.toolContext, state.actor);
}, {
  maxRequestBodySize: MCP_MAX_BODY_BYTES,
  onerror: () => logMcpEvent({ event: 'security', outcome: 'sdk_error', code: 'SDK_ERROR' }),
});

/** Pass validated principal data through the SDK's request-local AuthInfo only. */
export function serveStudioMcp(
  request: Request,
  parsedBody: unknown,
  principal: McpPrincipal,
  db: ReadOnlyDatabase,
  correlationId: string,
): Promise<Response> {
  const resource = mcpResourceUrl();
  const toolContext: StudioToolContext = {
    db,
    userId: principal.verified.userId,
    clientId: principal.verified.clientId,
    correlationId,
    registeredToolNames: [],
    resourceOrigin: resource.origin,
  };
  const authInfo: AuthInfo = {
    token: principal.token,
    clientId: principal.verified.clientId,
    scopes: ['openid', 'email'],
    expiresAt: principal.verified.expiresAt,
    resource,
    extra: { studioState: { toolContext, actor: principal.actor } satisfies RequestServerState },
  };
  return handler.fetch(request, { authInfo, parsedBody });
}
