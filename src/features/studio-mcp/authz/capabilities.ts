import { can, type Actor, type Scope } from '@/lib/permissions';
import { actorScopes } from '@/lib/workspace-admission';

export type McpCapability = Readonly<{ read: boolean; author: boolean }>;

export function canMcpRead(actor: Actor, scope: Scope): boolean {
  return can(actor, 'content.read', scope) || can(actor, 'course.read', scope);
}

export function canMcpAuthor(actor: Actor, scope: Scope): boolean {
  return canMcpRead(actor, scope)
    && (can(actor, 'content.edit', scope) || can(actor, 'course.edit', scope));
}

export function mcpCapability(actor: Actor): McpCapability {
  const scopes = actorScopes(actor);
  return {
    read: scopes.some((scope) => canMcpRead(actor, scope)),
    author: scopes.some((scope) => canMcpAuthor(actor, scope)),
  };
}

export function mcpReadableScopes(actor: Actor): Scope[] {
  return actorScopes(actor).filter((scope) => canMcpRead(actor, scope));
}
