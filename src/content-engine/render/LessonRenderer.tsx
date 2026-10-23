'use client';
import { useEffect } from 'react';
import type { LessonBlock } from '../schema/types';
import type { LearnerItem } from '../compile';
import type { LessonRuntime } from './runtime';
import { BlockList } from './BlockList';
import { asText } from './text';
import { RenderScope, useFrameDepth } from './render-context';
export function LessonRenderer({ item, runtime, headingLevel = 1, presentation = false, hideTitle = false }: { item: LearnerItem; runtime: LessonRuntime; headingLevel?: 1 | 2; presentation?: boolean; hideTitle?: boolean }) {
  useEffect(() => { runtime.markViewed(); }, [runtime]);
  const objectives = (item.objectives as string[] | undefined) ?? [];
  const minutes = item.estimatedMinutes as number | undefined;
  const vi = runtime.locale === 'vi';
  const Title = headingLevel === 1 ? 'h1' : 'h2';
  const refined = presentation && hideTitle;
  const depth = useFrameDepth();
  return (
    // With `presentation` the learner activity frame owns the width (reading 760px) and the meta line.
    <article className={presentation ? 'learner-reader-prose min-w-0' : 'mx-auto max-w-3xl'}>
      {!hideTitle || item.summary || (minutes && !refined) || objectives.length ? <header className={refined ? 'mb-8 space-y-6' : 'mb-6'}>
        {!hideTitle ? <Title className="text-3xl font-bold tracking-tight">{asText(item.title)}</Title> : null}
        {item.summary ? <p className={refined ? 'max-w-[68ch] text-base leading-7 text-muted-foreground' : 'mt-1 text-muted-foreground'}>{asText(item.summary as string)}</p> : null}
        {minutes && !refined ? <p className="mt-1 text-sm text-muted-foreground">{minutes} {vi ? 'phút' : 'min'}</p> : null}
        {objectives.length ? refined
          ? <section aria-label={vi ? 'Mục tiêu' : 'Objectives'}><p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-primary">{vi ? 'Mục tiêu' : 'Objectives'}</p><ul className="mt-3 divide-y divide-border border-y border-border text-sm leading-6">{objectives.map((o, i) => <li key={i} className="flex gap-3 py-2.5"><span aria-hidden="true" className="shrink-0 font-mono text-xs leading-6 text-muted-foreground">{String(i + 1).padStart(2, '0')}</span><span className="min-w-0">{asText(o)}</span></li>)}</ul></section>
          : <div className="mt-3 rounded-md bg-muted p-3"><p className="text-sm font-semibold">{vi ? 'Mục tiêu' : 'Objectives'}</p><ul className="list-disc pl-5 text-sm">{objectives.map((o, i) => <li key={i}>{asText(o)}</li>)}</ul></div>
          : null}
      </header> : null}
      <RenderScope ownerLevel={hideTitle ? 1 : headingLevel} blocks={item.blocks as LessonBlock[]}><BlockList blocks={item.blocks as LessonBlock[]} runtime={runtime} path="/blocks" depth={depth} /></RenderScope>
    </article>
  );
}
