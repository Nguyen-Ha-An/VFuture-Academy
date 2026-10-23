/*
 * Heading outline arithmetic. Authors pick heading levels for the lesson on its own (h1 is allowed),
 * but the page that renders a lesson already owns an h1 (and sometimes an h2). The renderer shifts
 * every authored heading so the shallowest one sits one level below its owner, and gives container
 * titles (accordion, stepper, quiz, …) the level after the authored headings.
 */

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type HeadingTag = `h${HeadingLevel}`;

type Node = { type?: unknown; level?: unknown; blocks?: unknown; items?: unknown; steps?: unknown };

/** The shallowest authored heading level, walking container children (callout, reveal, accordion, tabs, stepper). */
export function minHeadingLevel(blocks: readonly unknown[] | undefined): number | null {
  let min: number | null = null;
  const visit = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const node = raw as Node;
      if (node.type === 'heading' && typeof node.level === 'number') min = min === null ? node.level : Math.min(min, node.level);
      visit(node.blocks);
      for (const group of [node.items, node.steps]) if (Array.isArray(group)) for (const child of group) if (child && typeof child === 'object') visit((child as Node).blocks);
    }
  };
  visit(blocks);
  return min;
}

/**
 * How far to move authored headings so the shallowest lands at `ownerLevel + 1`: demoting an h1 under
 * the page h1, and promoting a lesson that starts at h3 or deeper so the outline never skips a level.
 */
export const headingShift = (ownerLevel: number, minLevel: number | null): number => (minLevel === null ? 0 : ownerLevel + 1 - minLevel);

/** Container titles sit below the owner, and below the authored headings when there are any. */
export const sectionLevelFor = (ownerLevel: number, hasHeadings: boolean): number => Math.min(6, ownerLevel + 1 + (hasHeadings ? 1 : 0));

export const headingTag = (level: number): HeadingTag => `h${Math.min(6, Math.max(1, level)) as HeadingLevel}`;
