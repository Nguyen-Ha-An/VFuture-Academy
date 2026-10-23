'use client';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { headingShift, headingTag, minHeadingLevel, sectionLevelFor, type HeadingTag } from './heading-shift';

/*
 * Outline and frame context for renderers. The default value reproduces the engine's historical
 * output (authored levels verbatim, container titles at h3), so surfaces that never opt in are
 * unchanged. Pages that own the headings above the content wrap it in `RenderScope`.
 */
interface RenderContextValue { shift: number; sectionLevel: number; depth: number }
const RenderContext = createContext<RenderContextValue>({ shift: 0, sectionLevel: 3, depth: 0 });

/** Declares the heading level of the surrounding owner (page title, section title) for `blocks`. */
export function RenderScope({ ownerLevel, blocks, children }: { ownerLevel: number; blocks: readonly unknown[] | undefined; children: ReactNode }) {
  const parent = useContext(RenderContext);
  const value = useMemo(() => {
    const min = minHeadingLevel(blocks);
    return { shift: headingShift(ownerLevel, min), sectionLevel: sectionLevelFor(ownerLevel, min !== null), depth: parent.depth };
  }, [ownerLevel, blocks, parent.depth]);
  return <RenderContext.Provider value={value}>{children}</RenderContext.Provider>;
}

/** Sets the frame nesting depth for descendants (0 is a card, ≥1 is flat). */
export function FrameScope({ depth, children }: { depth: number; children: ReactNode }) {
  const parent = useContext(RenderContext);
  const value = useMemo(() => ({ ...parent, depth }), [parent, depth]);
  return <RenderContext.Provider value={value}>{children}</RenderContext.Provider>;
}

/** The tag for an authored heading after the scope's shift. */
export function useHeadingTag(authored: number): HeadingTag {
  return headingTag(authored + useContext(RenderContext).shift);
}

/** The tag for a container title; `offset` goes deeper for sub-titles inside the container. */
export function useSectionTag(offset = 0): HeadingTag {
  return headingTag(useContext(RenderContext).sectionLevel + offset);
}

export function useFrameDepth(): number {
  return useContext(RenderContext).depth;
}
