import { can, type Actor } from '@/lib/authorization';
import { actorScopes, canEnter } from '@/lib/workspace-admission';
import { mcpTesterUserIds } from '@/features/studio-mcp/config';

/** Studio entry alone is insufficient: some admitted roles cannot read courses. */
export function hasStudioConsentAccess(actor: Actor): boolean {
  return canEnter(actor, 'studio') && actorScopes(actor).some((scope) =>
    can(actor, 'content.read', scope) || can(actor, 'course.read', scope));
}

/** During the production OAuth spike, only named testers may receive a grant. */
export function isConsentTester(userId: string, configured = process.env.MCP_TESTER_USER_IDS): boolean {
  try {
    const testers = mcpTesterUserIds({ ...process.env, MCP_TESTER_USER_IDS: configured });
    return configured === undefined || testers.has(userId);
  } catch {
    // A malformed or blank-present deployment setting cannot open consent.
    return false;
  }
}
