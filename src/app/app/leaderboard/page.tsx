import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { isoWeek, vietnamDay } from '@/features/workspace-ui/format';
import { LeaderboardBenchHead } from '@/features/workspace-ui/profile/LeaderboardBench';
import { LeaderboardBoard } from '@/features/workspace-ui/profile/LeaderboardBoard';
import { BenchSkeleton } from '@/features/workspace-ui/ui/primitives';
import { SectionBoundary } from '@/features/workspace-ui/ui/SectionBoundary';
import { requireUser } from '@/lib/auth';

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const scope = params.scope === 'branch' ? 'branch' as const : 'global' as const;
  return <LeaderboardBenchPage scope={scope} userId={user.id} />;
}

async function LeaderboardBenchPage({ scope, userId }: { scope: 'global' | 'branch'; userId: string }) {
  const [b, shared] = await Promise.all([getTranslations('bench.profile.leaderboard'), getTranslations('bench.shared')]);
  // The kicker week follows the ICT calendar day, matching the Monday 00:00 ICT reset.
  const week = isoWeek(new Date(`${vietnamDay(new Date())}T12:00:00Z`));
  return (
    <div className="vf-lb">
      <LeaderboardBenchHead scope={scope} week={week} />
      <SectionBoundary label={b('board')}>
        <Suspense fallback={<BenchSkeleton rows={10} label={shared('loading', { label: b('loading') })} />}>
          <LeaderboardBoard scope={scope} userId={userId} />
        </Suspense>
      </SectionBoundary>
    </div>
  );
}
