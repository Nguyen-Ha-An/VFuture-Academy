import { getLocale } from 'next-intl/server';

import type { Locale } from '@/content-engine';
import { readLearnerHome } from '@/features/learner/summary';
import { listCatalog } from '@/features/catalog/service';
import { LearnerDashboardBench } from '@/features/workspace-ui/learner/dashboard.server';
import { requireUser } from '@/lib/auth';

export default async function LearnerHomePage() {
  const [user, localeValue] = await Promise.all([requireUser(), getLocale()]);
  const locale: Locale = localeValue === 'en' ? 'en' : 'vi';
  const actor = { userId: user.id, roles: [] };
  const [summary, catalog] = await Promise.all([readLearnerHome(actor, locale), listCatalog(actor, locale)]);
  const name = summary.rewards.profile.displayName || summary.rewards.profile.handle || user.email?.split('@')[0] || '';
  return <LearnerDashboardBench actor={actor} locale={locale} summary={summary} catalog={catalog} name={name} />;
}
