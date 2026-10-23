'use client';
import { useState } from 'react';
import type { QuestionRendererProps } from '../registry';
import { RichContentView } from '../RichContentView';
import { BlankRenderContext } from '../RichText';
import { QuestionFrame } from './QuestionFrame';
import { DraftInput } from './draft';
import type { FillBlankQuestion } from './types';
import { t } from './types';
import { fieldClass, partState, questionTone } from '../tone';
import { CorrectMark } from './marks';

const widthClass = { sm: 'w-20', md: 'w-36', lg: 'w-56' } as const;

export function FillBlank(props: QuestionRendererProps<FillBlankQuestion>) {
  const { question: q, value, onChange, disabled, result, revealed, runtime } = props;
  const mode = q.display?.interactionType ?? 'text';
  const answers = (value && typeof value === 'object' ? value : {}) as Record<string, string>;
  const key = revealed?.correctAnswers?.[q.id] as Record<string, string | string[]> | undefined;
  const [picked, setPicked] = useState<string | null>(null);
  const blankIndex = Object.fromEntries(q.blanks.map((b, i) => [b.id, i + 1]));
  const wordText = (id: string) => q.wordBank?.find((w) => w.id === id)?.text ?? id;
  const set = (id: string, v: string | undefined) => { const next = { ...answers }; if (v === undefined || v === '') delete next[id]; else next[id] = v; onChange(next); };
  const part = (id: string) => result?.parts?.[id];
  const label = (id: string) => `${t(runtime.locale, 'Chỗ trống', 'Blank')} ${blankIndex[id]}`;
  const correctText = (id: string) => {
    if (!key) return part(id) === 'correct' ? <CorrectMark locale={runtime.locale} className="ml-1 text-xs" /> : null;
    const k = ([] as string[]).concat(key[id] ?? []);
    return <span data-answer-key className="ml-1 inline-flex items-center gap-1 text-xs text-primary"><CorrectMark locale={runtime.locale} /> {k.map((v) => (mode === 'word_bank' ? wordText(v) : v)).join(' / ')}</span>;
  };

  const renderBlank = (id: string, size?: 'sm' | 'md' | 'lg') => {
    const blank = q.blanks.find((b) => b.id === id);
    const w = widthClass[blank?.width ?? size ?? 'md'];
    if (mode === 'dropdown') return <span className="inline-flex items-center"><select aria-label={label(id)} value={answers[id] ?? ''} disabled={disabled} onChange={(e) => set(id, e.target.value)} className={`mx-1 p-1 ${fieldClass(partState(part(id)))}`}><option value="">—</option>{(blank?.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>{correctText(id)}</span>;
    if (mode === 'word_bank') return <span className="inline-flex items-center"><button type="button" aria-label={`${label(id)}${answers[id] ? `: ${wordText(answers[id])}` : ''}`} disabled={disabled} onClick={() => { if (picked) { set(id, picked); setPicked(null); } else if (answers[id]) set(id, undefined); }} className={`mx-1 inline-block min-w-24 rounded-md border-2 border-dashed px-2 py-0.5 text-center ${part(id) ? questionTone(partState(part(id))) : picked ? 'border-primary bg-accent' : 'border-input'}`}>{answers[id] ? wordText(answers[id]) : ' '}</button>{correctText(id)}</span>;
    return <span className="inline-flex items-center"><DraftInput type="text" aria-label={label(id)} value={answers[id] ?? ''} disabled={disabled} onValueChange={(v) => set(id, v)} autoComplete="off" className={`mx-1 rounded-sm border-b-2 px-1 outline-none focus:border-primary ${w} ${part(id) ? questionTone(partState(part(id))) : 'border-input'}`} />{correctText(id)}</span>;
  };

  const used = new Set(Object.values(answers));
  return (
    <QuestionFrame {...props} hideStem>
      {mode === 'word_bank' && q.wordBank ? <div role="group" aria-label={t(runtime.locale, 'Ngân hàng từ', 'Word bank')} className="mb-3 flex flex-wrap gap-2 rounded-md bg-muted p-2">{q.wordBank.filter((w) => !used.has(w.id)).map((w) => <button key={w.id} type="button" aria-pressed={picked === w.id} disabled={disabled} onClick={() => setPicked(picked === w.id ? null : w.id)} className={`rounded-md border px-2 py-1 text-sm ${picked === w.id ? 'border-primary bg-accent' : 'border-border bg-background'}`}>{w.text}</button>)}{picked ? <span className="self-center text-xs text-muted-foreground">{t(runtime.locale, 'Chọn một chỗ trống', 'Now click a blank')}</span> : null}</div> : null}
      <BlankRenderContext.Provider value={renderBlank}><div className="leading-9"><RichContentView content={q.content} runtime={runtime} path={`/questions/${q.id}/content`} /></div></BlankRenderContext.Provider>
    </QuestionFrame>
  );
}
