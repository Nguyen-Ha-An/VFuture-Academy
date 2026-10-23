import type { McpServer } from '@modelcontextprotocol/server';

import { ownerScopeKey, record } from '../data/courses';
import { asStudioDatabase, mcpGetDraft } from '../db/read-only-database';
import { StudioMcpError } from '../errors';
import { prepareImportPackage } from '../import-package';
import { prepareImportInputSchema } from '../validation/inputs';
import { prepareImportOutputSchema } from '../validation/outputs';
import { assertPreparationProofConfigured, createPreparationProof } from '../validation/preparation-proof';
import { simulateStudioImport } from '../validation/simulate-import';
import { defineStudioTool, type StudioToolContext } from './define-tool';
import { rethrowImportError } from './import-errors';

export function registerPrepareImportTool(server: McpServer, context: StudioToolContext): void {
  defineStudioTool(server, context, {
    name: 'prepare_import',
    description: 'Recheck a proposed edit to an existing Studio item and return exact JSON plus steps for a person to paste into Import → Single item. This tool never opens Studio or writes content. A stale base, pending review or oversized paste is refused.',
    inputSchema: prepareImportInputSchema,
    outputSchema: prepareImportOutputSchema,
    capability: 'author',
    rateLimit: 'validate',
    courseId: args => args.courseId,
    textOnlyFields: ['importText'],
    nextStep: 'Show importText verbatim in one code block, follow the numbered Studio steps, then call verify_import after Studio autosaves.',
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
        const { data, error } = await call.db.from('courses')
          .select('ownership_kind,owner_branch_id').eq('id', args.courseId).maybeSingle();
        if (error) throw new StudioMcpError('SERVICE_UNAVAILABLE');
        const course = record(data);
        if (!course) throw new StudioMcpError('COURSE_NOT_FOUND_OR_FORBIDDEN');
        const prepared = prepareImportPackage({
          simulation,
          courseId: args.courseId,
          origin: call.resourceOrigin,
          ownerScopeKey: ownerScopeKey(course),
          baseDraftUpdatedAt: args.baseDraftUpdatedAt,
          uiLocale: args.uiLocale,
        });
        const preparationProof = createPreparationProof({
          userId: call.userId, clientId: call.clientId,
          courseId: args.courseId, itemId: args.itemId,
          baseItemHash: prepared.baseItemHash,
          proposedItemHash: prepared.proposedItemHash,
          importText: prepared.importText,
        });
        return { ...prepared, preparationProof };
      } catch (cause) { rethrowImportError(cause); }
    },
  });
}
