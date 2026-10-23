import { createHash } from 'node:crypto';

import {
  authoringBlockJsonSchema,
  authoringJsonSchema,
  authoringQuestionJsonSchema,
  type AuthoringKind,
  type ProfileContext,
} from '@/content-engine/authoring';
import { PROFILE_RULES } from '@/content-engine/authoring/rules';
import type { QuestionType } from '@/content-engine/schema/questions';

import { StudioMcpError } from '../errors';

type Schema = Record<string, unknown>;
type SchemaPart = 'index' | 'document' | `def:${string}` | `question:${string}` | `block:${string}`;

const MAX_SCHEMA_CHARS = 20_000;
const DEF_REF = '#/$defs/';

const RUNTIME_RULE_CODES: Record<string, string> = {
  'AP-RUBRIC-SUM': 'E_PROFILE_RUBRIC_POINTS_MISMATCH',
  'AP-RUBRIC-LEVELS': 'E_PROFILE_RUBRIC_LEVEL_RANGE',
  'AP-LENGTH-BOUNDS': 'E_PROFILE_LENGTH_BOUNDS',
  'AP-SELECTION-BOUNDS': 'E_PROFILE_SELECTION_BOUNDS',
  'AP-QUESTION-ID-DOCUMENT-UNIQUE': 'E_PROFILE_DUPLICATE_QUESTION_ID',
  'AP-QUESTION-LIMIT': 'E_PROFILE_QUESTION_LIMIT',
  'AP-PASS-POINTS': 'E_PROFILE_PASS_POINTS_RANGE',
  'AP-LEGACY-UNCHANGED': 'W_PROFILE_LEGACY_UNCHANGED',
};

function object(value: unknown): Schema | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Schema : null;
}

function directRefs(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const row = object(node);
    if (!row) return;
    if (typeof row.$ref === 'string' && row.$ref.startsWith(DEF_REF)) {
      found.add(row.$ref.slice(DEF_REF.length).replace(/~1/g, '/').replace(/~0/g, '~'));
    }
    Object.values(row).forEach(visit);
  };
  visit(value);
  return [...found];
}

function reachableDefs(root: Schema, defs: Schema): string[] {
  const queue = directRefs(root);
  const seen = new Set<string>();
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name) || !Object.hasOwn(defs, name)) continue;
    seen.add(name);
    queue.push(...directRefs(defs[name]));
  }
  return [...seen];
}

function boundedSchema(source: Schema, part: SchemaPart, selectedDefinition?: string, page = 0): {
  schema: string; includedDefs: string[]; omittedDefs: string[]; bytes: number;
  definitionChunk?: { name: string; index: number; count: number; encoding: 'utf8-base64' };
} {
  const defs = object(source.$defs) ?? {};
  const allNames = Object.keys(defs);
  const root: Schema = { ...source };
  delete root.$defs;

  if (selectedDefinition) {
    if (!Object.hasOwn(defs, selectedDefinition)) throw new StudioMcpError('INVALID_INPUT');
    for (const key of Object.keys(root)) {
      if (key !== '$schema' && key !== '$id') delete root[key];
    }
    root.$ref = `${DEF_REF}${selectedDefinition.replace(/~/g, '~0').replace(/\//g, '~1')}`;
    // A dynamic per-course enum can make one definition exceed the response
    // budget. Transfer its exact JSON bytes in retrievable chunks instead of
    // silently returning a reference whose definition can never be fetched.
    const single = JSON.stringify({ ...root, $defs: { [selectedDefinition]: defs[selectedDefinition] } });
    if (single.length > MAX_SCHEMA_CHARS) {
      const encoded = Buffer.from(JSON.stringify(defs[selectedDefinition]), 'utf8').toString('base64');
      const chunkSize = 12_000;
      const count = Math.ceil(encoded.length / chunkSize);
      if (page >= count) throw new StudioMcpError('INVALID_INPUT');
      const schema = JSON.stringify({
        $schema: source.$schema,
        $comment: 'Definition fragment: concatenate x-definitionChunkBase64 in index order, decode UTF-8 JSON, then add it to the document slice $defs under x-definitionName.',
        'x-definitionName': selectedDefinition,
        'x-definitionChunkIndex': page,
        'x-definitionChunkCount': count,
        'x-definitionChunkBase64': encoded.slice(page * chunkSize, (page + 1) * chunkSize),
      });
      return {
        schema, includedDefs: [], omittedDefs: [selectedDefinition], bytes: schema.length,
        definitionChunk: { name: selectedDefinition, index: page, count, encoding: 'utf8-base64' },
      };
    }
    if (page !== 0) throw new StudioMcpError('INVALID_INPUT');
  }
  if (part === 'index') {
    root['x-authoring-parts'] = ['document', ...allNames.map((name) => `def:${name}`)];
  }
  root.$comment = 'Schema slice. If omittedDefs is nonempty, fetch def:<name> parts and merge their $defs before validating.';

  const included: Schema = {};
  const queue = part === 'index' ? [] : directRefs(root);
  const seen = new Set<string>();
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name) || !Object.hasOwn(defs, name)) continue;
    seen.add(name);
    const candidate = { ...included, [name]: defs[name] };
    const preview = JSON.stringify({ ...root, $defs: candidate });
    if (preview.length > MAX_SCHEMA_CHARS) continue;
    included[name] = defs[name];
    queue.push(...directRefs(defs[name]));
  }

  const omittedDefs = part === 'index'
    ? allNames
    : reachableDefs(root, defs).filter((name) => !Object.hasOwn(included, name));
  const schema = JSON.stringify(Object.keys(included).length ? { ...root, $defs: included } : root);
  if (schema.length > MAX_SCHEMA_CHARS) throw new StudioMcpError('INVALID_INPUT');
  return {
    schema,
    includedDefs: Object.keys(included),
    omittedDefs,
    bytes: schema.length,
  };
}

