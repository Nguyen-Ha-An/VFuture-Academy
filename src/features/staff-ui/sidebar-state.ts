/**
 * The staff sidebar's saved rail state, shared by the server reader (`chrome.server.ts`), the
 * client shell that writes it (`StaffWorkspaceShell`) and the e2e harness fixture. Plain module:
 * neither `server-only` nor `'use client'`, so every side imports the same name and parser.
 */
export const SIDEBAR_STATE_COOKIE = 'sidebar_state';

const ONE_YEAR = 60 * 60 * 24 * 365;

/** `sidebar_state=false` collapses the rail; anything else (including no cookie) keeps it open. */
export function parseSidebarOpen(value: string | undefined | null): boolean {
  return value !== 'false';
}

/** Cookie string for `document.cookie`: path=/, one year, samesite=lax, secure on https. */
export function sidebarStateCookie(open: boolean, secure: boolean): string {
  return `${SIDEBAR_STATE_COOKIE}=${open}; path=/; max-age=${ONE_YEAR}; samesite=lax${secure ? '; secure' : ''}`;
}
