'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { QuizBlock } from '../schema/types';
import type { QuestionResult } from '../grading/types';
import type { LessonRuntime, QuizSubmitResult, RevealedInfo } from './runtime';
import type { LearnerQuestion, BlockRendererProps } from './registry';
import { QuestionRenderer } from './QuestionRenderer';
import { RichContentView } from './RichContentView';
import { asRich, asText } from './text';
import { seededShuffle } from './shuffle';
import { t } from './questions/types';
import { blockFrame, buttonClass } from './tone';
import { useSectionTag } from './render-context';
import { engineStrings, plural, tr } from './strings';

type Check = QuestionResult & { revealed: RevealedInfo };
export interface QuizState { answers: Record<string, unknown>; submissions: number; last?: QuizSubmitResult; checks: Record<string, Check>; completed?: boolean }

export function QuizRenderer({ block, runtime, depth = 0 }: { block: QuizBlock; runtime: LessonRuntime; depth?: number }) {
  const settings = { mode: 'practice', attemptsAllowed: 0, feedback: 'per_question', showExplanations: true, shuffleQuestions: false, ...(block.settings ?? {}) } as Required<Omit<NonNullable<QuizBlock['settings']>, 'passPercent' | 'required'>> & { passPercent?: number };
  if (block.settings?.mode === 'graded') { settings.attemptsAllowed = block.settings.attemptsAllowed ?? 3; settings.feedback = block.settings.feedback ?? 'after_submit'; }
  const [state, setState] = useState<QuizState>(() => runtime.getBlockState<QuizState>(block.id) ?? { answers: {}, submissions: 0, checks: {} });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [error, setError] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const L = runtime.locale;
  const Title = useSectionTag();
  const questions = useMemo(() => { const qs = block.questions as unknown as LearnerQuestion[]; return settings.shuffleQuestions ? seededShuffle(qs, `${block.id}:${state.submissions}`) : qs; }, [block.questions, block.id, settings.shuffleQuestions, state.submissions]);
  const persist = (next: QuizState) => { setState(next); runtime.setBlockState(block.id, next); };
  const setAnswer = (id: string, v: unknown) => { if (busyRef.current) return; setCheckError((current) => current === id ? null : current); persist({ ...state, answers: { ...state.answers, [id]: v }, checks: { ...state.checks, [id]: undefined as never } }); };
  const submitted = !!state.last;
  const attemptsLeft = settings.attemptsAllowed === 0 ? null : Math.max(0, settings.attemptsAllowed - state.submissions);
  const submit = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(null);
    try { const last = await runtime.submitQuiz(block.id, state.answers); if (!mounted.current) return; persist({ ...state, last, submissions: state.submissions + 1, completed: true }); runtime.onActivityComplete(block.id); }
    catch { if (mounted.current) setError(t(L, 'Chưa thể nộp bài. Đáp án của bạn vẫn được giữ lại. Hãy thử lại.', 'We could not submit your quiz. Your answers are still here. Try again.')); } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const check = async (id: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setCheckError(null);
    try {
      const c = await runtime.checkQuestion(block.id, id, state.answers[id]);
      if (mounted.current) persist({ ...state, checks: { ...state.checks, [id]: c } });
    } catch {
      if (mounted.current) setCheckError(id);
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const retry = () => { if (!busyRef.current) { setError(null); setCheckError(null); persist({ answers: {}, submissions: state.submissions, checks: {}, completed: state.completed }); } };
  const resultFor = (id: string) => state.last?.results.find((r) => r.questionId === id) ?? state.checks[id];
  const revealedFor = (id: string) => (settings.feedback === 'none' ? undefined : state.last?.revealed ?? state.checks[id]?.revealed);
  const title = asText(block.title) || t(L, 'Bài trắc nghiệm', 'Quiz');
  // A 0% pass mark is no requirement, so it is not shown.
  const meta = [plural(L, questions.length, engineStrings.quiz.questions[L]), settings.mode === 'graded' ? tr(L, engineStrings.quiz.graded) : null, settings.passPercent ? tr(L, engineStrings.quiz.passMark, { percent: settings.passPercent }) : null].filter(Boolean).join(' · ');
  return (
    <section role="region" aria-label={title} className={blockFrame(depth)}>
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><Title className="text-lg font-semibold">{title}</Title><p className="text-sm text-muted-foreground">{meta}</p></header>
      {block.intro ? <div className="mb-3"><RichContentView content={asRich(block.intro)} runtime={runtime} /></div> : null}
      <div className="flex flex-col gap-4">
        {questions.map((q, i) => (
          <div key={q.id}>
            <QuestionRenderer question={q} index={i} value={state.answers[q.id]} onChange={(v) => setAnswer(q.id, v)} disabled={submitted || !!state.checks[q.id] || busy} result={resultFor(q.id)} revealed={revealedFor(q.id)} runtime={runtime} depth={depth + 1} />
            {settings.feedback === 'per_question' && !submitted ? <div className="mt-1 flex flex-wrap items-center gap-2">{state.checks[q.id] ? <button type="button" onClick={() => setAnswer(q.id, undefined)} disabled={busy} className={buttonClass.quiet}>{t(L, 'Làm lại', 'Try again')}</button> : <button type="button" onClick={() => void check(q.id)} disabled={busy || state.answers[q.id] === undefined} className={buttonClass.secondary}>{t(L, 'Kiểm tra đáp án', 'Check answer')}</button>}{checkError === q.id ? <><p role="alert" className="text-sm text-destructive">{t(L, 'Chúng tôi chưa thể kiểm tra đáp án này. Đáp án của bạn vẫn được giữ lại—hãy thử lại.', 'We could not check this answer. Your answer is still here—try again.')}</p><button type="button" onClick={() => void check(q.id)} disabled={busy} className={buttonClass.quiet}>{t(L, 'Thử kiểm tra lại', 'Try checking again')}</button></> : null}</div> : null}
          </div>
        ))}
      </div>
      <footer className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3">
        {state.last ? <p className="font-medium">{t(L, 'Kết quả', 'Score')}: {state.last.points}/{state.last.maxPoints} ({state.last.percent}%){state.last.passed !== undefined ? ` · ${state.last.passed ? t(L, 'Đạt', 'Passed') : t(L, 'Chưa đạt', 'Not passed')}` : ''}</p> : null}
        {settings.feedback !== 'per_question' || settings.mode === 'graded' ? (!submitted ? <button type="button" onClick={submit} disabled={busy || (attemptsLeft !== null && attemptsLeft <= 0)} className={buttonClass.primary}>{t(L, 'Nộp bài', 'Submit')}</button> : attemptsLeft === null || attemptsLeft > 0 ? <button type="button" onClick={retry} className={buttonClass.secondary}>{t(L, 'Làm lại', 'Try again')}</button> : null) : null}
        {attemptsLeft !== null ? <span className="text-sm text-muted-foreground">{plural(L, attemptsLeft, engineStrings.quiz.attemptsLeft[L])}</span> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </footer>
    </section>
  );
}
export function QuizBlockRenderer({ block, runtime, depth }: BlockRendererProps<QuizBlock>) { return <QuizRenderer block={block} runtime={runtime} depth={depth} />; }
