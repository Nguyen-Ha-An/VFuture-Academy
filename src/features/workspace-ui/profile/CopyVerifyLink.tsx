'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

/** Copies the absolute verify URL. "Copied" shows for 2s; the result is announced politely. */
export function CopyVerifyLink({ url }: { url: string }) {
  const t = useTranslations('bench.profile.certificates');
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      const absolute = new URL(url, window.location.origin).toString();
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(absolute);
      setState('copied');
      timer.current = setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('failed');
    }
  }

  return <>
    <button type="button" className="vf-btn" onClick={() => void copy()}>{state === 'copied' ? t('copied') : t('copy')}</button>
    <span className="sr-only" aria-live="polite">{state === 'copied' ? t('copiedAnnouncement') : ''}</span>
    {state === 'failed' ? <p className="vf-cert-hint" role="alert">{t('copyFailed')}</p> : null}
  </>;
}
