import { preload } from 'react-dom';

/**
 * Inter (variable 400–700) files the staff shell needs on first paint: latin plus vietnamese,
 * matching the `@font-face` blocks in src/app/fonts.css. latin-ext is left to load on demand.
 */
export const STAFF_FONT_PRELOADS = [
  '/fonts/site/inter-var-latin.c940764593d0.woff2',
  '/fonts/site/inter-var-vietnamese.8db00ff46c67.woff2',
] as const;

/**
 * Called by the staff layouts only on the branch that renders StaffWorkspaceShell, so learner,
 * public and legacy staff pages never request Inter.
 */
export function preloadStaffFonts(): void {
  for (const href of STAFF_FONT_PRELOADS) {
    preload(href, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  }
}
