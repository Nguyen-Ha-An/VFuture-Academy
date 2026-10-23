import type { QuestionResult } from '../grading/types';

/*
 * Semantic class maps for every renderer. Blocks render inside four token scopes (the learner
 * bench, staff workspaces, the Studio preview island and public prose); each re-points the
 * shadcn variables, so these utilities follow the surrounding theme. Never add a Tailwind
 * palette colour here or in a renderer: `tests/content-engine/render-palette.test.ts` fails.
 */

/** Bench state tones (DESIGN.md): signal = in spec, pending = waiting, fault = out of spec. */
export type Tone = 'signal' | 'pending' | 'fault' | 'info' | 'neutral';
/** Answer and control states: graded correct/incorrect, chosen by the learner, or resting. */
export type QuestionState = 'correct' | 'incorrect' | 'selected' | 'idle';
export type CalloutVariant = 'info' | 'tip' | 'warning' | 'danger' | 'note';

const QUESTION_TONES: Record<QuestionState, string> = {
  correct: 'border-success-border bg-success text-success-foreground',
  incorrect: 'border-destructive bg-destructive/10',
  selected: 'border-primary',
  idle: 'border-border',
};
/** Border and fill of an answer option, drop target or ordered row. */
export const questionTone = (state: QuestionState): string => QUESTION_TONES[state];
/** Maps a graded part (`result.parts[id]`) or status onto a question state. */
export const partState = (part?: string, selected = false): QuestionState => (part === 'correct' ? 'correct' : part === 'incorrect' ? 'incorrect' : selected ? 'selected' : 'idle');

const CALLOUT_TONES: Record<CalloutVariant, string> = {
  info: 'border-info-border bg-info text-info-foreground',
  tip: 'border-success-border bg-success text-success-foreground',
  warning: 'border-warning-border bg-warning text-warning-foreground',
  danger: 'border-destructive bg-destructive/10',
  note: 'border-border bg-muted',
};
export const calloutTone = (variant: CalloutVariant): string => CALLOUT_TONES[variant];

const RESULT_TONES: Record<QuestionResult['status'], Tone> = {
  correct: 'signal',
  incorrect: 'fault',
  partial: 'pending',
  pending_manual: 'pending',
  incomplete: 'neutral',
  self_assessed: 'neutral',
};
export const resultTone = (status: QuestionResult['status']): Tone => RESULT_TONES[status];

const STATE_TAGS: Record<Tone, string> = {
  signal: 'bg-success text-success-foreground',
  pending: 'bg-warning text-warning-foreground',
  fault: 'bg-destructive/10 text-destructive',
  info: 'bg-info text-info-foreground',
  neutral: 'bg-muted text-muted-foreground',
};
/** A status pill; the label always carries the word, so colour is never the only signal. */
export const stateTagClass = (tone: Tone): string => `inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${STATE_TAGS[tone]}`;

export const buttonClass = {
  primary: 'inline-flex min-h-11 items-center justify-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50',
  secondary: 'inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-transparent px-4 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50',
  quiet: 'inline-flex min-h-11 items-center rounded-md px-2 text-sm text-foreground underline underline-offset-4 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50',
} as const;

const FIELD_TONES: Record<QuestionState, string> = {
  idle: 'rounded-md border border-input bg-background text-foreground',
  selected: 'rounded-md border border-primary bg-background text-foreground',
  correct: 'rounded-md border border-success-border bg-success text-success-foreground',
  incorrect: 'rounded-md border border-destructive bg-destructive/10 text-foreground',
};
/** Text inputs, selects and textareas; graded fields take the answer tone. */
export const fieldClass = (state: QuestionState = 'idle'): string => FIELD_TONES[state];

/**
 * Frame for a block that owns a surface. Top-level blocks (depth 0) are cards; anything nested
 * inside another block (or an owner card, via depth 1) is flat with a hairline, so cards never
 * nest inside cards (DESIGN.md).
 */
export const blockFrame = (depth = 0): string => (depth <= 0 ? 'rounded-lg border border-border bg-card p-4' : 'border-t border-border pt-4');

/** ARIA tabs (Radix): the list wraps instead of scrolling, and the active trigger carries a signal underline. */
export const tabListClass = 'flex flex-wrap gap-1 border-b border-border';
export const tabTriggerClass = '-mb-px inline-flex min-h-11 items-center border-b-2 border-transparent px-4 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-foreground';
