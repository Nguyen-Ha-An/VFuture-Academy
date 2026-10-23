import { LogIn, MousePointerClick, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MarketingSection, SectionHeading } from '@/features/marketing/section-primitives';

const steps = [{ key: 'discover', Icon: Search }, { key: 'identify', Icon: LogIn }, { key: 'participate', Icon: MousePointerClick }] as const;

export function Participation() {
  const t = useTranslations('marketing.participation');
  return <MarketingSection section="participation" className="border-y border-border bg-card"><SectionHeading eyebrow={t('eyebrow')} title={t('title')} description={t('description')} /><ol className="mt-12 grid gap-6 lg:grid-cols-3">{steps.map(({ key, Icon }, index) => <li key={key} className="rounded-xl border border-border bg-background p-6"><div className="flex items-center justify-between"><span className="font-mono text-xs text-primary">{String(index + 1).padStart(2, '0')}</span><Icon aria-hidden="true" className="size-5 text-primary" /></div><h3 className="mt-10 text-xl font-semibold">{t(`steps.${key}.title`)}</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{t(`steps.${key}.description`)}</p></li>)}</ol></MarketingSection>;
}
