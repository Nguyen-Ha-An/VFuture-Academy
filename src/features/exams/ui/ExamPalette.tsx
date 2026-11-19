'use client';

import type { LearnerQuestion } from '@/content-engine/render/registry';
import { cn } from '@/lib/utils';
import type { LearnerExam } from './types';
import { hasExamAnswer, type SequentialExamProgress } from '../navigation';

interface PaletteEntry {
  question: LearnerQuestion;
  sectionIndex: number;
}

interface ExamPaletteLabels {
  navigation: string;
  answered: string;
  unanswered: string;
  flagged: string;
  notFlagged: string;
  question: (number: number, answerState: string, flagState: string) => string;
}

interface ExamPaletteProps {
  answers: Record<string, unknown>;
  currentIndex: number;
  currentSectionIndex: number;
  entries: readonly PaletteEntry[];
  flagged: ReadonlySet<number>;
  page?: SequentialExamProgress;
  labels: ExamPaletteLabels;
  layout: LearnerExam['settings']['layout'];
  navigation: LearnerExam['settings']['navigation'];
  onNavigate: (index: number) => void;
  submitting: boolean;
}

export const hasAnswer = hasExamAnswer;

export function ExamPalette({
  answers,
  currentIndex,
  currentSectionIndex,
  entries,
  flagged,
  page,
  labels,
  layout,
  navigation,
  onNavigate,
  submitting,
}: ExamPaletteProps) {
  const offset = page?.questionOffset ?? 0;
  const priorAnswers = new Set(page?.answeredBefore);
  return (
    <nav aria-label={labels.navigation} className="min-w-0">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(44px,1fr))] gap-2">
        {Array.from({ length: page?.questionCount ?? entries.length }, (_, index) => {
          const localIndex = index - offset;
          const entry = entries[localIndex];
          const answered = entry ? hasAnswer(answers[entry.question.id]) : priorAnswers.has(index);
          const isFlagged = flagged.has(index);
          const isCurrent = localIndex === currentIndex;
          const sequentiallyLocked = !entry || (navigation === 'sequential'
            && (layout === 'one_per_page'
              ? !isCurrent
              : layout === 'section_per_page'
                ? entry.sectionIndex !== currentSectionIndex
                : false));
          return (
            <button
              key={index}
              type="button"
              data-answered={answered}
              data-flagged={isFlagged}
              aria-current={isCurrent ? 'page' : undefined}
              aria-disabled={sequentiallyLocked ? 'true' : undefined}
              disabled={submitting}
              aria-label={labels.question(
                index + 1,
                answered ? labels.answered : labels.unanswered,
                isFlagged ? labels.flagged : labels.notFlagged,
              )}
              className={cn(
                'relative min-h-11 min-w-0 rounded-md border border-border px-1 text-sm font-medium tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                answered && 'border-primary/50 bg-primary/10 text-foreground',
                isFlagged && 'ring-2 ring-warning-foreground ring-offset-1',
                isCurrent && 'bg-primary text-primary-foreground',
              )}
              onClick={() => {
                if (!sequentiallyLocked) onNavigate(localIndex);
              }}
            >
              {index + 1}
              <span className="sr-only">{answered ? labels.answered : labels.unanswered}</span>
              {answered ? <span className="absolute -bottom-1 -left-1 text-xs" aria-hidden="true">✓</span> : null}
              {isFlagged ? <span className="absolute -right-1 -top-2" aria-hidden="true">⚑</span> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
