'use client';
import type { QuestionRendererProps } from '../registry';
import { QuestionFrame } from './QuestionFrame';
import type { TrueFalseQuestion } from './types';
import { t } from './types';
import { optionState, SelectedMark } from './SingleChoice';
import { questionTone } from '../tone';
import { CorrectMark, correctMarkId } from './marks';

export function TrueFalse(props: QuestionRendererProps<TrueFalseQuestion>) {
  const { question: q, value, onChange, disabled, revealed, runtime } = props;
  const yesNo = q.display?.interactionType === 'yes_no';
  const labels = { true: q.labels?.true ?? (yesNo ? t(runtime.locale, 'Có', 'Yes') : t(runtime.locale, 'Đúng', 'True')), false: q.labels?.false ?? (yesNo ? t(runtime.locale, 'Không', 'No') : t(runtime.locale, 'Sai', 'False')) };
  const key = revealed?.correctAnswers?.[q.id];
  return (
    <QuestionFrame {...props}>
      <div role="radiogroup" className="flex gap-2">
        {([true, false] as const).map((v) => {
          const correct = key === undefined ? undefined : key === v;
          const state = optionState({ correct, chosen: value === v });
          return <label key={String(v)} data-state={state} className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border p-3 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring ${questionTone(state)}`}><input type="radio" name={`q-${q.id}`} className="sr-only" checked={value === v} disabled={disabled} onChange={() => onChange(v)} aria-label={labels[String(v) as 'true' | 'false']} data-correct={correct === undefined ? undefined : String(correct)} aria-describedby={correct ? correctMarkId(q.id, v) : undefined} /><span>{labels[String(v) as 'true' | 'false']}</span><SelectedMark show={value === v} />{correct ? <CorrectMark locale={runtime.locale} id={correctMarkId(q.id, v)} /> : null}</label>;
        })}
      </div>
    </QuestionFrame>
  );
}
