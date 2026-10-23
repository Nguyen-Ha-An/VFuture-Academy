import { z } from 'zod';
import { BLOCK_MANIFEST } from '../manifest/blocks';
import { buildContentBlockSchemas, VIDEO_PROVIDERS } from '../schema/rich-content';
import type { ProfileContext } from './context';
import type { Policy } from './ledger';
import { buildAuthoringPrimitives, localize } from './primitives';

const storage = buildContentBlockSchemas(z.never());

/** Every storage field needs an explicit profile decision when storage evolves. */
export const CONTENT_FIELD_POLICY = {
  paragraph: { id: 'context', type: 'reuse', content: 'context', align: 'reuse' } satisfies Record<keyof typeof storage.paragraph.shape, Policy>,
  heading: { id: 'context', type: 'reuse', level: 'tighten', content: 'context', align: 'reuse' } satisfies Record<keyof typeof storage.heading.shape, Policy>,
  list: { id: 'context', type: 'reuse', ordered: 'reuse', items: 'tighten' } satisfies Record<keyof typeof storage.list.shape, Policy>,
  quote: { id: 'context', type: 'reuse', content: 'context', author: 'tighten' } satisfies Record<keyof typeof storage.quote.shape, Policy>,
  image: { id: 'context', type: 'reuse', src: 'context', alt: 'tighten', caption: 'tighten', width: 'reuse' } satisfies Record<keyof typeof storage.image.shape, Policy>,
  videoBySrc: { id: 'context', type: 'reuse', src: 'forbid', poster: 'forbid', caption: 'tighten' } satisfies Record<keyof typeof storage.video.options[0]['shape'], Policy>,
  videoByProvider: { id: 'context', type: 'reuse', provider: 'reuse', url: 'tighten', caption: 'tighten' } satisfies Record<keyof typeof storage.video.options[1]['shape'], Policy>,
  audio: { id: 'context', type: 'reuse', src: 'context', label: 'tighten' } satisfies Record<keyof typeof storage.audio.shape, Policy>,
  table: { id: 'context', type: 'reuse', headers: 'tighten', rows: 'tighten', caption: 'tighten' } satisfies Record<keyof typeof storage.table.shape, Policy>,
  code: { id: 'context', type: 'reuse', language: 'reuse', code: 'tighten', filename: 'reuse', highlightLines: 'reuse', showLineNumbers: 'reuse' } satisfies Record<keyof typeof storage.code.shape, Policy>,
  divider: { id: 'context', type: 'reuse' } satisfies Record<keyof typeof storage.divider.shape, Policy>,
  embed: { id: 'context', type: 'reuse', url: 'tighten', title: 'tighten', aspectRatio: 'reuse' } satisfies Record<keyof typeof storage.embed.shape, Policy>,
  pdf: { id: 'context', type: 'reuse', src: 'context', title: 'tighten', height: 'reuse' } satisfies Record<keyof typeof storage.pdf.shape, Policy>,
  callout: { id: 'context', type: 'reuse', variant: 'reuse', title: 'tighten', blocks: 'tighten' } satisfies Record<keyof typeof storage.callout.shape, Policy>,
  math: { id: 'forbid', type: 'forbid', latex: 'forbid' } satisfies Record<keyof typeof storage.math.shape, Policy>,
  diagram: { id: 'forbid', type: 'forbid', src: 'forbid', alt: 'forbid' } satisfies Record<keyof typeof storage.diagram.shape, Policy>,
} as const;
export const QUESTION_CONTENT_BLOCK_TYPES = [
  'paragraph', 'list', 'table', 'code', 'quote', 'image', 'audio', 'video', 'divider',
] as const;

type Primitives = ReturnType<typeof buildAuthoringPrimitives>;

function buildListItems(runs: z.ZodType) {
  // Storage's ListItemSchema is recursive. Three explicit levels make the
  // authoring schema finite while keeping each level within storage's cap.
  const level2 = z.strictObject({ content: runs });
  const level1 = z.strictObject({ content: runs, items: z.array(level2).max(50).optional() });
  return z.strictObject({ content: runs, items: z.array(level1).max(50).optional() });
}

function buildContentLeaves(primitives: Primitives, runs: z.ZodType, requiredId: boolean) {
  const id = requiredId ? primitives.id : primitives.id.optional();
  const listItem = buildListItems(runs);
  const tableCell = z.strictObject({ content: runs, align: storage.paragraph.shape.align });
  const label = primitives.l10nLabel;

  return {
    paragraph: z.strictObject({ id, type: storage.paragraph.shape.type, content: runs, align: storage.paragraph.shape.align }),
    heading: z.strictObject({ id, type: storage.heading.shape.type, level: z.literal([1, 2, 3, 4]), content: runs, align: storage.heading.shape.align }),
    list: z.strictObject({ id, type: storage.list.shape.type, ordered: storage.list.shape.ordered, items: z.array(listItem).min(1).max(100) }),
    quote: z.strictObject({ id, type: storage.quote.shape.type, content: runs, author: label.optional() }),
    image: z.strictObject({ id, type: storage.image.shape.type, src: primitives.mediaRef, alt: label, caption: label.optional(), width: storage.image.shape.width }),
    video: z.strictObject({ id, type: z.literal('video'), provider: z.enum(VIDEO_PROVIDERS), url: primitives.videoUrl, caption: label.optional() }),
    audio: z.strictObject({ id, type: storage.audio.shape.type, src: primitives.mediaRef, label: label.optional() }),
    table: z.strictObject({
      id, type: storage.table.shape.type,
      headers: z.array(tableCell).min(1).max(12).optional(),
      rows: z.array(z.array(tableCell).min(1).max(12)).min(1).max(100),
      caption: label.optional(),
    }),
    code: z.strictObject({
      id, type: storage.code.shape.type,
      language: storage.code.shape.language,
      code: storage.code.shape.code.min(1),
      filename: storage.code.shape.filename,
      highlightLines: storage.code.shape.highlightLines,
      showLineNumbers: storage.code.shape.showLineNumbers,
    }),
    divider: z.strictObject({ id, type: storage.divider.shape.type }),
    embed: z.strictObject({ id, type: storage.embed.shape.type, url: primitives.embedUrl, title: label, aspectRatio: storage.embed.shape.aspectRatio }),
    pdf: z.strictObject({ id, type: storage.pdf.shape.type, src: primitives.mediaRef, title: label, height: storage.pdf.shape.height }),
  };
}

