import type { ComponentType } from 'react';
import type { LessonBlock, RichContent } from '../schema/types';
import type { QuestionResult } from '../grading/types';
import type { LessonRuntime, RevealedInfo } from './runtime';
import { engineStrings, tr } from './strings';

export interface BlockRendererProps<B extends LessonBlock = LessonBlock> { block: B; runtime: LessonRuntime; path: string; depth: number }
export type LearnerQuestion = Record<string, unknown> & { id: string; type: string; content?: RichContent; display?: { interactionType?: string; layout?: string }; points?: number; hint?: RichContent };
export interface QuestionRendererProps<Q extends LearnerQuestion = LearnerQuestion> {
  question: Q; value: unknown; onChange: (value: unknown) => void; disabled?: boolean;
  result?: QuestionResult; revealed?: RevealedInfo; runtime: LessonRuntime; index?: number;
  /** Nesting depth for the question frame: 0 is a standalone card, ≥1 sits flat inside a quiz, group or section. */
  depth?: number;
}

export const blockRegistry: Record<string, ComponentType<BlockRendererProps<never>>> = {};
export const questionRegistry: Record<string, ComponentType<QuestionRendererProps<never>>> = {};
export function registerBlock<B extends LessonBlock>(type: B['type'], component: ComponentType<BlockRendererProps<B>>) { blockRegistry[type] = component as ComponentType<BlockRendererProps<never>>; }
export function registerQuestion<Q extends LearnerQuestion>(key: string, component: ComponentType<QuestionRendererProps<Q>>) { questionRegistry[key] = component as ComponentType<QuestionRendererProps<never>>; }

/** Learner-facing notice for content this build cannot render; the schema type stays in a data attribute only. */
export function UnavailableBlock({ type, locale }: { type: string; locale: 'vi' | 'en' }) {
  return (
    <div role="note" data-unavailable={type} lang={locale} className="rounded-md border border-dashed border-warning-border bg-warning p-3 text-sm text-warning-foreground">
      {tr(locale, engineStrings.block.unavailable)}
    </div>
  );
}
