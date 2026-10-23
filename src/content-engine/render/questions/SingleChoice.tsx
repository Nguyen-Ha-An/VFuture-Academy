'use client';
import type { QuestionRendererProps } from '../registry';
import { RichContentView } from '../RichContentView';
import { QuestionFrame, plainText } from './QuestionFrame';
import type { ChoiceQuestion } from './types';
import { t } from './types';
import { fieldClass, questionTone, type QuestionState } from '../tone';
import { CorrectMark, correctMarkId } from './marks';

export function optionMark(revealedKey: unknown, id: string, value: unknown): { correct?: boolean; chosen: boolean } {
  const keySet = new Set(Array.isArray(revealedKey) ? (revealedKey as string[]) : revealedKey !== undefined ? [revealedKey as string] : []);
  const chosen = Array.isArray(value) ? (value as string[]).includes(id) : value === id;
  return { ...(revealedKey !== undefined ? { correct: keySet.has(id) } : {}), chosen };
}
/** Graded marks win over the learner's choice; a chosen option is signal-bordered. */
export const optionState = (m: { correct?: boolean; chosen: boolean }): QuestionState => (m.correct === true ? 'correct' : m.chosen && m.correct === false ? 'incorrect' : m.chosen ? 'selected' : 'idle');
/** Option labels wrap a (possibly visually hidden) input, so the label shows its keyboard focus. */
export const optionClass = 'flex items-start gap-3 rounded-md p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring';
/** Selection is never colour alone: a chosen option also carries a ● mark. */
export function SelectedMark({ show }: { show: boolean }) { return show ? <span aria-hidden="true" data-selected-mark className="shrink-0 text-primary">●</span> : null; }
export const layoutClass = (layout?: string) => (layout === 'grid_2' ? 'grid grid-cols-1 gap-2 sm:grid-cols-2' : layout === 'inline' ? 'flex flex-wrap gap-2' : 'flex flex-col gap-2');

export function SingleChoice(props: QuestionRendererProps<ChoiceQuestion>) {
  const { question: q, value, onChange, disabled, revealed, runtime } = props;
  const mode = q.display?.interactionType ?? 'radio';
  const key = revealed?.correctAnswers?.[q.id];
  const name = `q-${q.id}`;
  return (
    <QuestionFrame {...props}>
      {mode === 'dropdown' ? (
        <select aria-label={plainText(q.content)} value={(value as string) ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || undefined)} className={`p-2 ${fieldClass()}`}>
          <option value="">{t(runtime.locale, '— Chọn —', '— Select —')}</option>
          {q.options.map((o) => <option key={o.id} value={o.id}>{plainText(o.content)}</option>)}
        </select>
      ) : null}
      {mode === 'dropdown' && key !== undefined ? (
        <p data-answer-key className="mt-2 flex items-center gap-1 text-sm text-primary"><CorrectMark locale={runtime.locale} /> {q.options.filter((o) => optionMark(key, o.id, value).correct).map((o) => plainText(o.content)).join(', ')}</p>
      ) : null}
      {mode === 'dropdown' ? null : (
        <div role="radiogroup" className={layoutClass(q.display?.layout ?? (mode === 'image' ? 'grid_2' : undefined))}>
          {q.options.map((o) => {
            const m = optionMark(key, o.id, value);
            const state = optionState(m);
            return (
              <label key={o.id} data-state={state} className={`${optionClass} border ${questionTone(state)} ${mode === 'button' ? 'justify-center text-center' : ''} ${disabled ? 'cursor-default' : 'cursor-pointer hover:bg-muted'}`}>
                <input type="radio" name={name} value={o.id} checked={value === o.id} disabled={disabled} onChange={() => onChange(o.id)} data-correct={m.correct === undefined ? undefined : String(m.correct)} aria-label={plainText(o.content)} aria-describedby={m.correct ? correctMarkId(q.id, o.id) : undefined} className={mode === 'radio' ? 'mt-1' : 'sr-only'} />
                <span className="flex-1"><RichContentView content={o.content} runtime={runtime} path={`/questions/${q.id}/options/${o.id}`} /></span>
                <SelectedMark show={m.chosen} />
                {m.correct ? <CorrectMark locale={runtime.locale} id={correctMarkId(q.id, o.id)} /> : null}
                {revealed?.optionFeedback?.[q.id]?.[o.id] && m.chosen ? <span className="block text-xs text-muted-foreground"><RichContentView content={revealed.optionFeedback[q.id][o.id]} runtime={runtime} /></span> : null}
              </label>
            );
          })}
        </div>
      )}
    </QuestionFrame>
  );
}
