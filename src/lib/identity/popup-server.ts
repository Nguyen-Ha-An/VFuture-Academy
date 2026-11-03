import 'server-only';
import { NextResponse } from 'next/server';
import { POPUP_ATTEMPT_PATTERN, type PopupStatus } from './popup-contract';
export function popupCompletionResponse(origin: string, attempt: string, status: PopupStatus) {
  if (!POPUP_ATTEMPT_PATTERN.test(attempt)) throw new Error('Invalid popup attempt');
  const url = new URL('/auth/popup', origin); url.searchParams.set('attempt', attempt); url.searchParams.set('status', status);
  const response = NextResponse.redirect(url, 303);
  response.headers.set('Cache-Control', 'no-store'); response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  return response;
}
