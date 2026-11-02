'use client';
import { useEffect, useRef, useState } from 'react';
import { startAuthPopup, type PopupError, type PopupHandle, type PopupPhase } from './popup-client';
export function useAuthPopup(next: string, english: boolean) {
  const current = useRef<PopupHandle | null>(null);
  const phaseRef = useRef<PopupPhase | null>(null);
  const [phase, setPhase] = useState<PopupPhase | null>(null);
  const [error, setError] = useState<PopupError | null>(null);
  useEffect(() => () => current.current?.cancel(false), []);
  const busy = phase === 'waiting' || phase === 'verifying';
  const open = (url: string) => {
    if (phaseRef.current === 'waiting' || phaseRef.current === 'verifying') { current.current?.focus(); return; }
    current.current?.cancel(false); setError(null);
    current.current = startAuthPopup({ url, next, onPhase: value => { phaseRef.current = value; setPhase(value); }, onError: value => { phaseRef.current = null; setError(value); setPhase(null); } });
  };
  const errors: Record<PopupError, string> = english ? {
    blocked: 'Your browser blocked the sign-in window. Allow popups for this site, then try again.',
    cancelled: 'Sign-in cancelled. You can try again.', provider: 'Sign-in was cancelled or could not finish. Please try again.',
    session: 'We could not confirm your sign-in. Please try again.', timeout: 'The sign-in window expired. Please try again.',
  } : {
    blocked: 'Trình duyệt đã chặn cửa sổ đăng nhập. Cho phép cửa sổ bật lên trên trang này rồi thử lại.',
    cancelled: 'Đã hủy đăng nhập. Bạn có thể thử lại.', provider: 'Đăng nhập đã bị hủy hoặc chưa hoàn tất. Vui lòng thử lại.',
    session: 'Chưa thể xác nhận đăng nhập. Vui lòng thử lại.', timeout: 'Cửa sổ đăng nhập đã hết hạn. Vui lòng thử lại.',
  };
  const status = phase === 'verifying' ? english ? 'Confirming your sign-in…' : 'Đang xác nhận đăng nhập…'
    : phase === 'closed' ? english ? 'Waiting for sign-in to finish. You can retry if you closed the window.' : 'Đang chờ đăng nhập hoàn tất. Bạn có thể thử lại nếu đã đóng cửa sổ.'
      : phase === 'waiting' ? english ? 'Complete sign-in in the popup window.' : 'Hoàn tất đăng nhập trong cửa sổ bật lên.' : null;
  return { open, busy, phase, status, error: error ? errors[error] : null, cancel: () => current.current?.cancel() };
}
