'use client';
import type { QuestionRendererProps } from '../registry';
import { QuestionFrame, plainText } from './QuestionFrame';
import { DraftInput } from './draft';
import type { ShortAnswerQuestion } from './types';
import { t } from './types';
import { fieldClass, partState } from '../tone';
export function ShortAnswer(props: QuestionRendererProps<ShortAnswerQuestion>) {
  const { question: q, value, onChange, disabled, result, revealed, runtime } = props;
  const key = revealed?.correctAnswers?.[q.id] as string[] | undefined;
  return (
    <QuestionFrame {...props}>
      <DraftInput type="text" aria-label={plainText(q.content)} value={(value as string) ?? ''} maxLength={q.maxLength ?? 200} disabled={disabled} onValueChange={onChange} autoComplete="off" className={`w-full max-w-md p-2 ${fieldClass(partState(result?.status))}`} />
      {key ? <p data-answer-key className="mt-2 text-sm text-primary">{t(runtime.locale, 'Đáp án chấp nhận', 'Accepted answers')}: {key.join(' · ')}</p> : null}
    </QuestionFrame>
  );
}
