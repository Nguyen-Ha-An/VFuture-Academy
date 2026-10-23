'use client';

import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { useLocaleChange } from '@/components/LocaleSwitcher';
import type { AppLocale } from '@/i18n/request';
import { WORKSPACE_THEME_COOKIE, parseWorkspaceTheme, workspaceThemeAttribute, workspaceThemeCookie, workspaceThemes, type WorkspaceTheme } from '../theme';

let lastAppliedTheme: WorkspaceTheme | null = null;

function currentWorkspaceTheme(initial: WorkspaceTheme): WorkspaceTheme {
  if (typeof document === 'undefined') return initial;
  try {
    const prefix = `${WORKSPACE_THEME_COOKIE}=`;
    const stored = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(prefix));
    if (stored) return parseWorkspaceTheme(decodeURIComponent(stored.slice(prefix.length)));
  } catch { /* The in-memory choice still covers this page when cookies are unavailable. */ }
  return lastAppliedTheme ?? initial;
}

/** Writes the vf-theme cookie and updates every live surface; the server applies it on the next render. */
export function applyWorkspaceTheme(next: WorkspaceTheme) {
  lastAppliedTheme = next;
  try { document.cookie = workspaceThemeCookie(next, window.location.protocol === 'https:'); } catch { /* Falls back to system on the next load. */ }
  const attribute = workspaceThemeAttribute(next);
  document.querySelectorAll<HTMLElement>('.vf-workspace').forEach(surface => {
    if (attribute) surface.dataset.theme = attribute; else delete surface.dataset.theme;
  });
}

/**
 * Segmented control for drawers and settings panels. With `showLabel` a visible mono label sits
 * above the group and names it (aria-labelledby); otherwise the group keeps an aria-label.
 */
export function ThemeSwitcher({ initial, className, showLabel }: { initial: WorkspaceTheme; className?: string; showLabel?: boolean }) {
  const t = useTranslations('bench.shared.theme');
  const labelId = useId();
  const [theme, setTheme] = useState<WorkspaceTheme>(() => currentWorkspaceTheme(initial));
  const choose = (next: WorkspaceTheme) => { setTheme(next); applyWorkspaceTheme(next); };
  const group = <div role="group" aria-label={showLabel ? undefined : t('label')} aria-labelledby={showLabel ? labelId : undefined} className={className ?? 'inline-flex border border-border'}>
    {workspaceThemes.map(option => <button key={option} type="button" aria-pressed={theme === option} onClick={() => choose(option)} className="vf-theme-option vf-label px-2.5">{t(option)}</button>)}
  </div>;
  if (!showLabel) return group;
  return <div><span id={labelId} className="vf-label mb-2 block">{t('label')}</span>{group}</div>;
}

/** Theme as radio items inside an account menu, so it keeps the menu's keyboard model. */
export function ThemeMenuItems({ initial }: { initial: WorkspaceTheme }) {
  const t = useTranslations('bench.shared.theme');
  const [theme, setTheme] = useState<WorkspaceTheme>(() => currentWorkspaceTheme(initial));
  return <Dropdown.Group>
    <Dropdown.Label className="vf-label px-3 pb-1 pt-2">{t('label')}</Dropdown.Label>
    <Dropdown.RadioGroup value={theme} onValueChange={value => { const next = value as WorkspaceTheme; setTheme(next); applyWorkspaceTheme(next); }}>
      {workspaceThemes.map(option => <Dropdown.RadioItem key={option} value={option} onSelect={event => event.preventDefault()}
        className="flex min-h-11 w-full cursor-default select-none items-center justify-between gap-2 px-3 py-2 text-left text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:ring-2 data-[highlighted]:ring-inset data-[highlighted]:ring-ring">
        {t(option)}<Dropdown.ItemIndicator><span className="vf-meta" aria-hidden="true">■</span></Dropdown.ItemIndicator>
      </Dropdown.RadioItem>)}
    </Dropdown.RadioGroup>
  </Dropdown.Group>;
}

const LOCALES = ['vi', 'en'] as const satisfies readonly AppLocale[];

/**
 * Language as radio items inside an account menu. Selecting keeps the menu open (preventDefault)
 * so a failed save stays visible; the page reloads on success.
 */
export function LanguageMenuItems() {
  const common = useTranslations('common');
  const localeT = useTranslations('locale');
  const { locale, changeLocale, isPending, error } = useLocaleChange();
  return <Dropdown.Group>
    <Dropdown.Label className="vf-label px-3 pb-1 pt-2">{common('language')}</Dropdown.Label>
    <Dropdown.RadioGroup value={locale} onValueChange={value => { if (value !== locale) changeLocale(value as AppLocale); }}>
      {LOCALES.map(option => <Dropdown.RadioItem key={option} value={option} lang={option} disabled={isPending} onSelect={event => event.preventDefault()}
        className="flex min-h-11 w-full cursor-default select-none items-center justify-between gap-2 px-3 py-2 text-left text-sm outline-none data-[disabled]:opacity-60 data-[highlighted]:bg-accent data-[highlighted]:ring-2 data-[highlighted]:ring-inset data-[highlighted]:ring-ring">
        {localeT(option)}<Dropdown.ItemIndicator><span className="vf-meta" aria-hidden="true">■</span></Dropdown.ItemIndicator>
      </Dropdown.RadioItem>)}
    </Dropdown.RadioGroup>
    {error ? <p role="alert" className="px-3 py-2 text-sm text-destructive">{error}</p> : null}
  </Dropdown.Group>;
}

/** Segmented language control for drawers, matching ThemeSwitcher (including `showLabel`). */
export function LanguageSwitcher({ className, showLabel }: { className?: string; showLabel?: boolean }) {
  const common = useTranslations('common');
  const localeT = useTranslations('locale');
  const labelId = useId();
  const { locale, changeLocale, isPending, error } = useLocaleChange();
  return <div>
    {showLabel ? <span id={labelId} className="vf-label mb-2 block">{common('language')}</span> : null}
    <div role="group" aria-label={showLabel ? undefined : common('language')} aria-labelledby={showLabel ? labelId : undefined} className={className ?? 'inline-flex border border-border'}>
      {LOCALES.map(option => <button key={option} type="button" lang={option} aria-pressed={locale === option} disabled={isPending} onClick={() => { if (option !== locale) changeLocale(option); }} className="vf-theme-option vf-label px-2.5 disabled:opacity-60">{localeT(option)}</button>)}
    </div>
    {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
  </div>;
}
