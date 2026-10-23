'use client';

import { useEffect, useState } from 'react';
import { workspaceThemeAttribute, workspaceThemeCookie, workspaceThemes, type WorkspaceTheme } from '@/features/workspace-ui/theme';

const THEME_EVENT = 'vf-staff-theme';

/**
 * Writes the vf-theme cookie and updates the live staff shell; the server renders the same
 * `data-theme` on the next request. `system` removes the attribute so CSS follows prefers-color-scheme.
 */
export function applyStaffTheme(theme: WorkspaceTheme): void {
  if (typeof document === 'undefined') return;
  try { document.cookie = workspaceThemeCookie(theme, window.location.protocol === 'https:'); } catch { /* Falls back to system on the next load. */ }
  const attribute = workspaceThemeAttribute(theme);
  document.querySelectorAll<HTMLElement>('.vf-staff').forEach((surface) => {
    if (attribute) surface.dataset.theme = attribute;
    else delete surface.dataset.theme;
  });
  window.dispatchEvent(new CustomEvent<WorkspaceTheme>(THEME_EVENT, { detail: theme }));
}

/** The chosen theme, kept in step across every staff theme control (top bar and user menu). */
export function useStaffTheme(initial: WorkspaceTheme): [WorkspaceTheme, (next: WorkspaceTheme) => void] {
  const [theme, setTheme] = useState<WorkspaceTheme>(initial);
  useEffect(() => {
    const sync = (event: Event) => {
      const next = (event as CustomEvent<unknown>).detail;
      if (workspaceThemes.includes(next as WorkspaceTheme)) setTheme(next as WorkspaceTheme);
    };
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);
  return [theme, (next) => { setTheme(next); applyStaffTheme(next); }];
}
