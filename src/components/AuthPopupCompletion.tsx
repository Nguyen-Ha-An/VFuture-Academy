'use client';
import { useEffect } from 'react';
import { useLocale } from 'next-intl';
import { completeAuthPopup } from '@/lib/identity/popup-completion';
import type { PopupStatus } from '@/lib/identity/popup-contract';
export function AuthPopupCompletion({ attempt, status }: { attempt: string | null; status: PopupStatus }) {
  const english = useLocale() === 'en';
  useEffect(() => { if (attempt) return completeAuthPopup(attempt, status); }, [attempt, status]);
  return <section className="mx-auto max-w-md space-y-4 rounded-lg border border-border bg-card p-6 text-center">
    <h1 className="text-xl font-semibold">{status === 'success' ? english ? 'Sign-in completed' : 'Đã hoàn tất đăng nhập' : english ? 'Sign-in did not finish' : 'Đăng nhập chưa hoàn tất'}</h1>
    <p role="status">{english ? 'Return to the Academy tab where you started. You can close this window. If that tab is no longer open, open Academy yourself to continue.' : 'Quay lại tab Academy nơi bạn bắt đầu. Bạn có thể đóng cửa sổ này. Nếu tab đó đã đóng, hãy tự mở lại Academy để tiếp tục.'}</p>
    <button type="button" className="min-h-11 rounded border border-border px-4" onClick={() => window.close()}>{english ? 'Close window' : 'Đóng cửa sổ'}</button>
  </section>;
}
