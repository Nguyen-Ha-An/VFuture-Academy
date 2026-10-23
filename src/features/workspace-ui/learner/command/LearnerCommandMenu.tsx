'use client';

import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useApplePlatform, useCommandShortcut } from '@/components/command-shortcut';
import type { LearnerCommandDestinations } from './entries';

/** cmdk lives only in this chunk; the import starts on the first intent (pointer, focus, shortcut). */
const loadDialog = () => import('./LearnerCommandDialog');
const LearnerCommandDialog = lazy(() => loadDialog().then(module => ({ default: module.LearnerCommandDialog })));

function SearchGlyph() {
  return <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="vf-l-search-glyph">
    <circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" />
  </svg>;
}

/**
 * The bench bar's search slot: "Search or jump to…" plus ⌘K / Ctrl K, glyph-only below 1100px
 * (learner.css). The palette (LearnerCommandDialog, cmdk) is lazy so it stays out of the shell chunk.
 * ⌘K never opens over a modal or while the learner types in a field or editor.
 */
export function LearnerCommandMenu({ destinations }: { destinations?: LearnerCommandDestinations }) {
  const t = useTranslations('bench.learner.shell');
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const openRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const apple = useApplePlatform();

  const setMenuOpen = useCallback((next: boolean) => {
    if (next) setRequested(true);
    openRef.current = next;
    setOpen(next);
  }, []);

  useCommandShortcut({
    isOpen: () => openRef.current,
    onToggle: next => { void loadDialog(); setMenuOpen(next); },
    ignoreEditable: true,
  });

  const preload = () => void loadDialog();
  const label = t('search');

  return <>
    <button ref={triggerRef} type="button" className="vf-l-search-trigger" aria-label={label} title={label}
      aria-haspopup="dialog" aria-expanded={open} aria-keyshortcuts={apple ? 'Meta+K' : 'Control+K'}
      onClick={() => setMenuOpen(true)} onPointerEnter={preload} onFocus={preload}>
      <SearchGlyph />
      <span className="vf-l-search-label">{label}</span>
      <kbd className="vf-l-search-kbd" aria-hidden="true">{apple ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
    {requested ? <Suspense fallback={null}>
      {/* Without a Radix DialogTrigger the dialog cannot find its opener, so closing hands focus back
       * here explicitly (also after ⌘K from the page body); a route change then moves it to the h1. */}
      <LearnerCommandDialog open={open} onOpenChange={setMenuOpen} destinations={destinations} returnFocus={() => triggerRef.current?.focus()} />
    </Suspense> : null}
  </>;
}
