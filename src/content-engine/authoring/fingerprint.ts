import { createHash } from 'node:crypto';
import type { SchemaArtifact } from '../schema/json-schema';
import { QUESTION_TYPES } from '../schema/questions';
import { staticProfileContext } from './context';
import { AUTHORING_SCHEMA_BASE_URL, AUTHORING_KINDS, authoringJsonSchema, authoringQuestionJsonSchema } from './json-schema';
import { PROFILE_RULES, criticalProfileRules } from './rules';

/** Changing Studio's published storage contract requires a fresh field-ledger review. */
export const AUTHORING_STORAGE_BASELINE = '6fc10dd988ac';
/** Checked by schema:check so semantic/legacy changes also bump the public profile version. */
export const AUTHORING_IMPLEMENTATION_FILES = [
  'src/content-engine/authoring/context.ts',
  'src/content-engine/authoring/primitives.ts',
  'src/content-engine/authoring/content.ts',
  'src/content-engine/authoring/questions.ts',
  'src/content-engine/authoring/documents.ts',
  'src/content-engine/authoring/json-schema.ts',
  'src/content-engine/authoring/rules.ts',
  'src/content-engine/authoring/codes.ts',
  'src/content-engine/authoring/semantic.ts',
  'src/content-engine/authoring/legacy.ts',
  'src/content-engine/authoring/index.ts',
  'src/content-engine/authoring/ledger.ts',
  'src/content-engine/authoring/guide.ts',
] as const;
export const AUTHORING_IMPLEMENTATION_BASELINE = '994eb0a20622';

type ArtifactBody = { path: string; value: Record<string, unknown> };
const PUBLIC_DIR = 'public/schemas/v1/authoring';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex').slice(0, 12);
const byteSize = (value: unknown) => Buffer.byteLength(JSON.stringify(value, null, 2), 'utf8');

let cached: { artifacts: SchemaArtifact[]; version: string } | undefined;

function generated(): { artifacts: SchemaArtifact[]; version: string } {
  if (cached) return cached;
  const bodies: ArtifactBody[] = [];
  for (const mode of ['mono', 'bilingual'] as const) {
    const context = staticProfileContext(mode);
    for (const kind of AUTHORING_KINDS) {
      const path = `${PUBLIC_DIR}/${mode}/${kind}.json`;
      bodies.push({ path, value: authoringJsonSchema(kind, context, `${AUTHORING_SCHEMA_BASE_URL}/${mode}/${kind}.json`) });
    }
    for (const type of QUESTION_TYPES) {
      const path = `${PUBLIC_DIR}/${mode}/${type}.json`;
      bodies.push({ path, value: authoringQuestionJsonSchema(type, context, `${AUTHORING_SCHEMA_BASE_URL}/${mode}/${type}.json`) });
    }
  }
  const rules: ArtifactBody = {
    path: `${PUBLIC_DIR}/rules.json`,
    value: {
      $id: `${AUTHORING_SCHEMA_BASE_URL}/rules.json`,
      storageBaseline: AUTHORING_STORAGE_BASELINE,
      implementationBaseline: AUTHORING_IMPLEMENTATION_BASELINE,
      rules: PROFILE_RULES,
      criticalRules: criticalProfileRules(),
    },
  };
  bodies.push(rules);

  const version = `mcp-authoring-v1+${digest([AUTHORING_IMPLEMENTATION_BASELINE, bodies.map(({ path, value }) => [path, value])])}`;
  const index: ArtifactBody = {
    path: `${PUBLIC_DIR}/index.json`,
    value: {
      $id: `${AUTHORING_SCHEMA_BASE_URL}/index.json`,
      profileVersion: version,
      storageBaseline: AUTHORING_STORAGE_BASELINE,
      implementationBaseline: AUTHORING_IMPLEMENTATION_BASELINE,
      artifacts: bodies.map(({ path, value }) => ({
        path: path.slice(`${PUBLIC_DIR}/`.length),
        fingerprint: digest(value),
        bytes: byteSize(value),
      })),
    },
  };
  bodies.push(index);
  cached = {
    version,
    artifacts: bodies.map(({ path, value }) => ({ path, value, text: JSON.stringify(value, null, 2) })),
  };
  return cached;
}

export function authoringProfileVersion(): string { return generated().version; }
export function authoringSchemaArtifacts(): SchemaArtifact[] { return generated().artifacts; }
