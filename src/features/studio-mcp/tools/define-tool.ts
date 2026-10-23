import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { authoringProfileVersion } from '@/content-engine/authoring';
import { criticalProfileRules } from '@/content-engine/authoring/rules';
import { z } from 'zod';

import { ApiError } from '@/lib/api';
import { ActorResolutionError, getActorForUserId, type Actor } from '@/lib/permissions';
import { enforceRateLimit, RATE_LIMITS, userRateLimitKey } from '@/lib/rate-limit';
import { mcpCapability } from '../authz/capabilities';
import { assertMcpCourseAccess } from '../authz/course-access';
import type { ReadOnlyDatabase } from '../db/read-only-database';
import { McpWriteAttemptError } from '../db/read-only-database';
import { StudioMcpError, mcpToolErrorResult } from '../errors';
import { logMcpEvent, reportMcpInternalError } from '../log';

export type StudioToolContext = {
  db: ReadOnlyDatabase;
  userId: string;
  clientId: string;
  correlationId: string;
  registeredToolNames: string[];
  resourceOrigin: string;
};

export type StudioToolCallContext = StudioToolContext & { actor: Actor };

export type StudioToolDefinition<T extends z.ZodType<Record<string, unknown>> = z.ZodType<Record<string, unknown>>> = {
  name: string;
  title?: string;
  description: string;
  inputSchema: T;
  outputSchema?: z.ZodType;
  capability: 'whoami' | 'read' | 'author';
  rateLimit: 'read' | 'validate';
  nextStep: string;
  nextStepByStatus?: Readonly<Record<string, string>>;
  courseId?: (args: z.output<T>) => string | undefined;
  textOnlyFields?: readonly string[];
  handler: (args: z.output<T>, context: StudioToolCallContext) => Promise<Record<string, unknown>>;
};

const RULES = criticalProfileRules();
const MAX_COMBINED_OUTPUT_BYTES = 256 * 1024;
const COMMON_OUTPUT_SCHEMA = z.looseObject({
  rules: z.array(z.string()),
  nextStep: z.string(),
  profileVersion: z.string(),
  payloadInText: z.boolean().optional(),
});
let cachedProfileVersion: string | undefined;

function toStudioMcpError(error: unknown, correlationId: string): StudioMcpError {
  if (error instanceof StudioMcpError) return error;
  if (error instanceof ActorResolutionError) {
    return new StudioMcpError(error.reason === 'missing_account' ? 'ACCOUNT_NOT_PROVISIONED' : 'SERVICE_UNAVAILABLE');
  }
  if (error instanceof ApiError) {
    if (error.code === 'RATE_LIMITED') {
      const headers = (error as ApiError & { headers?: HeadersInit }).headers;
      const retryAfter = headers instanceof Headers ? headers.get('Retry-After')
        : Array.isArray(headers) ? headers.find(([name]) => name.toLowerCase() === 'retry-after')?.[1]
          : headers?.['Retry-After'];
      return new StudioMcpError('RATE_LIMITED', { retryAfterSeconds: Number(retryAfter) || 60 });
    }
    if (error.code === 'RATE_LIMIT_UNAVAILABLE') return new StudioMcpError('RATE_LIMIT_UNAVAILABLE');
    if (error.code === 'REFERENCE_LOOKUP_UNAVAILABLE') return new StudioMcpError('REFERENCE_LOOKUP_UNAVAILABLE');
  }
  if (error instanceof McpWriteAttemptError) {
    reportMcpInternalError(error, correlationId);
    return new StudioMcpError('INTERNAL', { correlationId });
  }
  reportMcpInternalError(error, correlationId);
  return new StudioMcpError('INTERNAL', { correlationId });
}

/** A single security and result wrapper for every Studio MCP tool. */
export function defineStudioTool<T extends z.ZodType<Record<string, unknown>>>(
  server: McpServer,
  context: StudioToolContext,
  definition: StudioToolDefinition<T>,
): void {
  context.registeredToolNames.push(definition.name);
  // SDK v2's generic callback inference loses the Zod output type when a caller
  // supplies a generic schema. The runtime SDK still validates that schema.
  const registerTool = server.registerTool as unknown as (
    name: string,
    config: Record<string, unknown>,
    handler: (args: z.output<T>) => Promise<CallToolResult>,
  ) => void;
  registerTool.call(server, definition.name, {
    title: definition.title,
    description: `${definition.description}\n\n${RULES.join(' ')}`,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema ?? COMMON_OUTPUT_SCHEMA,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async (args): Promise<CallToolResult> => {
    const started = Date.now();
    let courseId: string | undefined;
    let itemId: string | undefined;
    try {
      const parsed = definition.inputSchema.safeParse(args);
      if (!parsed.success) throw new StudioMcpError('INVALID_INPUT');
      courseId = definition.courseId?.(parsed.data);
      itemId = typeof parsed.data.itemId === 'string' ? parsed.data.itemId : undefined;
      const actor = await getActorForUserId(context.userId, context.db);
      if (actor.authorization?.accountStatus === 'suspended') throw new StudioMcpError('ACCOUNT_SUSPENDED');
      const capabilities = mcpCapability(actor);
      if (definition.capability === 'read' && !capabilities.read
        || definition.capability === 'author' && !capabilities.author) throw new StudioMcpError('PERMISSION_DENIED');
      await enforceRateLimit(context.db, userRateLimitKey(definition.rateLimit === 'read' ? 'mcpRead' : 'mcpValidate', context.userId),
        definition.rateLimit === 'read' ? RATE_LIMITS.mcpRead : RATE_LIMITS.mcpValidate);
      if (courseId) await assertMcpCourseAccess(context.db, actor, courseId,
        definition.capability === 'author' ? 'content.edit' : 'content.read');
      const result = await definition.handler(parsed.data, { ...context, actor });
      const status = typeof result.status === 'string' ? result.status : undefined;
      const nextStep = status ? definition.nextStepByStatus?.[status] ?? definition.nextStep : definition.nextStep;
      const full = {
        ...result,
        rules: RULES,
        nextStep,
        profileVersion: cachedProfileVersion ??= authoringProfileVersion(),
      };
      const textValue = JSON.stringify(full);
      let structuredContent: Record<string, unknown> = full;
      if (definition.textOnlyFields?.length && Buffer.byteLength(textValue, 'utf8') * 2 > 32 * 1024) {
        structuredContent = { ...full, payloadInText: true };
        for (const field of definition.textOnlyFields) delete structuredContent[field];
      }
      const outputBytes = Buffer.byteLength(JSON.stringify(structuredContent), 'utf8') + Buffer.byteLength(textValue, 'utf8');
      if (outputBytes > MAX_COMBINED_OUTPUT_BYTES) throw new StudioMcpError('OUTPUT_TOO_LARGE');
      const output = { content: [{ type: 'text' as const, text: textValue }], structuredContent };
      logMcpEvent({ event: 'tool', outcome: 'ok', tool: definition.name, userId: context.userId,
        clientId: context.clientId, courseId, itemId, correlationId: context.correlationId,
        inputBytes: Buffer.byteLength(JSON.stringify(parsed.data), 'utf8'),
        outputBytes,
        durationMs: Date.now() - started });
      return output as unknown as CallToolResult;
    } catch (error) {
      const converted = toStudioMcpError(error, context.correlationId);
      logMcpEvent({ event: 'tool', outcome: 'error', tool: definition.name, userId: context.userId,
        clientId: context.clientId, courseId, itemId, correlationId: context.correlationId,
        code: converted.code, durationMs: Date.now() - started });
      return mcpToolErrorResult(converted) as CallToolResult;
    }
  });
}
