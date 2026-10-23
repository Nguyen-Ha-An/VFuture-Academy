'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { List, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslations } from 'next-intl';

import { routes } from '@/lib/routes';
import { StateTag, ToleranceBar } from '@/features/workspace-ui/ui/primitives';
import { activityStatus, activityStatusTag, pad2 } from '@/features/workspace-ui/learner/activity/status';
import { LearnerNavigationLink } from './LearnerNavigationLink';

type Module = { id: string; title: string; items: Array<{ id: string; title: string; status: string }> };

export function FocusOutline({ courseId, itemId, modules, courseTitle, progress }: {
  courseId: string;
  itemId: string;
  modules: Module[];
  courseTitle?: string;
  progress?: { completed: number; total: number };
}) {
  const t = useTranslations('learner.focus');
  const activity = useTranslations('bench.learner.activity');
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const navigating = useRef(false);
  // Selecting the current item keeps the learner on this page, so focus returns to the trigger.
  const closeOutline = (stay: boolean) => {
    navigating.current = !stay;
    // Remove the drawer's focus trap before a guard opens its confirmation.
    flushSync(() => setOpen(false));
  };
  const items = modules.flatMap((module) => module.items);
  const done = progress ?? { completed: items.filter((item) => item.status === 'completed').length, total: items.length };
  const doneText = activity('outlineProgress', done);

  return (
    <Dialog.Root open={open} onOpenChange={(value) => { if (value) navigating.current = false; setOpen(value); }}>
      <Dialog.Trigger asChild>
        <button ref={trigger} type="button" className="vf-btn vf-focus-outline-trigger">
          <List className="size-4" aria-hidden="true" /><span>{t('outline')}</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-50 flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground focus:outline-none min-[760px]:w-[360px] min-[760px]:border-l min-[760px]:border-border"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => { if (navigating.current) event.preventDefault(); }}
        >
          <div className="grid shrink-0 gap-3 border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <Dialog.Title className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{t('outline')}</Dialog.Title>
              <Dialog.Close aria-label={t('closeOutline')} className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                <X className="size-5" aria-hidden="true" />
              </Dialog.Close>
            </div>
            {courseTitle ? <p className="m-0 break-words text-base font-medium leading-6">{courseTitle}</p> : null}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <ToleranceBar value={done.total ? (done.completed / done.total) * 100 : 0} label={doneText} />
              <span className="font-mono text-xs text-muted-foreground" aria-hidden="true">{doneText}</span>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
            {modules.map((module, moduleIndex) => (
              <section key={module.id} className="border-b border-border pb-5 last:border-b-0 last:pb-0">
                <div className="flex items-start gap-3 pb-3">
                  <span aria-hidden="true" className="shrink-0 pt-0.5 font-mono text-xs font-medium tabular-nums text-primary">M{pad2(moduleIndex + 1)}</span>
                  <h2 className="min-w-0 break-words text-sm font-semibold leading-6 text-foreground">{module.title}</h2>
                </div>
                <ol aria-label={module.title} className="space-y-1">
                  {module.items.map((outlineItem) => {
                    const current = outlineItem.id === itemId;
                    const status = activityStatus(outlineItem.status);
                    const tag = status === 'not_started' ? null : activityStatusTag(status);
                    return (
                      <li key={outlineItem.id}>
                        <LearnerNavigationLink
                          href={routes.learner.courseItem(courseId, outlineItem.id)}
                          onNavigationStart={() => closeOutline(current)}
                          onNavigationCancelled={() => trigger.current?.focus()}
                          aria-current={current ? 'page' : undefined}
                          data-current={current || undefined}
                          className={`flex min-h-11 min-w-0 flex-col gap-1.5 rounded-md px-3 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${current ? 'bg-muted text-foreground shadow-[inset_2px_0_0_var(--primary)]' : 'text-foreground hover:bg-muted/60'}`}
                        >
                          <span className="block break-words text-sm font-medium leading-6">{outlineItem.title}</span>
                          {tag || current ? <span className="flex flex-wrap items-center gap-2">
                            {tag ? <StateTag tone={tag.tone}>{activity(`state.${tag.key}`)}</StateTag> : null}
                            {current ? <span className="font-mono text-xs text-muted-foreground">{t('currentItem')}</span> : null}
                          </span> : null}
                        </LearnerNavigationLink>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
