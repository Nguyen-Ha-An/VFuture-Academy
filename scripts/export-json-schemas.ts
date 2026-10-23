import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { EmbeddedSchemaBlockError, schemaArtifacts, standaloneContentSchema, type SchemaArtifact } from '../src/content-engine/schema/json-schema';
import { GENERATED_DOCS, listJsonFences, schemaFingerprint, withGeneratedBlocks } from '../src/content-engine/schema/generated-docs';
import {
  AUTHORING_IMPLEMENTATION_BASELINE, AUTHORING_IMPLEMENTATION_FILES,
  AUTHORING_STORAGE_BASELINE, authoringSchemaArtifacts,
} from '../src/content-engine/authoring/fingerprint';
import { AUTHORING_EXAMPLES, authoringGuide } from '../src/content-engine/authoring/guide';

/**
 * `schema:export` writes the generated schema files; `schema:check` regenerates the
 * same artifacts in memory and fails on any checked-in file that does not match.
 *
 * The old CI step exported and then ran `git diff -- public/schemas`, which missed the
 * docs bundle entirely and could not tell "stale" from "never generated".
 */
const CHECK = process.argv.includes('--check');
const root = process.cwd();
const at = (path: string) => join(root, ...path.split('/'));
const absolute = (artifact: SchemaArtifact) => at(artifact.path);
const AUTHORING_GUIDE_PATH = 'docs/studio/content-schema/authoring/MCP-AUTHORING-GUIDE.md';
const generatedGuide = () => `${authoringGuide()}\n`;
const generatedExamples = () => Object.entries(AUTHORING_EXAMPLES).map(([kind, value]) => ({
  path: `docs/studio/content-schema/authoring/examples/${kind}.json`,
  text: `${JSON.stringify(value, null, 2)}\n`,
}));

if (schemaFingerprint() !== AUTHORING_STORAGE_BASELINE) {
  throw new Error(`Studio storage schema changed; review authoring field ledgers and update AUTHORING_STORAGE_BASELINE before exporting`);
}
const implementationHash = createHash('sha256');
for (const path of AUTHORING_IMPLEMENTATION_FILES) {
  implementationHash.update(path).update('\0').update(readFileSync(at(path))).update('\0');
}
if (implementationHash.digest('hex').slice(0, 12) !== AUTHORING_IMPLEMENTATION_BASELINE) {
  throw new Error('Authoring implementation changed; review the rules, update AUTHORING_IMPLEMENTATION_BASELINE, then export the profile');
}

/**
 * The AI quiz kit mixes the author's prose with generated JSON: every fenced block sits
 * under a `<!-- generated: … -->` marker naming its source (a fixture, the standalone
 * schema, or the schema fingerprint). Only those fenced bodies are rewritten — the prose
 * is never touched — and a fence with no marker fails the check, because a fence nobody
 * generates is a fence nobody validates.
 */
function generatedDocs(): { path: string; current: string; next: string; changed: boolean; unowned: number[] }[] {
  const schema = standaloneContentSchema();
  return GENERATED_DOCS.flatMap((path) => {
    let current: string;
    try { current = readFileSync(at(path), 'utf8'); } catch { return []; }
    try {
      const { text, changed } = withGeneratedBlocks(current, { schema, read: (source) => readFileSync(at(source), 'utf8') });
      const unowned = listJsonFences(current).filter((fence) => fence.source === null).map((fence) => fence.line);
      return [{ path, current, next: text, changed, unowned }];
    } catch (cause) {
      if (cause instanceof EmbeddedSchemaBlockError) throw new Error(`${path}: ${cause.message}`);
      throw cause;
    }
  });
}

function write(artifacts: SchemaArtifact[]): void {
  for (const artifact of artifacts) {
    const target = absolute(artifact);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, artifact.text);
    console.log(`wrote ${artifact.path}`);
  }
  for (const doc of generatedDocs()) {
    if (doc.unowned.length) console.warn(`warning: ${doc.path} has JSON fences nobody generates at lines ${doc.unowned.join(', ')}`);
    if (!doc.changed) { console.log(`unchanged ${doc.path}`); continue; }
    writeFileSync(at(doc.path), doc.next);
    console.log(`updated generated blocks in ${doc.path}`);
  }
  mkdirSync(dirname(at(AUTHORING_GUIDE_PATH)), { recursive: true });
  writeFileSync(at(AUTHORING_GUIDE_PATH), generatedGuide());
  console.log(`wrote ${AUTHORING_GUIDE_PATH}`);
  for (const example of generatedExamples()) {
    mkdirSync(dirname(at(example.path)), { recursive: true });
    writeFileSync(at(example.path), example.text);
    console.log(`wrote ${example.path}`);
  }
}

function check(artifacts: SchemaArtifact[]): number {
  const stale: string[] = [];
  for (const artifact of artifacts) {
    let current: string | null = null;
    try { current = readFileSync(absolute(artifact), 'utf8'); } catch { current = null; }
    if (current === null) stale.push(`${artifact.path}: missing`);
    else if (current !== artifact.text) stale.push(`${artifact.path}: differs from generated output`);
  }
  const docs = generatedDocs();
  for (const doc of docs) {
    if (doc.changed) stale.push(`${doc.path}: generated blocks are out of date`);
    if (doc.unowned.length) stale.push(`${doc.path}: JSON fences without a generated marker at lines ${doc.unowned.join(', ')}`);
  }
  let guide: string | null = null;
  try { guide = readFileSync(at(AUTHORING_GUIDE_PATH), 'utf8'); } catch { guide = null; }
  if (guide === null) stale.push(`${AUTHORING_GUIDE_PATH}: missing`);
  else if (guide !== generatedGuide()) stale.push(`${AUTHORING_GUIDE_PATH}: differs from generated output`);
  for (const example of generatedExamples()) {
    let current: string | null = null;
    try { current = readFileSync(at(example.path), 'utf8'); } catch { current = null; }
    if (current === null) stale.push(`${example.path}: missing`);
    else if (current !== example.text) stale.push(`${example.path}: differs from generated output`);
  }

  if (!stale.length) {
    console.log(`schema:check ok — ${artifacts.length} JSON artifacts, ${docs.length + 1} generated documents, and ${generatedExamples().length} examples match`);
    return 0;
  }
  console.error('schema:check failed. Regenerate with `npm run schema:export`:');
  for (const line of stale) console.error(`  ${line}`);
  return 1;
}

const artifacts = [...schemaArtifacts(), ...authoringSchemaArtifacts()];
if (CHECK) process.exitCode = check(artifacts);
else write(artifacts);
