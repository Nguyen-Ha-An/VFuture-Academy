'use client';
import type { ReactNode } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { QuestionRendererProps } from '../registry';
import { RichContentView } from '../RichContentView';
import { useDndSensors } from '../dnd';
import { QuestionFrame, plainText } from './QuestionFrame';
import type { OrderingQuestion } from './types';
import { t } from './types';
import { partState, questionTone } from '../tone';
import { CorrectMark } from './marks';
import { engineStrings, tr } from '../strings';
import type { Locale } from '../../schema/common';

function Row({ id, index, total, disabled, part, slot, children, move, locale }: { locale: Locale; id: string; index: number; total: number; disabled?: boolean; part?: string; slot?: string; children: ReactNode; move: (from: number, to: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id, disabled });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex items-center gap-2 rounded-md border p-2 ${part ? questionTone(partState(part)) : 'border-border bg-card'}`}>
      {slot ? <span className="w-16 shrink-0 text-xs font-semibold text-muted-foreground">{slot}</span> : <span className="w-6 text-sm text-muted-foreground">{index + 1}.</span>}
      <button type="button" aria-label={tr(locale, engineStrings.ordering.dragHandle)} {...attributes} {...listeners} disabled={disabled} className="cursor-grab px-1 text-muted-foreground">⋮⋮</button>
      <div className="flex-1 text-sm">{children}</div>
      {part === 'correct' ? <CorrectMark locale={locale} /> : null}
      <button type="button" aria-label={tr(locale, engineStrings.ordering.moveUp)} disabled={disabled || index === 0} onClick={() => move(index, index - 1)} className="rounded-md border border-border px-2 hover:bg-muted disabled:opacity-30">↑</button>
      <button type="button" aria-label={tr(locale, engineStrings.ordering.moveDown)} disabled={disabled || index === total - 1} onClick={() => move(index, index + 1)} className="rounded-md border border-border px-2 hover:bg-muted disabled:opacity-30">↓</button>
    </li>
  );
}

export function Ordering(props: QuestionRendererProps<OrderingQuestion>) {
  const { question: q, value, onChange, disabled, result, revealed, runtime } = props;
  const order = Array.isArray(value) && value.length === q.items.length ? (value as string[]) : q.items.map((i) => i.id);
  const sensors = useDndSensors();
  const move = (from: number, to: number) => onChange(arrayMove(order, from, to));
  const onDragEnd = (e: DragEndEvent) => { if (e.over && e.active.id !== e.over.id) move(order.indexOf(String(e.active.id)), order.indexOf(String(e.over.id))); };
  const key = revealed?.correctAnswers?.[q.id] as string[] | undefined;
  const itemText = (id: string) => plainText(q.items.find((i) => i.id === id)?.content);
  return (
    <QuestionFrame {...props}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ol aria-label={plainText(q.content)} className="flex flex-col gap-2">{order.map((id, i) => <Row key={id} id={id} index={i} total={order.length} disabled={disabled} part={result?.parts?.[id]} slot={q.slots?.[i]?.label} move={move} locale={runtime.locale}><RichContentView content={q.items.find((it) => it.id === id)!.content} runtime={runtime} /></Row>)}</ol>
        </SortableContext>
      </DndContext>
      {key ? <p data-answer-key className="mt-2 text-sm text-primary">{t(runtime.locale, 'Thứ tự đúng', 'Correct order')}: {key.map(itemText).join(' → ')}</p> : null}
    </QuestionFrame>
  );
}
