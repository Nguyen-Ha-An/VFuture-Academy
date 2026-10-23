# VFuture Content Engine

The content engine is the framework-free core for VFuture Academy authoring, validation, compilation, grading, and prompt-pack generation. It keeps schema and runtime contracts usable from scripts, tests, server code, and future services without pulling in React. UI renderers live separately at `@/content-engine/render`.

## Pipeline

```text
CourseWorkspace { manifest, items, sources? }
  -> parseJsonDocument(text)
  -> migrateDocument(doc) (schema-version registry; v1 is identity)
  -> validateWorkspace(ws, resolver)
     - ids, stubs vs documents, answer shapes, refs, pools, completion, l10n, hosts, limits
     - quality warnings
  -> compileCourse(ws, resolver, { locales, publish })
     - localize
     - normalize defaults
     - project learner + grading models
     - renderer support checks
     - checksums
  -> ValidationReport / CompileResult
```

## Folder Map

- `schema/`: Zod schemas, shared types, JSON Schema export helpers.
- `manifest/`: block and player registries used by validators, prompt packs, and render integration.
- `diagnostics/`: diagnostic codes, message templates, ranges, and formatting helpers.
- `validate/`: workspace parsing plus structural and semantic validation.
- `compile/`: localized learner payloads, grading projections, normalization, and checksums.
- `grading/`: per-type graders, completion logic, and scoring policies.
- `prompt-pack/`: authoring prompts, cheat sheets, and answer-shape guidance.
- `fixtures/`: golden authoring samples and invalid cases for tests and CLI checks.
- `render/`: React-only preview and learner rendering surface, intentionally not re-exported here.

## Public Entry Points

Import engine contracts from `@/content-engine`. Import React render APIs from `@/content-engine/render`.

## Adding A Block Type

1. Add the new block shape to `schema/types.ts` and the lesson/activity schema that owns it.
2. Extend `schema/rich-content.ts` or `schema/activities.ts` if the block introduces new embedded content rules.
3. Register the block in `manifest/blocks.ts`.
4. Add validator checks under `validate/` if the block needs semantic constraints beyond Zod.
5. Implement the renderer and register it under `render/blocks/`.
6. Update the prompt-pack cheat sheet so authoring prompts can generate it correctly.
7. Add or extend a fixture that exercises the block.
8. Cover it with engine and render tests.

## Adding A Question Type

1. Add the schema in `schema/questions/` and wire it into the question unions.
2. Add the type to `QUESTION_TYPES`.
3. Extend `validate/semantic/answers.ts` for answer-shape or cross-reference rules.
4. Implement the grader and register it in `grading/index.ts` via `GRADERS`.
5. Add `PLAYER_MANIFEST` rows for each supported interaction type.
6. Implement and register the renderer(s) under `render/questions/`.
7. Update the prompt-pack cheat sheet and answer-shape guidance.
8. Add or extend fixtures plus grading, validation, and render tests.

## Answer Shapes

| Question type | `correctAnswer` shape |
| --- | --- |
| `single_choice` | `string` option id |
| `multiple_choice` | `string[]` option ids |
| `true_false` | `boolean` |
| `fill_blank` | `Record<blankId, string \| string[]>` |
| `short_answer` | `string[]` accepted answers |
| `numeric` | `number` with tolerance fields on the question |
| `matching` | `Array<{ left: id; right: id }>` |
| `ordering` | `string[]` item ids in the correct order |
| `classification` | `Record<itemId, categoryId>` |
| `essay` | no answer key, rubric only |
| `upload_answer` | no answer key, rubric only |
| `code_answer` | no answer key, rubric only |
| `question_group` | no direct answer key; child questions carry their own |

## CLI And Playground

Validate a workspace or fixture:

```bash
npm run content:validate -- src/content-engine/fixtures/ai-foundations --fixtures --publish
```

Compile a workspace into learner and grading artifacts:

```bash
npm run content:compile -- src/content-engine/fixtures/ai-foundations --fixtures --out compiled-out
```

Export JSON Schemas:

```bash
npm run schema:export
```

Run the development playground:

```bash
npm run dev
```

Then open `/dev/playground` to preview the shipped fixtures in `vi` and `en` using `@/content-engine/render`.
