'use client';
import { useState } from 'react';
import * as RTabs from '@radix-ui/react-tabs';
import type { QuestionRendererProps, LearnerQuestion } from '../registry';
import { RichContentView } from '../RichContentView';
import { QuestionRenderer } from '../QuestionRenderer';
import type { GroupQuestion } from './types';
import { plainText } from './QuestionFrame';
import { blockFrame, tabListClass, tabTriggerClass } from '../tone';
import { engineStrings, tr } from '../strings';

export function QuestionGroup(props: QuestionRendererProps<GroupQuestion>) {
  const { question: q, value, onChange, disabled, result, revealed, runtime, index, depth = 0 } = props;
  const answers = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const tabs = q.display?.layout === 'tabs';
  const [active, setActive] = useState(q.questions[0]?.id ?? '');
  const numberLabel = (i: number) => (index !== undefined ? `${index + 1}.${i + 1}` : `${i + 1}`);
  const childProps = (c: LearnerQuestion) => ({ question: c, value: answers[c.id], onChange: (v: unknown) => onChange({ ...answers, [c.id]: v }), disabled, result: result?.children?.find((r) => r.questionId === c.id), revealed, runtime, depth: depth + 1 });
  const child = (c: LearnerQuestion, i: number) => <div><p className="mb-1 text-sm font-semibold text-muted-foreground">{numberLabel(i)}</p><QuestionRenderer {...childProps(c)} /></div>;
  return (
    <section className={blockFrame(depth)} aria-label={plainText(q.sharedContent)}>
      <div className="mb-4 rounded-md bg-muted p-3"><RichContentView content={q.sharedContent} runtime={runtime} path={`/questions/${q.id}/sharedContent`} />{q.content ? <div className="mt-2"><RichContentView content={q.content} runtime={runtime} /></div> : null}</div>
      {tabs && q.questions.length ? (
        <RTabs.Root value={q.questions.some((c) => c.id === active) ? active : q.questions[0].id} onValueChange={setActive} activationMode="automatic">
          <RTabs.List aria-label={tr(runtime.locale, engineStrings.tabs.group)} className={`mb-3 ${tabListClass}`}>
            {q.questions.map((c, i) => <RTabs.Trigger key={c.id} value={c.id} className={tabTriggerClass}>{numberLabel(i)}</RTabs.Trigger>)}
          </RTabs.List>
          {q.questions.map((c, i) => <RTabs.Content key={c.id} value={c.id} className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{child(c, i)}</RTabs.Content>)}
        </RTabs.Root>
      ) : <div className="flex flex-col gap-3">{q.questions.map((c, i) => <div key={c.id}>{child(c, i)}</div>)}</div>}
    </section>
  );
}
