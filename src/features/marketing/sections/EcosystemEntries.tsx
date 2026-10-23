import { ArrowUpRight, BookOpen, BriefcaseBusiness, FolderKanban, Library } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { routes } from '@/lib/routes';
import { MarketingSection, SectionHeading } from '@/features/marketing/section-primitives';

const entries = [
  { key: 'courses', href: routes.public.courses(), Icon: BookOpen },
  { key: 'resources', href: routes.public.resources(), Icon: Library },
  { key: 'opportunities', href: routes.public.opportunities(), Icon: BriefcaseBusiness },
  { key: 'projects', href: routes.public.projects(), Icon: FolderKanban },
] as const;

export function EcosystemEntries() {
  const t = useTranslations('marketing.ecosystem');
  return <MarketingSection section="ecosystem"><SectionHeading eyebrow={t('eyebrow')} title={t('title')} description={t('description')} /><div className="mt-12 grid border-l border-t border-border sm:grid-cols-2 lg:grid-cols-4">{entries.map(({ key, href, Icon }, index) => <Link key={key} href={href} className="group relative min-h-64 border-b border-r border-border p-6 transition-colors hover:bg-muted focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"><div className="flex items-center justify-between"><span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, '0')}</span><Icon aria-hidden="true" className="size-5 text-primary" /></div><h3 className="mt-16 text-xl font-semibold tracking-tight">{t(`items.${key}.title`)}</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{t(`items.${key}.description`)}</p><ArrowUpRight aria-hidden="true" className="absolute bottom-6 right-6 size-4 text-primary" /></Link>)}</div></MarketingSection>;
}
