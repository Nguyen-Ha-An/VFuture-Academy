import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { authoringGuideTopic, AUTHORING_GUIDE_TOPICS } from '@/content-engine/authoring';

import { defineStudioTool, type StudioToolContext } from './define-tool';
import { commonOutput } from './output-common';

const inputSchema = z.strictObject({ topic: z.enum(AUTHORING_GUIDE_TOPICS) });
const outputSchema = z.looseObject({ ...commonOutput, markdown: z.string(), related: z.array(z.string()) });

export function registerGetAuthoringGuideTool(server: McpServer, context: StudioToolContext): void {
  defineStudioTool(server, context, {
    name: 'get_authoring_guide',
    description: 'Read one English topic of the generated Studio MCP authoring guide.',
    inputSchema,
    outputSchema,
    capability: 'read',
    rateLimit: 'read',
    nextStep: 'Call get_authoring_schema for the item kind and course, then get_item before proposing an edit.',
    handler: async ({ topic }) => {
      const markdown = authoringGuideTopic(topic);
      if (markdown === null) return { markdown: '', related: [] };
      const related = topic === 'workflow' ? ['profile_rules', 'import_steps']
        : topic === 'quiz' || topic === 'exam' ? ['question_types', 'localization']
          : topic === 'assignment' ? ['profile_rules', 'localization']
            : ['workflow'];
      return { markdown, related };
    },
  });
}