function contentLeafVariants<T extends ReturnType<typeof buildContentLeaves>>(leaves: T) {
  return BLOCK_MANIFEST
    .filter((block) => block.renderable && block.category === 'content')
    .map((block) => {
      if (!(block.type in leaves)) throw new Error(`Missing authoring schema for renderable content block ${block.type}`);
      return leaves[block.type as keyof T];
    }) as unknown as [z.core.$ZodTypeDiscriminable, ...z.core.$ZodTypeDiscriminable[]];
}

function questionVariants<T extends ReturnType<typeof buildContentLeaves>>(leaves: T) {
  return QUESTION_CONTENT_BLOCK_TYPES.map((type) => {
    if (!BLOCK_MANIFEST.some((block) => block.type === type && block.renderable)) {
      throw new Error(`Question content block ${type} is not renderable`);
    }
    return leaves[type];
  }) as unknown as [z.core.$ZodTypeDiscriminable, ...z.core.$ZodTypeDiscriminable[]];
}

/** Pure, finite content schemas. A lesson builder supplies its complete leaf union to makeLessonCallout. */
export function buildAuthoringContent(ctx: ProfileContext) {
  const primitives = buildAuthoringPrimitives(ctx);
  // Rich content sits inside a locale value, so its runs are plain even in a
  // bilingual course. Top-level lesson blocks use localized runs instead.
  const contentLeaves = buildContentLeaves(primitives, primitives.runs, false);
  const contentLeafBlock = z.discriminatedUnion('type', contentLeafVariants(contentLeaves));
  const makeContentCallout = (children: z.ZodType) => z.strictObject({
    id: primitives.id.optional(),
    type: storage.callout.shape.type,
    variant: storage.callout.shape.variant,
    title: primitives.l10nLabel.optional(),
    blocks: z.array(children).min(1).max(50),
  });
  const contentCallout = makeContentCallout(contentLeafBlock);
  const contentBlock = z.discriminatedUnion('type', [
    ...contentLeafVariants(contentLeaves), contentCallout,
  ] as [z.core.$ZodTypeDiscriminable, ...z.core.$ZodTypeDiscriminable[]]);
  const richContent = z.strictObject({ blocks: z.array(contentBlock).min(1).max(200) });

  const questionContentBlock = z.discriminatedUnion('type', questionVariants(contentLeaves));
  const questionRichContentBody = z.strictObject({ blocks: z.array(questionContentBlock).min(1).max(200) });

  const fillBlankLeaves = buildContentLeaves(primitives, primitives.fillBlankRuns, false);
  const fillBlankBlock = z.discriminatedUnion('type', [
    fillBlankLeaves.paragraph, fillBlankLeaves.list, fillBlankLeaves.table,
  ]);
  const fillBlankContentBody = z.strictObject({ blocks: z.array(fillBlankBlock).min(1).max(200) });

  const lessonContentLeaves = buildContentLeaves(primitives, primitives.localizedRuns, true);
  const lessonContentLeafBlock = z.discriminatedUnion('type', contentLeafVariants(lessonContentLeaves));
  const makeLessonCallout = (children: z.ZodType) => z.strictObject({
    id: primitives.id,
    type: storage.callout.shape.type,
    variant: storage.callout.shape.variant,
    title: primitives.l10nLabel.optional(),
    blocks: z.array(children).min(1).max(50),
  });
  const lessonContentBlock = z.discriminatedUnion('type', [
    ...contentLeafVariants(lessonContentLeaves), makeLessonCallout(lessonContentLeafBlock),
  ] as [z.core.$ZodTypeDiscriminable, ...z.core.$ZodTypeDiscriminable[]]);

  return {
    ...primitives,
    contentLeaves,
    contentLeafBlock,
    contentBlock,
    richContent,
    l10nRichContent: localize(richContent, ctx.languageMode),
    questionContentBlock,
    questionRichContentBody,
    questionRichContent: localize(questionRichContentBody, ctx.languageMode),
    fillBlankBlock,
    fillBlankContentBody,
    fillBlankContent: localize(fillBlankContentBody, ctx.languageMode),
    lessonContentLeaves,
    lessonContentLeafBlock,
    lessonContentBlock,
    makeLessonCallout,
  };
}