export function authoringSchemaSlice(input: {
  kind: AuthoringKind;
  context: ProfileContext;
  part: SchemaPart;
  questionTypes?: QuestionType[];
  blockTypes?: string[];
}): {
  schema: string;
  languageMode: ProfileContext['languageMode'];
  includedDefs: string[];
  omittedDefs: string[];
  runtimeRules: Array<{ id: string; code: string; rule: string }>;
  bytes: number;
  contextHash: string;
  definitionChunk?: { name: string; index: number; count: number; encoding: 'utf8-base64' };
} {
  const { kind, context, part } = input;
  let schema: Schema;
  let selectedDefinition: string | undefined;

  if (part.startsWith('question:')) {
    const questionType = part.slice('question:'.length) as QuestionType;
    if (input.questionTypes?.length && !input.questionTypes.includes(questionType)) throw new StudioMcpError('INVALID_INPUT');
    schema = authoringQuestionJsonSchema(questionType, context);
  } else if (part.startsWith('block:')) {
    const blockType = part.slice('block:'.length);
    if (input.blockTypes?.length && !input.blockTypes.includes(blockType)) throw new StudioMcpError('INVALID_INPUT');
    schema = authoringBlockJsonSchema(blockType, context);
  } else if (part.startsWith('def:')) {
    const selectedPart = part.slice('def:'.length);
    const match = /^([A-Za-z0-9_]+)(?:@(\d+))?$/.exec(selectedPart);
    if (!match) throw new StudioMcpError('INVALID_INPUT');
    selectedDefinition = match[1];
    if (input.questionTypes?.length === 1) schema = authoringQuestionJsonSchema(input.questionTypes[0], context);
    else if (input.blockTypes?.length === 1) schema = authoringBlockJsonSchema(input.blockTypes[0], context);
    else schema = authoringJsonSchema(kind, context);
  } else schema = authoringJsonSchema(kind, context);

  const page = part.startsWith('def:') ? Number(part.split('@')[1] ?? '0') : 0;
  if (!Number.isSafeInteger(page) || page < 0 || page > 1000) throw new StudioMcpError('INVALID_INPUT');
  const sliced = boundedSchema(schema, part, selectedDefinition, page);
  const { sourceDraft: _sourceDraft, ...hashContext } = context;
  const contextHash = createHash('sha256').update(JSON.stringify(hashContext)).digest('hex').slice(0, 12);
  return {
    ...sliced,
    languageMode: context.languageMode,
    runtimeRules: PROFILE_RULES.flatMap(({ id, summary }) =>
      id in RUNTIME_RULE_CODES ? [{ id, code: RUNTIME_RULE_CODES[id], rule: summary }] : []),
    contextHash,
  };
}
