'use client';

import type { LearnerQuestion } from '@/content-engine/render/registry';
import { cn } from '@/lib/utils';
import type { LearnerExam } from './types';

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
  flagged: ReadonlySet<string>;
  labels: ExamPaletteLabels;
  layout: LearnerExam['settings']['layout'];
  navigation: LearnerExam['settings']['navigation'];
  onNavigate: (index: number) => void;
  submitting: boolean;
}

export function hasAnswer(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).some(hasAnswer);
  return true;
}

export function ExamPalette({
  answers,
  currentIndex,
  currentSectionIndex,
  entries,
  flagged,
  labels,
  layout,
  navigation,
  onNavigate,
  submitting,
}: ExamPaletteProps) {
  return (
    <nav aria-label={labels.navigation} className="min-w-0">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(44px,1fr))] gap-2">
        {entries.map(({ question, sectionIndex }, index) => {
          const answered = hasAnswer(answers[question.id]);
          const isFlagged = flagged.has(question.id);
          const sequentiallyLocked = navigation === 'sequential'
            && (layout === 'one_per_page'
              ? index !== currentIndex
              : layout === 'section_per_page'
                ? sectionIndex !== currentSectionIndex
                : false);
          return (
            <button
              key={question.id}
              type="button"
              data-answered={answered}
              data-flagged={isFlagged}
              aria-current={index === currentIndex ? 'page' : undefined}
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
                index === currentIndex && 'bg-primary text-primary-foreground',
              )}
              onClick={() => {
                if (!sequentiallyLocked) onNavigate(index);
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
