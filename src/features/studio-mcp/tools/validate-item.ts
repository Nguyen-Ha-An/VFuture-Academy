import type { McpServer } from '@modelcontextprotocol/server';

import { asStudioDatabase, mcpGetDraft } from '../db/read-only-database';
import { StudioMcpError } from '../errors';
import { simulateStudioImport } from '../validation/simulate-import';
import { validateItemInputSchema } from '../validation/inputs';
import { validateItemOutputSchema } from '../validation/outputs';
import { assertPreparationProofConfigured } from '../validation/preparation-proof';
import { defineStudioTool, type StudioToolContext } from './define-tool';
import { rethrowImportError } from './import-errors';

export function registerValidateItemTool(server: McpServer, context: StudioToolContext): void {
  defineStudioTool(server, context, {
    name: 'validate_item',
    description: 'Check an edit to one existing Studio lesson, exam or assignment against the live course, authoring profile, exact paste path and save rules. This checks only; it never saves. Supply the item hash from get_item.',
    inputSchema: validateItemInputSchema,
    outputSchema: validateItemOutputSchema,
    capability: 'author',
    rateLimit: 'validate',
    courseId: args => args.courseId,
    nextStep: 'If valid, call prepare_import with the same base hash and proposal. Otherwise fix the reported issues and validate again.',
    handler: async (args, call) => {
      try {
        if (!args.baseItemHash) throw new StudioMcpError('BASE_HASH_REQUIRED');
        assertPreparationProofConfigured();
        const draft = await mcpGetDraft(call.db, args.courseId);
        const simulation = await simulateStudioImport({
          draft, courseId: args.courseId, itemId: args.itemId,
          baseItemHash: args.baseItemHash, edits: args.edits, document: args.document,
          client: asStudioDatabase(call.db),
        });
        return {
          valid: simulation.valid,
          errors: simulation.errors,
          warnings: simulation.warnings,
          truncated: simulation.truncated,
          base: simulation.base,
          proposedItemHash: simulation.proposedItemHash,
          proposedBytes: simulation.proposedBytes,
          reviewPending: simulation.reviewPending,
          changeSummary: simulation.changeSummary,
        };
      } catch (cause) { rethrowImportError(cause); }
    },
  });
}
