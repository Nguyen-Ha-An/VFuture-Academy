'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { ReadoutCell } from '@/features/workspace-ui/ui/primitives';
import { RenderScope, RichContentView } from '@/content-engine/render';
import type { LessonRuntime } from '@/content-engine/render/runtime';
import type { LearnerExam } from './types';

export interface ExamIntroProps {
  exam: LearnerExam;
  attemptsUsed: number;
  onStart: () => void | Promise<void>;
  runtime?: LessonRuntime;
  starting?: boolean;
  error?: string | null;
  now?: Date | null;
  headingLevel?: 1 | 2;
  hideTitle?: boolean;
}

export type ExamAvailability = 'checking' | 'upcoming' | 'open' | 'closed';

export function examAvailability(exam: LearnerExam, now?: Date | null): ExamAvailability {
  const { openAt, closeAt } = exam.settings;
  if (!openAt && !closeAt) return 'open';
  if (!now) return 'checking';
  if (openAt && now.getTime() < Date.parse(openAt)) return 'upcoming';
  if (closeAt && now.getTime() >= Date.parse(closeAt)) return 'closed';
  return 'open';
}

export function ExamIntro({
  exam,
  attemptsUsed,
  onStart,
  runtime,
  starting = false,
  error,
  now,
  headingLevel = 1,
  hideTitle = false,
}: ExamIntroProps) {
  const t = useTranslations('exam');
  const format = useFormatter();
  const { settings } = exam;
  const remaining = Math.max(0, settings.attemptsAllowed - attemptsUsed);
  const availabilityState = examAvailability(exam, now);
  const Title = headingLevel === 1 ? 'h1' : 'h2';
  const availability = settings.openAt && settings.closeAt
    ? t('intro.availabilityRange', {
      open: format.dateTime(new Date(settings.openAt), { dateStyle: 'medium', timeStyle: 'short' }),
      close: format.dateTime(new Date(settings.closeAt), { dateStyle: 'medium', timeStyle: 'short' }),
    })
    : settings.openAt
      ? t('intro.opensAt', {
        date: format.dateTime(new Date(settings.openAt), { dateStyle: 'medium', timeStyle: 'short' }),
      })
      : settings.closeAt
        ? t('intro.closesAt', {
          date: format.dateTime(new Date(settings.closeAt), { dateStyle: 'medium', timeStyle: 'short' }),
        })
        : t('intro.availableAnytime');

  const rules: Array<[string, string]> = [
    [t('intro.availability'), availability],
    [t('intro.navigationLabel'), t(`navigation.${settings.navigation}`)],
    [t('intro.layoutLabel'), t(`layout.${settings.layout}`)],
    [t('intro.scoringLabel'), t(`scoring.${settings.scoringPolicy}`)],
    [t('intro.integrityLabel'), settings.integrity.requireFullscreen ? t('intro.fullscreenRequired') : t('intro.fullscreenNotRequired')],
  ];

  return (
    <section className="grid min-w-0 gap-6" aria-label={hideTitle ? exam.title : undefined}>
      {!hideTitle || (runtime && exam.description) ? (
        <header className="grid gap-3">
          {!hideTitle ? <Title className="text-2xl font-medium leading-snug tracking-[-0.01em]">{exam.title}</Title> : null}
          {runtime && exam.description ? (
            // Authored headings sit below the exam title (the page h1 when the title is hidden).
            <RenderScope ownerLevel={hideTitle ? 1 : headingLevel} blocks={exam.description.blocks}>
              <RichContentView content={exam.description} runtime={runtime} path="/exam/description" />
            </RenderScope>
          ) : null}
        </header>
      ) : null}

      <div className="vf-readout-strip vf-exam-readout">
        <ReadoutCell label={t('intro.readout.time')}>
          <span className="vf-readout-big" aria-hidden="true">{settings.timeLimitMinutes === undefined ? '—' : format.number(settings.timeLimitMinutes, { maximumFractionDigits: 1 })}{settings.timeLimitMinutes === undefined ? null : <small> {t('intro.readout.minutes')}</small>}</span>
          <span className="sr-only">{settings.timeLimitMinutes === undefined
            ? t('intro.noTimeLimit')
            : t('intro.minutes', { count: settings.timeLimitMinutes })}</span>
        </ReadoutCell>
        <ReadoutCell label={t('intro.readout.pass')}>
          <span className="vf-readout-big">{t('intro.percent', { percent: settings.passPercent })}</span>
        </ReadoutCell>
        <ReadoutCell label={t('intro.readout.attempts')} detail={t('intro.attemptsUsed', { used: attemptsUsed, total: settings.attemptsAllowed })}>
          <span className="vf-readout-big" data-tone={remaining === 0 ? 'pending' : undefined} aria-hidden="true">{remaining}</span>
          <span className="sr-only">{t('intro.attemptsRemaining', { count: remaining })}</span>
        </ReadoutCell>
      </div>

      <details className="vf-l-disclosure">
        <summary>{t('intro.rules')}</summary>
        <dl className="m-0 grid gap-x-8 pb-4 min-[760px]:grid-cols-2">
          {rules.map(([label, value]) => (
            <div key={label} className="grid gap-1 border-b border-border py-3">
              <dt className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{label}</dt>
              <dd className="m-0 text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      </details>

      <div className="vf-exam-start flex flex-col gap-3 min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between">
        <div className="min-w-0">
          <p className="m-0 text-sm text-muted-foreground" role="status">
            {t(`intro.${availabilityState === 'checking'
              ? 'availabilityChecking'
              : availabilityState === 'upcoming'
                ? 'availabilityUpcoming'
                : availabilityState === 'closed' ? 'availabilityClosed' : 'availabilityOpen'}`)}
          </p>
          {error ? <p className="mt-2 text-sm text-destructive" role="alert">{error}</p> : null}
        </div>
        <button
          type="button"
          className="vf-btn vf-btn-primary vf-btn-lg shrink-0"
          disabled={starting || remaining === 0 || availabilityState !== 'open'}
          onClick={() => void onStart()}
        >
          {starting ? t('intro.starting') : t('intro.start')}
        </button>
      </div>
    </section>
  );
}
