'use client';
import { useId, useState, type ReactNode } from 'react';
import type { QuestionResult } from '../../grading/types';
import type { LessonRuntime, RevealedInfo } from '../runtime';
import type { LearnerQuestion } from '../registry';
import { RichContentView } from '../RichContentView';
import { t } from './types';
import { blockFrame, buttonClass, calloutTone, resultTone, stateTagClass } from '../tone';

const statusLabel = { correct: { vi: 'Đúng', en: 'Correct' }, incorrect: { vi: 'Sai', en: 'Incorrect' }, partial: { vi: 'Đúng một phần', en: 'Partially correct' }, incomplete: { vi: 'Chưa trả lời', en: 'Not answered' }, pending_manual: { vi: 'Chờ chấm', en: 'Awaiting grading' }, self_assessed: { vi: 'Đã ghi nhận', en: 'Recorded' } } as const;

export function QuestionFrame({ question, index, result, revealed, runtime, children, hideStem, depth = 0 }: { question: LearnerQuestion; index?: number; result?: QuestionResult; revealed?: RevealedInfo; runtime: LessonRuntime; children: ReactNode; hideStem?: boolean; depth?: number }) {
  const legendId = useId();
  const [showHint, setShowHint] = useState(false);
  const explanation = revealed?.explanations?.[question.id];
  return (
    <fieldset aria-labelledby={legendId} className={`min-w-0 ${blockFrame(depth)}`} data-question-id={question.id}>
      <legend id={legendId} className="sr-only">{index !== undefined ? `${t(runtime.locale, 'Câu', 'Question')} ${index + 1}. ` : ''}{plainText(question.content)}</legend>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex-1">{index !== undefined ? <span className="mr-2 text-sm font-semibold text-muted-foreground">{index + 1}.</span> : null}{hideStem ? null : <div className="inline-block align-top [&>div]:inline"><RichContentView content={question.content} runtime={runtime} path={`/questions/${question.id}/content`} /></div>}</div>
        <div className="flex shrink-0 items-center gap-2 text-xs">{question.points !== undefined ? <span className="text-muted-foreground">{question.points} {t(runtime.locale, 'điểm', 'pts')}</span> : null}{result ? <span data-tone={resultTone(result.status)} className={stateTagClass(resultTone(result.status))}>{statusLabel[result.status][runtime.locale]}{result.status !== 'pending_manual' && result.maxPoints ? ` · ${result.points}/${result.maxPoints}` : ''}</span> : null}</div>
      </div>
      {children}
      {question.hint ? <div className="mt-3 text-sm"><button type="button" onClick={() => setShowHint((s) => !s)} className={buttonClass.quiet}>{showHint ? t(runtime.locale, 'Ẩn gợi ý', 'Hide hint') : t(runtime.locale, 'Xem gợi ý', 'Show hint')}</button>{showHint ? <div className="mt-1 rounded-md bg-muted p-2"><RichContentView content={question.hint} runtime={runtime} /></div> : null}</div> : null}
      {explanation ? <div className={`mt-3 rounded-md border-l-4 p-3 text-sm ${calloutTone('info')}`}><p className="mb-1 font-semibold">{t(runtime.locale, 'Giải thích', 'Explanation')}</p><RichContentView content={explanation} runtime={runtime} /></div> : null}
    </fieldset>
  );
}

export function plainText(rc: LearnerQuestion['content']): string {
  return (rc?.blocks ?? []).map((b) => ('content' in b && Array.isArray(b.content) ? (b.content as { text?: string; blank?: string }[]).map((r) => r.text ?? '____').join('') : '')).join(' ').trim();
}
