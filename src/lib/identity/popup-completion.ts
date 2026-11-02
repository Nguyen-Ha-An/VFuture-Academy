import { POPUP_ATTEMPT_PATTERN, POPUP_MESSAGE_TYPE, popupChannelName, type PopupStatus } from './popup-contract';
/** Sends an outcome/correlation ID only. A missing parent leaves instructions visible. */
export function completeAuthPopup(attempt: string, status: PopupStatus) {
  if (!POPUP_ATTEMPT_PATTERN.test(attempt)) return;
  const message = { type: POPUP_MESSAGE_TYPE, attempt, status };
  const opener: Window | null = window.opener;
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(popupChannelName(attempt));
  let active = true;
  const cleanup = () => { active = false; clearTimeout(timeout); channel?.close(); window.removeEventListener('message', onWindowMessage); };
  const acknowledge = (data: unknown) => {
    if (!active || !data || typeof data !== 'object' || !('type' in data) || data.type !== 'academy-auth-popup-ack' || !('attempt' in data) || data.attempt !== attempt) return;
    cleanup(); try { window.close(); } catch { /* Manual tabs retain completion instructions. */ }
  };
  function onWindowMessage(event: MessageEvent) { if (opener && event.source === opener && event.origin === window.location.origin) acknowledge(event.data); }
  window.addEventListener('message', onWindowMessage);
  if (channel) channel.onmessage = event => { if (event.origin === window.location.origin) acknowledge(event.data); };
  const timeout = setTimeout(cleanup, 5000);
  try { opener?.postMessage(message, window.location.origin); } catch { /* Provider COOP may remove opener. */ }
  channel?.postMessage(message);
  return cleanup;
}
