'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { QuestionRendererProps } from '../registry';
import { RichContentView } from '../RichContentView';
import { QuestionFrame, plainText } from './QuestionFrame';
import type { MatchingQuestion } from './types';
import { t } from './types';
import { fieldClass, partState, questionTone } from '../tone';
import { CorrectMark } from './marks';

type Edge = { left: string; right: string };
export function Matching(props: QuestionRendererProps<MatchingQuestion>) {
  const { question: q, value, onChange, disabled, result, revealed, runtime } = props;
  const edges = useMemo(() => (Array.isArray(value) ? value : []) as Edge[], [value]);
  const lines = q.display?.interactionType === 'lines';
  const key = revealed?.correctAnswers?.[q.id] as Edge[] | undefined;
  const rightText = (id: string) => plainText(q.right.find((r) => r.id === id)?.content);
  const setEdge = (left: string, right: string) => { const rest = edges.filter((e) => e.left !== left); onChange(right ? [...rest, { left, right }] : rest); };
  const taken = new Set(edges.map((e) => e.right));
  const wrap = useRef<HTMLDivElement>(null);
  const [segments, setSegments] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);
  useEffect(() => {
    if (!lines || !wrap.current) return;
    const box = wrap.current.getBoundingClientRect();
    const pos = (sel: string) => { const el = wrap.current!.querySelector<HTMLElement>(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left - box.left, y: r.top - box.top + r.height / 2, w: r.width }; };
    setSegments(edges.flatMap((e) => { const a = pos(`[data-left="${e.left}"]`), b = pos(`[data-right="${e.right}"]`); return a && b ? [{ x1: a.x + a.w, y1: a.y, x2: b.x, y2: b.y }] : []; }));
  }, [edges, lines]);
  return (
    <QuestionFrame {...props}>
      <div ref={wrap} className="relative grid grid-cols-[1fr_auto_1fr] gap-x-6 gap-y-2">
        {lines ? <svg data-connectors aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">{segments.map((s, i) => <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="currentColor" strokeWidth={2} />)}</svg> : null}
        <div className="flex flex-col gap-2">{q.left.map((l) => { const part = result?.parts?.[l.id]; const current = edges.find((e) => e.left === l.id)?.right ?? ''; return (
          <div key={l.id} data-left={l.id} className={`rounded-md border p-2 ${questionTone(partState(part))}`}>
            <div className="mb-1 flex items-start gap-2 text-sm"><div className="min-w-0 flex-1"><RichContentView content={l.content} runtime={runtime} /></div>{part === 'correct' ? <CorrectMark locale={runtime.locale} /> : null}</div>
            <select aria-label={`${plainText(l.content)} → ${t(runtime.locale, 'nối với', 'matches')}`} value={current} disabled={disabled} onChange={(e) => setEdge(l.id, e.target.value)} className={`w-full p-1 text-sm ${fieldClass()}`}>
              <option value="">—</option>
              {q.right.map((r) => <option key={r.id} value={r.id} disabled={!q.allowManyToOne && taken.has(r.id) && current !== r.id}>{rightText(r.id)}</option>)}
            </select>
            {key ? <p data-answer-key className="mt-1 flex items-center gap-1 text-xs text-primary"><CorrectMark locale={runtime.locale} /> {key.filter((e) => e.left === l.id).map((e) => rightText(e.right)).join(', ')}</p> : null}
          </div>); })}</div>
        <div aria-hidden="true" className="self-center text-muted-foreground">⇄</div>
        <div className="flex flex-col gap-2">{q.right.map((r) => <div key={r.id} data-right={r.id} className={`rounded-md border p-2 text-sm ${taken.has(r.id) ? 'border-primary' : 'border-border'}`}><RichContentView content={r.content} runtime={runtime} /></div>)}</div>
      </div>
    </QuestionFrame>
  );
}
