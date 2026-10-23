import type { LessonBlock, L10nRichContent, ContentBlock, RichContent } from '../schema/types';
import type { Run } from '../schema/inline';
import { isBlankRun } from '../schema/inline';
import { isLocaleMap, type Locale } from '../schema/common';
import type { Question } from '../schema/questions';
import { isPoolDraw, isQuestionRef } from '../schema/questions';
import type { ItemDocument } from './workspace';

export interface BlockVisit { block: LessonBlock; path: string; depth: number }
const CONTAINER_CHILDREN: Record<string, (b: LessonBlock) => { path: string; blocks: LessonBlock[] }[]> = {
  callout: (b) => [{ path: '/blocks', blocks: (b as { blocks: LessonBlock[] }).blocks }],
  reveal: (b) => [{ path: '/blocks', blocks: (b as { blocks: LessonBlock[] }).blocks }],
  accordion: (b) => (b as { items: { blocks: LessonBlock[] }[] }).items.map((it, i) => ({ path: `/items/${i}/blocks`, blocks: it.blocks })),
  tabs: (b) => (b as { items: { blocks: LessonBlock[] }[] }).items.map((it, i) => ({ path: `/items/${i}/blocks`, blocks: it.blocks })),
  stepper: (b) => (b as { steps: { blocks: LessonBlock[] }[] }).steps.map((st, i) => ({ path: `/steps/${i}/blocks`, blocks: st.blocks })),
};
export const isContainer = (type: string) => type in CONTAINER_CHILDREN;

/** Depth-first walk over a block tree. `depth` counts enclosing containers (top level = 0). */
export function walkBlocks(blocks: LessonBlock[], basePath: string, visit: (v: BlockVisit) => void, depth = 0): void {
  blocks.forEach((block, i) => {
    const path = `${basePath}/${i}`;
    visit({ block, path, depth });
    const kids = CONTAINER_CHILDREN[block.type];
    if (kids) for (const k of kids(block)) walkBlocks(k.blocks, `${path}${k.path}`, visit, depth + 1);
  });
}

export interface QuestionVisit { question: Question; path: string; parentPath?: string }
/** Visit inline questions (and group children); refs and pools are skipped. */
export function forEachQuestion(entries: unknown[], basePath: string, visit: (v: QuestionVisit) => void): void {
  entries.forEach((e, i) => {
    if (isQuestionRef(e) || isPoolDraw(e)) return;
    const q = e as Question;
    const path = `${basePath}/${i}`;
    visit({ question: q, path });
    if (q.type === 'question_group') q.questions.forEach((c, j) => visit({ question: c, path: `${path}/questions/${j}`, parentPath: path }));
  });
}

export interface EntryScope { scope: string; kind: 'quiz' | 'section'; path: string; entries: unknown[] }
/** Every place an item holds question entries: quiz blocks in lessons, sections in exams. */
export function itemEntriesOf(doc: ItemDocument): EntryScope[] {
  const out: EntryScope[] = [];
  if (doc.kind === 'lesson') walkBlocks(doc.blocks, '/blocks', ({ block, path }) => { if (block.type === 'quiz') out.push({ scope: block.id, kind: 'quiz', path: `${path}/questions`, entries: block.questions }); });
  if (doc.kind === 'exam') doc.sections.forEach((s, i) => out.push({ scope: s.id, kind: 'section', path: `/sections/${i}/questions`, entries: s.questions }));
  return out;
}

/** Content per locale: a plain RichContent is treated as locale '*'. */
export function contentByLocale(content: L10nRichContent | undefined): Record<string, RichContent> {
  if (!content) return {};
  if (isLocaleMap(content)) return Object.fromEntries(Object.entries(content).filter(([, v]) => v) as [Locale, RichContent][]);
  return { '*': content as RichContent };
}
export function runsOf(blocks: ContentBlock[]): Run[] {
  const runs: Run[] = [];
  const visit = (bs: ContentBlock[]) => bs.forEach((b) => {
    if ('content' in b && Array.isArray(b.content)) runs.push(...(b.content as Run[]));
    if (b.type === 'list') { const walkItems = (items: { content: Run[]; items?: unknown[] }[]) => items.forEach((it) => { runs.push(...it.content); if (it.items) walkItems(it.items as typeof items); }); walkItems(b.items); }
    if (b.type === 'table') { b.headers?.forEach((c) => runs.push(...c.content)); b.rows.forEach((r) => r.forEach((c) => runs.push(...c.content))); }
    if (b.type === 'callout') visit(b.blocks);
  });
  visit(blocks);
  return runs;
}
export function blankIdsOf(content: L10nRichContent | undefined): Record<string, Set<string>> {
  return Object.fromEntries(Object.entries(contentByLocale(content)).map(([loc, rc]) => [loc, new Set(runsOf(rc.blocks).filter(isBlankRun).map((r) => r.blank))]));
}
export const l10nValues = (v: unknown): string[] => typeof v === 'string' ? [v] : isLocaleMap(v) ? (Object.values(v).filter((x) => typeof x === 'string') as string[]) : [];
