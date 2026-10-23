import { z } from 'zod';
import { hoistRootDefinition, SCHEMA_BASE_URL } from '../schema/json-schema';
import { QUESTION_TYPES, type QuestionType } from '../schema/questions';
import type { AuthoringKind, ProfileContext } from './context';
import { buildAuthoringContent } from './content';
import { buildAuthoringDocuments } from './documents';
import { buildAuthoringQuestions } from './questions';
import { VIDEO_PROVIDER_URL_PATTERNS } from './primitives';
import { PROFILE_RULES } from './rules';

type JsonSchema = Record<string, unknown>;
const asObject = (value: unknown): JsonSchema | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonSchema : null;

const TO_JSON_SCHEMA = {
  target: 'draft-2020-12', io: 'input', cycles: 'throw',
  unrepresentable: 'throw', reused: 'ref',
} as const;

const authoringBase = `${SCHEMA_BASE_URL}/authoring`;

/** JSON Schema constraints whose Zod equivalents are enforced by the semantic/storage pass. */
export function applyAuthoringJsonExtras(root: JsonSchema): JsonSchema {
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const node = value as JsonSchema;
    const props = asObject(node.properties);
    if (props) {
      const type = asObject(props.type)?.const;
      for (const field of ['skills', 'tags', 'accepts', 'allowedMimeTypes', 'linkHosts']) {
        const array = asObject(props[field]);
        if (array?.type === 'array') array.uniqueItems = true;
      }
      if (type === 'multiple_choice' || type === 'ordering') {
        const answer = asObject(props.correctAnswer);
        if (answer?.type === 'array') answer.uniqueItems = true;
      }
      if (type === 'numeric') {
        node.allOf = [...(Array.isArray(node.allOf) ? node.allOf : []),
          { not: { properties: { tolerance: {}, tolerancePercent: {} }, required: ['tolerance', 'tolerancePercent'] } }];
      }
      if (type === 'video') {
        node.allOf = [...(Array.isArray(node.allOf) ? node.allOf : []),
          ...Object.entries(VIDEO_PROVIDER_URL_PATTERNS).map(([provider, pattern]) => ({
            if: { properties: { provider: { const: provider } }, required: ['provider'] },
            then: { properties: { url: { type: 'string', pattern: pattern.source } } },
          }))];
      }
      if (props.accepts && props.codeLanguage && !props.type) {
        const accepts = (value: string) => ({ properties: { accepts: { type: 'array', contains: { const: value } } }, required: ['accepts'] });
        const absent = (field: string) => ({ not: { properties: { [field]: {} }, required: [field] } });
        node.allOf = [...(Array.isArray(node.allOf) ? node.allOf : []),
          { if: accepts('code'), then: { properties: { codeLanguage: {} }, required: ['codeLanguage'] }, else: absent('codeLanguage') },
          { if: accepts('file'), else: { allOf: ['maxFiles', 'maxFileSizeMB', 'allowedMimeTypes'].map(absent) } },
          { if: accepts('link'), else: absent('linkHosts') },
        ];
      }
    }
    // Zod can place a narrowing keyword beside a reused `$ref`. Ajv strict mode
    // requires a local type even though the referenced schema already has one.
    if (!node.type) {
      if (['minLength', 'maxLength', 'pattern', 'format'].some((key) => key in node)) node.type = 'string';
      else if (['minItems', 'maxItems', 'uniqueItems', 'items'].some((key) => key in node)) node.type = 'array';
      else if (['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'].some((key) => key in node)) node.type = 'number';
      else if (['properties', 'required', 'additionalProperties'].some((key) => key in node)) node.type = 'object';
    }
    for (const [key, child] of Object.entries(node)) {
      // `properties` and `$defs` are maps of schemas, not schemas themselves.
      // Treating those maps as a schema could turn an authored `required` or
      // `type` property name into a JSON Schema keyword.
      if (key === 'properties' || key === '$defs' || key === 'patternProperties') {
        Object.values(asObject(child) ?? {}).forEach(visit);
      } else visit(child);
    }
  };
  visit(root);
  return root;
}

function exportSchema(schema: z.ZodType, title: string, id?: string): JsonSchema {
  const raw = z.toJSONSchema(schema, TO_JSON_SCHEMA) as JsonSchema;
  const js = applyAuthoringJsonExtras(hoistRootDefinition(raw));
  const description = `MCP authoring profile v1. ${PROFILE_RULES.find((rule) => rule.id === 'AP-LEGACY-UNCHANGED')!.summary} Server-side semantic and storage checks are also required.`;
  return { ...js, ...(id ? { $id: id } : {}), title, description };
}

export function schemaForAuthoring(kind: AuthoringKind, context: ProfileContext): z.ZodType {
  return buildAuthoringDocuments(context)[kind];
}

export function authoringJsonSchema(kind: AuthoringKind, context: ProfileContext, id?: string): JsonSchema {
  return exportSchema(schemaForAuthoring(kind, context), `VFuture MCP ${kind} authoring profile v1`, id);
}

export function authoringQuestionJsonSchema(type: QuestionType, context: ProfileContext, id?: string): JsonSchema {
  const content = buildAuthoringContent(context);
  const questions = buildAuthoringQuestions(context, content);
  return exportSchema(questions.byType[type], `VFuture MCP ${type} question profile v1`, id);
}

/** One lesson block variant, for bounded get_authoring_schema block slices. */
export function authoringBlockJsonSchema(type: string, context: ProfileContext, id?: string): JsonSchema {
  const options = buildAuthoringDocuments(context).lesson.shape.blocks.element.options as unknown as
    Array<z.ZodType & { shape: { type: { value: string } } }>;
  const block = options.find((option) => option.shape.type.value === type);
  if (!block) throw new Error(`Unknown or unavailable authoring block type: ${type}`);
  return exportSchema(block, `VFuture MCP ${type} lesson block profile v1`, id);
}

export const AUTHORING_KINDS = ['lesson', 'exam', 'assignment'] as const;
export const AUTHORING_QUESTION_TYPES = QUESTION_TYPES;
export const AUTHORING_SCHEMA_BASE_URL = authoringBase;
