'use client';
import { useState } from 'react';
import type { FlashcardsBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { RichContentView } from '../RichContentView';
import { asRich } from '../text';
import { blockFrame, buttonClass } from '../tone';
type State = { index: number; seen: string[]; again: string[]; completed?: boolean };
export function Flashcards({ block, runtime, path, depth }: BlockRendererProps<FlashcardsBlock>) {
  const initial = runtime.getBlockState<State>(block.id) ?? { index: 0, seen: [], again: [] };
  const [state, setState] = useState<State>(initial);
  const [flipped, setFlipped] = useState(false);
  const vi = runtime.locale === 'vi';
  const card = block.cards[Math.min(state.index, block.cards.length - 1)];
  const finished = state.index >= block.cards.length;
  const advance = (again: boolean) => {
    const seen = state.seen.includes(card.id) ? state.seen : [...state.seen, card.id];
    const againList = again && !state.again.includes(card.id) ? [...state.again, card.id] : state.again;
    const next: State = { index: state.index + 1, seen, again: againList };
    if (next.index >= block.cards.length) { next.completed = true; runtime.onActivityComplete(block.id); }
    runtime.setBlockState(block.id, next); setState(next); setFlipped(false);
  };
  if (finished) return <div className={`text-center ${blockFrame(depth)}`}><p className="font-medium">{vi ? `Hoàn thành ${block.cards.length} thẻ` : `Finished ${block.cards.length} cards`}</p><p className="text-sm text-muted-foreground">{vi ? `Cần xem lại: ${state.again.length}` : `Marked for review: ${state.again.length}`}</p><button type="button" className={`mt-2 ${buttonClass.quiet}`} onClick={() => { const s = { index: 0, seen: state.seen, again: [] }; runtime.setBlockState(block.id, { ...s, completed: true }); setState(s); }}>{vi ? 'Học lại' : 'Restart'}</button></div>;
  return (
    <div className={blockFrame(depth)}>
      <p className="mb-2 font-mono text-xs text-muted-foreground">{state.index + 1} / {block.cards.length}</p>
      <div className="min-h-32 rounded-md bg-muted p-4"><RichContentView content={asRich(flipped ? card.back : card.front)} runtime={runtime} path={`${path}/cards/${state.index}`} /></div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setFlipped((f) => !f)} className={buttonClass.secondary}>{vi ? 'Lật thẻ' : 'Flip'}</button>
        {flipped ? <><button type="button" onClick={() => advance(false)} className={buttonClass.primary}>{vi ? 'Đã hiểu' : 'Got it'}</button><button type="button" onClick={() => advance(true)} className={buttonClass.secondary}>{vi ? 'Xem lại sau' : 'Review again'}</button></> : null}
      </div>
    </div>
  );
}
