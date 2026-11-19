import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Button, Input } from '@/components/ui/classic';
import { EntranceShell } from '@/features/workspace-ui/auth/EntranceShell';
import { EMAIL_LINK_COOKIE, readEmailLink } from '@/lib/identity/email-link';
import { academyBackend } from '@/lib/identity/provider';
import { routes } from '@/lib/routes';

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'same-origin' };

export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (academyBackend() !== 'supabase') redirect(routes.auth.login());
  const params = await searchParams;
  const recovery = params.recovery === '1';
  const pending = readEmailLink((await cookies()).get(EMAIL_LINK_COOKIE)?.value);
  if (!pending || (pending.type === 'recovery') !== recovery) {
    redirect(recovery ? routes.auth.forgotPassword({ error: 'expired' }) : routes.auth.login({ error: 'expired' }));
  }
  const t = await getTranslations('auth');
  const result = params.result === 'account' ? t('emailLink.accountMismatch')
    : params.result === 'email-change' && pending.type === 'email_change' ? t('emailLink.checkBoth') : null;
  const instructions = {
    email: 'signIn', magiclink: 'signIn', signup: 'signup', invite: 'invite', email_change: 'emailChange', recovery: 'recovery',
  } as const;
  return <EntranceShell><main><section className="border" aria-labelledby="email-link-title">
    <h1 id="email-link-title" className="text-2xl font-semibold">{t(recovery ? 'emailLink.recoveryTitle' : 'emailLink.title')}</h1>
    {result ? <>
      <p className="mt-4">{result}</p>
      <a className="mt-4 inline-block text-primary underline" href={recovery ? routes.auth.forgotPassword() : routes.auth.login({ next: pending.next })}>
        {t(recovery ? 'requestNewResetLink' : 'backToLogin')}
      </a>
    </> : <>
      <p className="mt-3">{t(`emailLink.${instructions[pending.type]}`)}</p>
      <p className="mt-2 text-sm text-muted-foreground">{t('emailLink.switchNotice')}</p>
      <form method="post" action={routes.auth.redeemEmail()} className="mt-6 space-y-4">
        <input type="hidden" name="confirmation" value={pending.confirmation} />
        <input type="hidden" name="purpose" value={recovery ? 'recovery' : 'sign-in'} />
        <div className="space-y-1.5">
          <label htmlFor="email-link-account" className="text-sm font-medium">{t('email')}</label>
          <Input id="email-link-account" name="email" type="email" autoComplete="email" required maxLength={320}
            aria-invalid={params.error === 'email'} aria-describedby={params.error === 'email' ? 'email-link-error' : undefined} />
          {params.error === 'email' && <p id="email-link-error" role="alert" className="text-sm text-destructive">{t('invalidEmail')}</p>}
        </div>
        <Button type="submit" name="decision" value="confirm" className="min-h-11 w-full">{t(recovery ? 'emailLink.confirmRecovery' : 'emailLink.confirm')}</Button>
        <button type="submit" name="decision" value="cancel" formNoValidate className="min-h-11 w-full underline">{t('emailLink.cancel')}</button>
      </form>
    </>}
  </section></main></EntranceShell>;
}
