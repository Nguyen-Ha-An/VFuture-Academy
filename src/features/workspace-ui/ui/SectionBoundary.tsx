'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ictTime } from '../format';
import { Component, type ReactNode } from 'react';

function FaultFallback({ label }: { label: string }) {
  const t = useTranslations('bench.shared');
  const router = useRouter();
  const locale = useLocale();
  const at = ictTime(new Date(), locale);
  return <div className="vf-notice" data-tone="fault" role="alert"><span className="vf-kicker">{t('fault')}</span><div className="min-w-0"><b className="font-medium">{t('unavailable', { label })}</b> <span className="vf-meta">{at} ICT</span></div><button type="button" className="vf-btn" onClick={() => router.refresh()}>{t('retry')}</button></div>;
}

/** Contains a failing secondary block to its own slot (spec 4.12); the rest of the page renders. */
export class SectionBoundary extends Component<{ label: string; children: ReactNode; silent?: boolean }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.silent ? null : <FaultFallback label={this.props.label} />;
  }
}
