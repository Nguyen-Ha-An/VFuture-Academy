import type { Locale } from '../../schema/common';
import { engineStrings, tr } from '../strings';

/**
 * A revealed correct answer is never colour alone (WCAG 1.4.1): a visible ✓ plus a screen-reader
 * label. Pass `id` and point the control's `aria-describedby` at it when the control carries its
 * own `aria-label`, which would otherwise hide the text inside its label.
 */
export function CorrectMark({ locale, id, className }: { locale: Locale; id?: string; className?: string }) {
  return <span data-correct-mark className={`inline-flex shrink-0 items-center font-medium ${className ?? ''}`}>
    <span aria-hidden="true">✓</span>
    <span id={id} className="sr-only">{tr(locale, engineStrings.answer.correct)}</span>
  </span>;
}

/** Stable id for a revealed-correct mark, scoped by question and option. */
export const correctMarkId = (questionId: string, optionId: string | number | boolean) => `vf-correct-${questionId}-${String(optionId)}`;
