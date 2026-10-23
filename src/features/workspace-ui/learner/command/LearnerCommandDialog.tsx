'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { useLocaleChange } from '@/components/LocaleSwitcher';
import type { AppLocale } from '@/i18n/request';
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
};

const GROUPS = ['goTo', 'explore', 'account', 'workspaces'] as const satisfies readonly LearnerCommandGroup[];
const LOCALES = ['vi', 'en'] as const satisfies readonly AppLocale[];

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
export function LearnerCommandDialog({ open, onOpenChange, destinations, returnFocus }: LearnerCommandDialogProps) {
  const t = useTranslations('bench.learner.command');
  const focus = useTranslations('learner.focus');
  const common = useTranslations('common');
  const localeT = useTranslations('locale');
  const router = useRouter();
  const { locale, changeLocale, isPending, error } = useLocaleChange();
  const [theme, setTheme] = useState<WorkspaceTheme>(currentTheme);
  // The dialog stays mounted between openings, so re-read the theme each time it opens: the account
  // menu or drawer may have changed it meanwhile.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTheme(currentTheme());
  }
  /** A same-page hash target (profile → Certificates) that takes focus instead of the trigger. */
  const hashTarget = useRef<string | null>(null);

  const keywords = (key: string) => (t.has(`keywords.${key}`) ? t(`keywords.${key}`) : '');
  const entries = learnerCommandEntries({ focus: key => focus(key), common: key => common(key), command: key => t(key), keywords }, destinations);

  async function go(href: string) {
    const url = new URL(href, window.location.href);
    if (url.pathname === window.location.pathname && url.search === window.location.search) {
      // Same page: update the hash without a guard and focus the target once the dialog lets go.
      if (url.hash) {
        hashTarget.current = url.hash.slice(1);
        if (url.hash !== window.location.hash) window.location.hash = url.hash;
      }
      onOpenChange(false);
      return;
    }
    onOpenChange(false);
    // The unsaved-changes guard only intercepts link clicks and form submits, so ask it explicitly.
    if (!(await requestNavigation())) return;
    router.push(href);
  }

  function restoreFocus(event: Event) {
    const id = hashTarget.current;
    hashTarget.current = null;
    let target: HTMLElement | null = null;
    try { target = id ? document.getElementById(decodeURIComponent(id)) : null; } catch { /* Malformed hash: back to the trigger. */ }
    if (!target && !returnFocus) return;
    event.preventDefault();
    if (!target) { returnFocus?.(); return; }
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: 'start' });
  }

  function chooseTheme(next: WorkspaceTheme) {
    setTheme(next);
    applyWorkspaceTheme(next);
    onOpenChange(false);
  }

  function chooseLocale(next: AppLocale) {
    // Saving reloads the page; the palette stays open meanwhile so a failure stays visible.
    if (next === locale) onOpenChange(false); else changeLocale(next);
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
        {LOCALES.map(option => <PaletteItem key={option} value={`language:${option}`} lang={option} disabled={isPending} keywords={[localeT(option), keywords('language')]} onSelect={() => chooseLocale(option)}>
          <span className="truncate">{localeT(option)}</span>
          {locale === option ? <CurrentMark label={t('current')} /> : null}
        </PaletteItem>)}
      </CommandGroup>
    </CommandList>
    {error ? <p role="alert" className="vf-l-command-error">{error}</p> : null}
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
