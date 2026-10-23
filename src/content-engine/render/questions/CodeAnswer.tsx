'use client';
import type { QuestionRendererProps } from '../registry';
import { CodeEditor } from '../CodeEditor';
import { QuestionFrame } from './QuestionFrame';
import type { CodeAnswerQuestion } from './types';
import { t } from './types';
import { RubricTable } from './Essay';
export function CodeAnswer(props: QuestionRendererProps<CodeAnswerQuestion>) {
  const { question: q, value, onChange, disabled, runtime } = props;
  const current = (value as { code?: string } | undefined)?.code ?? q.starterCode ?? '';
  const lines = current.split('\n').length;
  return (
    <QuestionFrame {...props}>
      <p className="mb-1 font-mono text-xs uppercase text-muted-foreground">{q.language}</p>
      <CodeEditor ariaLabel={t(runtime.locale, 'Trình soạn mã', 'code editor')} value={current} language={q.language} disabled={disabled} onChange={(code) => onChange({ code, language: q.language })} minHeight="220px" />
      {q.minLines ? <p className="mt-1 text-sm text-muted-foreground">{lines} / {q.minLines} {t(runtime.locale, 'dòng tối thiểu', 'lines minimum')}</p> : null}
      {q.rubric ? <RubricTable rubric={q.rubric} locale={runtime.locale} /> : null}
    </QuestionFrame>
  );
}
