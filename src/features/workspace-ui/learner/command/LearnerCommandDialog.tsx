'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { requestNavigation } from '@/lib/navigation-guard';
import { commandFilter } from '@/lib/search-text';
import { workspaceThemes, type WorkspaceTheme } from '../../theme';
import { applyWorkspaceTheme } from '../../ui/ThemeSwitcher';
import { learnerCommandEntries, type LearnerCommandDestinations, type LearnerCommandGroup } from './entries';

export type LearnerCommandDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinations?: LearnerCommandDestinations;
  /** Where focus goes on close unless a same-page hash target takes it (the trigger). */
  returnFocus?: () => void;
  /** Opens the shared account owner after the command focus scope exits. */
  onOpenAccount?: () => void;
};

const GROUPS = ['goTo', 'explore', 'account', 'workspaces'] as const satisfies readonly LearnerCommandGroup[];

/** The applied theme, read from the learner surface that applyWorkspaceTheme updates. */
function currentTheme(): WorkspaceTheme {
  if (typeof document === 'undefined') return 'system';
  const value = document.querySelector<HTMLElement>('.vf-workspace.vf-learner-refined')?.dataset.theme;
  return value === 'light' || value === 'dark' ? value : 'system';
}

/**
 * The cmdk half of the learner command menu, loaded lazily by LearnerCommandMenu. Destinations come
 * from learnerCommandEntries (the nav and account menu hrefs); preferences reuse the account menu's
 * theme and language plumbing.
 */
export function LearnerCommandDialog({ open, onOpenChange, destinations, returnFocus, onOpenAccount }: LearnerCommandDialogProps) {
  const t = useTranslations('bench.learner.command');
  const focus = useTranslations('learner.focus');
  const common = useTranslations('common');
  const router = useRouter();
  const [theme, setTheme] = useState<WorkspaceTheme>(currentTheme);
  const pendingExit = useRef<{ kind: 'route'; href: string; from: string } | { kind: 'account' } | null>(null);
  const generation = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // The dialog stays mounted between openings, so re-read the theme each time it opens: the account
  // menu or drawer may have changed it meanwhile.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setTheme(currentTheme()); generation.current += 1; pendingExit.current = null; }
  }

  const keywords = (key: string) => (t.has(`keywords.${key}`) ? t(`keywords.${key}`) : '');
  const entries = learnerCommandEntries({ focus: key => focus(key), common: key => common(key), command: key => t(key), keywords }, destinations);

  function go(href: string) {
    pendingExit.current = { kind: 'route', href, from: window.location.pathname + window.location.search };
    onOpenChange(false);
  }

  function restoreFocus(event: Event) {
    event.preventDefault();
    const action = pendingExit.current;
    pendingExit.current = null;
    const closingGeneration = generation.current;
    // Radix dispatches this callback during focus-scope cleanup. Finish that commit
    // before another owner opens its dialog or an unsaved-work guard is requested.
    queueMicrotask(() => {
      if (!mounted.current || openRef.current || generation.current !== closingGeneration) return;
      if (!action) { returnFocus?.(); return; }
      if (action.kind === 'account') { onOpenAccount?.(); return; }
      if (window.location.pathname + window.location.search !== action.from) return;
      const url = new URL(action.href, window.location.href);
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        if (!url.hash) { returnFocus?.(); return; }
        let id = '';
        try { id = decodeURIComponent(url.hash.slice(1)); } catch { returnFocus?.(); return; }
        if (url.hash !== window.location.hash) window.location.hash = url.hash;
        const target = document.getElementById(id);
        if (target) { target.focus({ preventScroll: true }); target.scrollIntoView?.({ block: 'start' }); }
        else returnFocus?.();
        return;
      }
      void requestNavigation().then(allowed => {
        if (!mounted.current || openRef.current || generation.current !== closingGeneration
          || window.location.pathname + window.location.search !== action.from) return;
        if (allowed) router.push(action.href);
        else returnFocus?.();
      });
    });
  }

  function chooseTheme(next: WorkspaceTheme) {
    setTheme(next);
    applyWorkspaceTheme(next);
    onOpenChange(false);
  }

  return <CommandDialog open={open} onOpenChange={onOpenChange} title={t('title')} description={t('description')} closeLabel={common('close')}
    className="vf-l-command top-[15svh] translate-y-0"
    commandProps={{ filter: commandFilter, loop: true, vimBindings: false }} onCloseAutoFocus={restoreFocus}>
    <CommandInput placeholder={t('input')} wrapperClassName="pr-12" />
    {/* Groups are divided by a top hairline instead of separators: a role=separator child is not allowed in a listbox. */}
    <CommandList label={t('results')} className="vf-l-command-list">
      <CommandEmpty>{t('empty')}</CommandEmpty>
      {GROUPS.map(group => {
        const items = entries.filter(entry => entry.group === group);
        if (!items.length) return null;
        return <CommandGroup key={group} heading={t(`groups.${group}`)}>
          {items.map(item => <PaletteItem key={item.id} value={item.id} keywords={[item.label, item.keywords, item.code ?? '']} onSelect={() => void go(item.href)}>
            {item.code ? <span className="vf-l-command-code" aria-hidden="true">{item.code}</span> : null}
            <span className="truncate">{item.label}</span>
            {item.shortcutKey ? <span className="vf-l-command-hint" aria-hidden="true">{t('shortcut', { key: item.shortcutKey })}</span> : null}
          </PaletteItem>)}
        </CommandGroup>;
      })}
      <CommandGroup heading={t('groups.preferences')}>
        {workspaceThemes.map(option => <PaletteItem key={option} value={`theme:${option}`} keywords={[t(`theme.${option}`), keywords('theme')]} onSelect={() => chooseTheme(option)}>
          <span className="truncate">{t(`theme.${option}`)}</span>
          {theme === option ? <CurrentMark label={t('current')} /> : null}
        </PaletteItem>)}
        {onOpenAccount ? <PaletteItem value="account:preferences" keywords={[t('accountPreferences'), keywords('language'), keywords('theme')]} onSelect={() => {
          pendingExit.current = { kind: 'account' };
          onOpenChange(false);
        }}><span className="truncate">{t('accountPreferences')}</span></PaletteItem> : null}
      </CommandGroup>
    </CommandList>
    <p className="vf-l-command-footer" aria-hidden="true">{t('hint')}</p>
  </CommandDialog>;
}

function CurrentMark({ label }: { label: string }) {
  return <span className="vf-l-command-current"><span aria-hidden="true">■</span><span className="sr-only">{label}</span></span>;
}

function PaletteItem({ value, keywords, onSelect, disabled, lang, children }: { value: string; keywords: string[]; onSelect: () => void; disabled?: boolean; lang?: string; children: ReactNode }) {
  return <CommandItem value={value} keywords={keywords.filter(Boolean)} onSelect={onSelect} disabled={disabled} lang={lang} className="vf-l-command-item">
    {children}
  </CommandItem>;
}
