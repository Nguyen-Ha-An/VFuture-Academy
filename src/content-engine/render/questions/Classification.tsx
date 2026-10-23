'use client';
import type { ReactNode } from 'react';
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core';
import type { QuestionRendererProps } from '../registry';
import { RichContentView } from '../RichContentView';
import { useDndSensors } from '../dnd';
import { QuestionFrame, plainText } from './QuestionFrame';
import type { ClassificationQuestion } from './types';
import { t } from './types';
import { fieldClass, partState, questionTone } from '../tone';
import { CorrectMark } from './marks';
import { useSectionTag } from '../render-context';
import type { Locale } from '../../schema/common';

function Chip({ id, disabled, part, locale, children }: { id: string; disabled?: boolean; part?: string; locale: Locale; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id, disabled });
  return <div ref={setNodeRef} {...attributes} {...listeners} style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-sm ${part ? questionTone(partState(part)) : 'border-border bg-background'}`}>{children}{part === 'correct' ? <CorrectMark locale={locale} /> : null}</div>;
}
function Bucket({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const Title = useSectionTag(1);
  return <section ref={setNodeRef} role="region" aria-label={label} className={`min-h-24 rounded-md border-2 border-dashed p-2 ${isOver ? 'border-primary bg-accent' : 'border-input'}`}><Title className="mb-2 text-sm font-semibold">{label}</Title><div className="flex flex-wrap gap-2">{children}</div></section>;
}

export function Classification(props: QuestionRendererProps<ClassificationQuestion>) {
  const { question: q, value, onChange, disabled, result, revealed, runtime } = props;
  const placed = (value && typeof value === 'object' ? value : {}) as Record<string, string>;
  const sensors = useDndSensors();
  const assign = (item: string, cat: string) => { const next = { ...placed }; if (cat) next[item] = cat; else delete next[item]; onChange(next); };
  const onDragEnd = (e: DragEndEvent) => { if (e.over) assign(String(e.active.id), String(e.over.id) === 'pool' ? '' : String(e.over.id)); };
  const key = revealed?.correctAnswers?.[q.id] as Record<string, string> | undefined;
  const catLabel = (id: string) => q.categories.find((c) => c.id === id)?.label ?? id;
  const chip = (it: ClassificationQuestion['items'][number]) => <Chip key={it.id} id={it.id} disabled={disabled} part={result?.parts?.[it.id]} locale={runtime.locale}><RichContentView content={it.content} runtime={runtime} />{key ? <span data-answer-key className="ml-1 text-xs text-primary">→ {catLabel(key[it.id])}</span> : null}</Chip>;
  return (
    <QuestionFrame {...props}>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <Bucket id="pool" label={t(runtime.locale, 'Chưa phân loại', 'Unsorted')}>{q.items.filter((it) => !placed[it.id]).map(chip)}</Bucket>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{q.categories.map((c) => <Bucket key={c.id} id={c.id} label={c.label}>{q.items.filter((it) => placed[it.id] === c.id).map(chip)}</Bucket>)}</div>
      </DndContext>
      <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">{t(runtime.locale, 'Chọn bằng danh sách', 'Assign with dropdowns')}</summary>
        <ul className="mt-2 space-y-1">{q.items.map((it) => <li key={it.id} className="flex items-center gap-2"><span className="flex-1">{plainText(it.content)}</span><select aria-label={plainText(it.content)} value={placed[it.id] ?? ''} disabled={disabled} onChange={(e) => assign(it.id, e.target.value)} className={`p-1 ${fieldClass()}`}><option value="">—</option>{q.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></li>)}</ul>
      </details>
    </QuestionFrame>
  );
}
