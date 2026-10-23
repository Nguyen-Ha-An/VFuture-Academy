import { makeDiagnostic, type Diagnostic, type DocumentRef } from '../diagnostics';
import { isRenderableBlock } from '../manifest/blocks';
import { resolvePlayer } from '../manifest/players';
import type { AnyDocument } from '../schema/document';
import type { Question } from '../schema/questions';
import type { L10nRichContent, LessonBlock } from '../schema/types';
import { contentByLocale, forEachQuestion, itemEntriesOf, walkBlocks } from './walk';
import type { ItemDocument } from './workspace';

/**
 * Renderer support for a document validated on its own, outside a course workspace.
 *
 * `checkRendererSupport` in `./index.ts` needs a `ParsedWorkspace`, so the standalone save
 * paths had no renderer check at all: a `resource` whose body is a single reserved `math`
 * block validated clean and persisted, and nothing could draw it. This asks the same question
 * of one document, from the same two manifests, so a standalone save and a workspace save
 * agree about what is renderable.
 *
 * Pure: it reports, and never repairs, renames or reshapes anything. It builds no course
 * scaffold around the document, so a `course` document yields nothing here.
 *
 * Expects a document that already passed `validateDocument`. A malformed body is the schema's
 * report to make, not this one's.
 */
export function checkStandaloneRendererSupport(doc: AnyDocument, ref: DocumentRef): Diagnostic[] {
  const out: Diagnostic[] = [];
  switch (doc.kind) {
    case 'resource':
      richContent(out, ref, '/body', doc.body);
      break;
    case 'assignment':
      richContent(out, ref, '/instructions', doc.instructions);
      break;
    case 'question_bundle':
      questionEntries(out, ref, doc.questions, '/questions');
      break;
    case 'lesson':
      lessonBlocks(out, ref, doc.blocks);
      entryScopes(out, ref, doc);
      break;
    case 'exam':
      richContent(out, ref, '/description', doc.description);
      doc.sections.forEach((section, i) => richContent(out, ref, `/sections/${i}/instructions`, section.instructions));
      entryScopes(out, ref, doc);
      break;
    default:
      // A course document carries stubs and inline items, which the workspace pipeline
      // already renderer-checks. Nothing standalone to inspect.
      break;
  }
  return out;
}

const unsupported = (ref: DocumentRef, path: string, type: string): Diagnostic =>
  makeDiagnostic('E_RENDERER_UNSUPPORTED', { ref, path, meta: { type } });

/**
 * An entry the schema would already have rejected keeps its slot as an inert divider, so
 * surviving siblings keep authentic indices and the walk cannot trip over it. Its real
 * problem is reported by structural validation, not a second time as "unrenderable".
 */
const asBlock = (value: unknown): LessonBlock =>
  (value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string'
    ? value
    : { type: 'divider' }) as LessonBlock;

/** Walks one block tree, reporting any type no renderer implements. */
function blockTree(out: Diagnostic[], ref: DocumentRef, basePath: string, blocks: unknown): void {
  if (!Array.isArray(blocks)) return;
  walkBlocks(blocks.map(asBlock), basePath, ({ block, path }) => {
    if (!isRenderableBlock(block.type)) out.push(unsupported(ref, path, block.type));
  });
}

/**
 * A rich-content field, per locale. A plain `RichContent` keeps its natural pointer
 * (`/body/blocks/0`); a locale map carries the locale, so an author is told which
 * translation is unrenderable (`/body/vi/blocks/0`).
 */
function richContent(out: Diagnostic[], ref: DocumentRef, base: string, content: L10nRichContent | undefined): void {
  for (const [locale, rich] of Object.entries(contentByLocale(content))) {
    blockTree(out, ref, locale === '*' ? `${base}/blocks` : `${base}/${locale}/blocks`, (rich as { blocks?: unknown } | undefined)?.blocks);
  }
}

/** Lesson blocks, plus the rich content activity blocks carry and containers do not nest. */
function lessonBlocks(out: Diagnostic[], ref: DocumentRef, blocks: unknown): void {
  if (!Array.isArray(blocks)) return;
  walkBlocks(blocks.map(asBlock), '/blocks', ({ block, path }) => {
    if (!isRenderableBlock(block.type)) out.push(unsupported(ref, path, block.type));
    // Quiz questions are reached through `itemEntriesOf`, so only prose is collected here.
    switch (block.type) {
      case 'quiz': richContent(out, ref, `${path}/intro`, block.intro); break;
      case 'reflection': richContent(out, ref, `${path}/prompt`, block.prompt); break;
      case 'assignment': richContent(out, ref, `${path}/instructions`, block.instructions); break;
      case 'flashcards':
        block.cards.forEach((card, i) => {
          richContent(out, ref, `${path}/cards/${i}/front`, card.front);
          richContent(out, ref, `${path}/cards/${i}/back`, card.back);
        });
        break;
      default: break;
    }
  });
}

/** Every place a lesson or exam holds question entries. */
function entryScopes(out: Diagnostic[], ref: DocumentRef, doc: ItemDocument): void {
  for (const scope of itemEntriesOf(doc)) questionEntries(out, ref, scope.entries, scope.path);
}

/** Player support and prose for each inline question; `$ref`/`$pool` entries are not ours. */
function questionEntries(out: Diagnostic[], ref: DocumentRef, entries: unknown, basePath: string): void {
  if (!Array.isArray(entries)) return;
  forEachQuestion(entries, basePath, ({ question, path }) => {
    if (!resolvePlayer(question.type, question.display?.interactionType).ok) {
      out.push(unsupported(ref, path, `${question.type}:${question.display?.interactionType ?? 'default'}`));
    }
    for (const field of questionContent(question, path)) richContent(out, ref, field.path, field.content);
  });
}

/**
 * Every rich-content field a question can carry, with its pointer. This is the same set the
 * answer checks walk for stray blank runs, so question prose is never inspected in one place
 * and missed in the other.
 */
function questionContent(q: Question, path: string): { path: string; content: L10nRichContent | undefined }[] {
  const out: { path: string; content: L10nRichContent | undefined }[] = [
    { path: `${path}/content`, content: q.content },
    { path: `${path}/explanation`, content: q.explanation },
    { path: `${path}/hint`, content: q.hint },
  ];
  if ('options' in q && Array.isArray(q.options)) {
    q.options.forEach((option, i) => {
      out.push({ path: `${path}/options/${i}/content`, content: option.content });
      out.push({ path: `${path}/options/${i}/feedback`, content: option.feedback });
    });
  }
  if (q.type === 'matching') {
    q.left.forEach((item, i) => out.push({ path: `${path}/left/${i}/content`, content: item.content }));
    q.right.forEach((item, i) => out.push({ path: `${path}/right/${i}/content`, content: item.content }));
  }
  if (q.type === 'ordering' || q.type === 'classification') {
    q.items.forEach((item, i) => out.push({ path: `${path}/items/${i}/content`, content: item.content }));
  }
  if (q.type === 'question_group') out.push({ path: `${path}/sharedContent`, content: q.sharedContent });
  return out;
}
