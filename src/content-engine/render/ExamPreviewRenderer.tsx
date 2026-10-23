'use client';
import { useState } from 'react';
import type { LearnerItem } from '../compile';
import type { LessonRuntime, QuizSubmitResult } from './runtime';
import type { LearnerQuestion } from './registry';
import { QuestionRenderer } from './QuestionRenderer';
import { RichContentView } from './RichContentView';
import { asRich, asText } from './text';
import { t } from './questions/types';
import { blockFrame, buttonClass, stateTagClass } from './tone';

type PoolPlaceholder = { $pool: { id: string; count: number; pointsEach?: number } };
type Section = { id: string; title: string; instructions?: unknown; timeLimitMinutes?: number; questions: (LearnerQuestion | PoolPlaceholder)[] };
/** Learner payloads keep pool draws as `{ $pool }` placeholders; `LearnerQuestion`'s index signature means `in` cannot discriminate. */
const isPool = (q: LearnerQuestion | PoolPlaceholder): q is PoolPlaceholder => typeof (q as PoolPlaceholder).$pool === 'object' && (q as PoolPlaceholder).$pool !== null;
export function ExamPreviewRenderer({ item, runtime }: { item: LearnerItem; runtime: LessonRuntime }) {
  const settings = item.settings as { timeLimitMinutes?: number; attemptsAllowed: number; passPercent: number; scoringPolicy: string; layout: string } | undefined;
  const sections = item.sections as Section[];
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [results, setResults] = useState<Record<string, QuizSubmitResult>>({});
  const L = runtime.locale;
  return (
    <article className="mx-auto max-w-3xl">
      <header className="mb-4 rounded-lg border border-border bg-muted p-4"><h1 className="text-2xl font-bold">{asText(item.title)}</h1>{item.description ? <div className="mt-2"><RichContentView content={asRich(item.description as never)} runtime={runtime} /></div> : null}
        <p className="mt-2 text-sm text-muted-foreground">{settings?.timeLimitMinutes ? `${settings.timeLimitMinutes} ${t(L, 'phút', 'min')} · ` : ''}{settings?.attemptsAllowed} {t(L, 'lần làm', 'attempt(s)')} · {t(L, 'đạt', 'pass')} ≥ {settings?.passPercent}% · {settings?.scoringPolicy} · {settings?.layout}</p>
        <p className={`mt-2 uppercase ${stateTagClass('pending')}`}>{t(L, 'Bản xem trước — không tính giờ, không lưu', 'Preview — no timer, nothing is saved')}</p></header>
      {sections.map((s, si) => (
        <section key={s.id} className={`mb-6 ${blockFrame(0)}`} aria-label={asText(s.title)}>
          <h2 className="text-lg font-semibold">{t(L, 'Phần', 'Part')} {si + 1}: {asText(s.title)}{s.timeLimitMinutes ? <span className="ml-2 text-sm text-muted-foreground">{s.timeLimitMinutes} {t(L, 'phút', 'min')}</span> : null}</h2>
          {s.instructions ? <div className="my-2"><RichContentView content={asRich(s.instructions as never)} runtime={runtime} /></div> : null}
          <div className="mt-3 flex flex-col gap-4">{s.questions.map((q, i) => (isPool(q) ?<div key={q.$pool.id} className="rounded-md border border-dashed border-info-border bg-info p-3 text-sm text-info-foreground">{t(L, `${q.$pool.count} câu rút từ pool "${q.$pool.id}"`, `${q.$pool.count} questions drawn from pool "${q.$pool.id}"`)}{q.$pool.pointsEach !== undefined ? ` · ${q.$pool.pointsEach} ${t(L, 'điểm/câu', 'pts each')}` : ''}</div> : <QuestionRenderer key={q.id} question={q} index={i} value={answers[q.id]} onChange={(v) => setAnswers({ ...answers, [q.id]: v })} disabled={!!results[s.id]} result={results[s.id]?.results.find((r) => r.questionId === q.id)} revealed={results[s.id]?.revealed} runtime={runtime} depth={1} />))}</div>
          <footer className="mt-3 flex items-center gap-3">{results[s.id] ? <><span className="font-medium">{results[s.id].points}/{results[s.id].maxPoints} ({results[s.id].percent}%)</span><button type="button" onClick={() => { const r = { ...results }; delete r[s.id]; setResults(r); }} className={buttonClass.quiet}>{t(L, 'Đặt lại', 'Reset')}</button></> : <button type="button" onClick={async () => setResults({ ...results, [s.id]: await runtime.submitQuiz(s.id, answers) })} className={buttonClass.secondary}>{t(L, 'Chấm thử phần này', 'Grade section (preview)')}</button>}</footer>
        </section>
      ))}
    </article>
  );
}
