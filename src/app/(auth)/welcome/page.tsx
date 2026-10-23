import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { WelcomeForm } from '@/components/WelcomeForm';
import { AuthMain, authBenchEnabled } from '@/features/workspace-ui/auth/AuthMain';
import { Kicker } from '@/features/workspace-ui/ui/primitives';
import { requireUser } from '@/lib/auth';
import { supabaseUser } from '@/lib/supabase/server';
import { profileState } from '@/lib/profile-state';
import { routes } from '@/lib/routes';
import { safeInternalPath } from '@/lib/safe-internal-path';

export async function generateMetadata() { return { title: await getLocale() === 'en' ? 'Complete your profile' : 'Hoàn thiện hồ sơ' }; }

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const params = await searchParams;
  const next = safeInternalPath(typeof params.next === 'string' ? params.next : undefined);
  const user = await requireUser(next);
  let state: ReturnType<typeof profileState> = 'unavailable';
  try {
    const supabase = await supabaseUser();
    const profile = await supabase.from('profiles').select('handle').eq('id', user.id).maybeSingle();
    state = profileState(profile);
  } catch {
    // Render the same retryable profile state as a failed database response.
  }
  if (state === 'complete') redirect(next);
  const bench = authBenchEnabled();
  if (state === 'unavailable') {
    const t = await getTranslations('auth');
    if (bench) {
      const tb = await getTranslations('bench.auth');
      return <AuthMain bench><section className="vf-auth-form"><Kicker>{tb('kicker.welcome')}</Kicker><h1 className="vf-title-sm">{t('welcomeTitle')}</h1><p role="alert" className="mt-6">{t('profileLoadError')}</p><a className="vf-btn vf-btn-lg vf-btn-block mt-4" href={routes.auth.welcome({ next })}>{t('tryAgain')}</a></section></AuthMain>;
    }
    return <main className="flex min-h-screen items-center px-4 py-8"><section className="mx-auto w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm"><p role="alert">{t('profileLoadError')}</p><a className="mt-4 inline-flex min-h-11 items-center text-primary underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" href={routes.auth.welcome({ next })}>{t('tryAgain')}</a></section></main>;
  }
  return <AuthMain bench={bench}><WelcomeForm next={next} bench={bench} /></AuthMain>;
}
