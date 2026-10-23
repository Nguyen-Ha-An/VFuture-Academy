'use client';
import { useState } from 'react';
import type { StepperBlock, LessonBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { BlockList } from '../BlockList';
import { asText } from '../text';
import { blockFrame, buttonClass } from '../tone';
import { useSectionTag } from '../render-context';
type State = { step: number; maxReached: number; completed?: boolean };
type StepState = 'current' | 'visited' | 'available' | 'locked';
/** Current is the one signal fill; visited steps carry a ✓ so state is never colour alone. */
const stepClass: Record<StepState, string> = {
  current: 'inline-flex min-h-11 items-center gap-1 rounded-md border border-primary bg-primary px-3 font-medium text-primary-foreground',
  visited: 'inline-flex min-h-11 items-center gap-1 rounded-md border border-border bg-muted px-3 text-foreground hover:border-input',
  available: 'inline-flex min-h-11 items-center gap-1 rounded-md border border-border bg-transparent px-3 text-muted-foreground hover:bg-muted hover:text-foreground',
  locked: 'inline-flex min-h-11 items-center gap-1 rounded-md border border-border bg-transparent px-3 text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
};
export function Stepper({ block, runtime, path, depth }: BlockRendererProps<StepperBlock<LessonBlock>>) {
  const [state, setState] = useState<State>(runtime.getBlockState<State>(block.id) ?? { step: 0, maxReached: 0 });
  const vi = runtime.locale === 'vi';
  const Title = useSectionTag();
  const last = block.steps.length - 1;
  const go = (n: number) => { if (n < 0 || n > last) return; if (block.linear && n > state.maxReached + 1) return; const next: State = { step: n, maxReached: Math.max(state.maxReached, n) }; if (n === last) { next.completed = true; runtime.onActivityComplete(block.id); } setState(next); runtime.setBlockState(block.id, next); };
  const stepState = (i: number): StepState => (i === state.step ? 'current' : i <= state.maxReached ? 'visited' : block.linear && i > state.maxReached + 1 ? 'locked' : 'available');
  const step = block.steps[state.step];
  return (
    <section className={blockFrame(depth)} aria-label={vi ? 'Từng bước' : 'Steps'}>
      <ol className="mb-4 flex flex-wrap gap-2 text-sm">{block.steps.map((s, i) => { const st = stepState(i); return <li key={s.id}><button type="button" data-state={st} disabled={st === 'locked'} aria-current={st === 'current' ? 'step' : undefined} onClick={() => go(i)} className={stepClass[st]}>{st === 'visited' ? <><span aria-hidden="true">✓</span><span className="sr-only">{vi ? 'Đã xem: ' : 'Visited: '}</span></> : null}{i + 1}. {asText(s.title)}</button></li>; })}</ol>
      <Title className="mb-2 font-semibold">{asText(step.title)}</Title>
      <BlockList blocks={step.blocks} runtime={runtime} path={`${path}/steps/${state.step}/blocks`} depth={depth + 1} />
      <div className="mt-4 flex items-center justify-between gap-3"><button type="button" onClick={() => go(state.step - 1)} disabled={state.step === 0} className={buttonClass.secondary}>{vi ? 'Trước' : 'Previous'}</button>{state.step < last ? <button type="button" onClick={() => go(state.step + 1)} className={buttonClass.primary}>{vi ? 'Bước tiếp' : 'Next step'}</button> : <span className="text-sm font-medium text-primary">{vi ? 'Đã hoàn thành' : 'Completed'}</span>}</div>
    </section>
  );
}
