'use client';
import type { QuestionRendererProps } from '../registry';
import { RichContentView } from '../RichContentView';
import { QuestionFrame, plainText } from './QuestionFrame';
import type { ChoiceQuestion } from './types';
import { t } from './types';
import { layoutClass, optionClass, optionMark, optionState, SelectedMark } from './SingleChoice';
import { questionTone } from '../tone';
import { CorrectMark, correctMarkId } from './marks';

export function MultipleChoice(props: QuestionRendererProps<ChoiceQuestion>) {
  const { question: q, value, onChange, disabled, revealed, runtime } = props;
  const mode = q.display?.interactionType ?? 'checkbox';
  const selected = Array.isArray(value) ? (value as string[]) : [];
  const key = revealed?.correctAnswers?.[q.id];
  const full = q.maxSelections !== undefined && selected.length >= q.maxSelections;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <QuestionFrame {...props}>
      <p className="mb-2 text-xs text-muted-foreground">{q.maxSelections ? t(runtime.locale, `Chọn tối đa ${q.maxSelections}`, `Select up to ${q.maxSelections}`) : t(runtime.locale, 'Chọn tất cả đáp án đúng', 'Select all that apply')}</p>
      <div role="group" className={layoutClass(q.display?.layout ?? (mode === 'image' ? 'grid_2' : undefined))}>
        {q.options.map((o) => {
          const m = optionMark(key, o.id, selected);
          const state = optionState(m);
          const isDisabled = disabled || (full && !selected.includes(o.id));
          return (
            <label key={o.id} data-state={state} className={`${optionClass} border ${questionTone(state)} ${mode === 'button' ? 'justify-center text-center' : ''} ${isDisabled ? 'opacity-70' : 'cursor-pointer hover:bg-muted'}`}>
              <input type="checkbox" value={o.id} checked={selected.includes(o.id)} disabled={isDisabled} onChange={() => toggle(o.id)} data-correct={m.correct === undefined ? undefined : String(m.correct)} aria-label={plainText(o.content)} aria-describedby={m.correct ? correctMarkId(q.id, o.id) : undefined} className={mode === 'checkbox' ? 'mt-1' : 'sr-only'} />
              <span className="flex-1"><RichContentView content={o.content} runtime={runtime} path={`/questions/${q.id}/options/${o.id}`} /></span>
              <SelectedMark show={m.chosen} />
              {m.correct ? <CorrectMark locale={runtime.locale} id={correctMarkId(q.id, o.id)} /> : null}
            </label>
          );
        })}
      </div>
    </QuestionFrame>
  );
}
