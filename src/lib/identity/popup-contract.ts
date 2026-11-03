/** Correlation only: this identifier is never accepted as authentication. */
export const POPUP_ATTEMPT_PATTERN = /^[a-f0-9]{48}$/;
export const POPUP_MESSAGE_TYPE = 'academy-auth-popup';
export type PopupStatus = 'success' | 'error';
export function popupChannelName(attempt: string) { return `${POPUP_MESSAGE_TYPE}:${attempt}`; }
export function isPopupSignal(data: unknown, attempt: string): data is { type: string; attempt: string; status: PopupStatus } {
  return typeof data === 'object' && data !== null && 'type' in data && data.type === POPUP_MESSAGE_TYPE
    && 'attempt' in data && data.attempt === attempt && 'status' in data && (data.status === 'success' || data.status === 'error');
}
