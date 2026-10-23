export const WORKSPACE_THEME_COOKIE = 'vf-theme';
export const workspaceThemes = ['system', 'dark', 'light'] as const;
export type WorkspaceTheme = (typeof workspaceThemes)[number];

export function parseWorkspaceTheme(value: string | undefined | null): WorkspaceTheme {
  return workspaceThemes.includes(value as WorkspaceTheme) ? value as WorkspaceTheme : 'system';
}

const ONE_YEAR = 60 * 60 * 24 * 365;

export function workspaceThemeCookie(theme: WorkspaceTheme, secure: boolean) {
  return `${WORKSPACE_THEME_COOKIE}=${theme}; path=/; max-age=${ONE_YEAR}; samesite=lax${secure ? '; secure' : ''}`;
}

/** `system` leaves the attribute off so CSS follows prefers-color-scheme. */
export function workspaceThemeAttribute(theme: WorkspaceTheme): 'dark' | 'light' | undefined {
  return theme === 'system' ? undefined : theme;
}
