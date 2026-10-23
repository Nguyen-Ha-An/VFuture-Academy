import type { McpServer } from '@modelcontextprotocol/server';

import { mcpGetDraft } from '../db/read-only-database';
import { verifyImportInputSchema } from '../validation/inputs';
import { verifyImportOutputSchema } from '../validation/outputs';
import { verifyPreparationProof } from '../validation/preparation-proof';
import { verifyStoredImport } from '../validation/verify-import';
import { defineStudioTool, type StudioToolContext } from './define-tool';
import { rethrowImportError } from './import-errors';

export function registerVerifyImportTool(server: McpServer, context: StudioToolContext): void {
  defineStudioTool(server, context, {
    name: 'verify_import',
    description: 'Check that the exact prepared JSON was saved in the current Studio draft. Supply baseItemHash, proposedItemHash, unchanged importText and preparationProof from prepare_import; this read-only check distinguishes unsaved, verified and mismatched content.',
    inputSchema: verifyImportInputSchema,
    outputSchema: verifyImportOutputSchema,
    capability: 'author',
    rateLimit: 'validate',
    courseId: args => args.courseId,
    textOnlyFields: [],
    nextStep: 'Review the verification status before continuing.',
    nextStepByStatus: {
      VERIFIED: 'Import verified. Continue reviewing the draft in Studio.',
      NOT_SAVED_YET: 'Wait for Studio autosave, then call verify_import again.',
      MISMATCH: 'Inspect the saved item in Studio and prepare a new import from the current draft.',
    },
    handler: async (args, call) => {
      try {
        verifyPreparationProof(args.preparationProof, {
          userId: call.userId, clientId: call.clientId,
          courseId: args.courseId, itemId: args.itemId,
          baseItemHash: args.baseItemHash, proposedItemHash: args.proposedItemHash,
          importText: args.importText,
        });
        const draft = await mcpGetDraft(call.db, args.courseId);
        return await verifyStoredImport(draft, args.itemId, {
          baseItemHash: args.baseItemHash,
          proposedItemHash: args.proposedItemHash,
          importText: args.importText,
        });
      } catch (cause) { rethrowImportError(cause); }
    },
  });
}
