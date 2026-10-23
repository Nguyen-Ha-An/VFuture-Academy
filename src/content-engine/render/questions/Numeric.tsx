'use client';
import type { QuestionRendererProps } from '../registry';
import { QuestionFrame, plainText } from './QuestionFrame';
import { DraftInput } from './draft';
import type { NumericQuestion } from './types';
import { t } from './types';
import { fieldClass, partState } from '../tone';
export function Numeric(props: QuestionRendererProps<NumericQuestion>) {
  const { question: q, value, onChange, disabled, result, revealed, runtime } = props;
  const key = revealed?.correctAnswers?.[q.id] as number | undefined;
  return (
    <QuestionFrame {...props}>
      <div className="flex items-center gap-2"><DraftInput type="text" inputMode="decimal" aria-label={plainText(q.content)} value={(value as string) ?? ''} disabled={disabled} onValueChange={onChange} autoComplete="off" className={`w-40 p-2 ${fieldClass(partState(result?.status))}`} />{q.unit ? <span className="text-muted-foreground">{q.unit}</span> : null}</div>
      {key !== undefined ? <p data-answer-key className="mt-2 text-sm text-primary">{t(runtime.locale, 'Đáp án', 'Answer')}: {key}{q.unit ? ` ${q.unit}` : ''}</p> : null}
    </QuestionFrame>
  );
}
