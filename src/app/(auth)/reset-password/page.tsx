import { getLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ResetPasswordForm } from '@/components/ResetPasswordForm';
import { AuthMain, authBenchEnabled } from '@/features/workspace-ui/auth/AuthMain';
import { academyBackend } from '@/lib/identity/provider';
import { recoveryAttemptPattern, recoveryCookieName } from '@/lib/identity/recovery-receipt';
import { routes } from '@/lib/routes';

export async function generateMetadata() { return { title: await getLocale() === 'en' ? 'Choose a new password' : 'Đặt mật khẩu mới' }; }

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ recovery?: string | string[] }> }) {
  const bench = authBenchEnabled();
  if (academyBackend() === 'azure') return <AuthMain bench={bench}><ResetPasswordForm bench={bench} /></AuthMain>;
  const attempt = (await searchParams).recovery;
  if (typeof attempt !== 'string' || !recoveryAttemptPattern.test(attempt) || !(await cookies()).has(recoveryCookieName(attempt))) {
    redirect(routes.auth.forgotPassword({ error: 'expired' }));
  }
  return <AuthMain bench={bench}><ResetPasswordForm bench={bench} recoveryAttempt={attempt} /></AuthMain>;
}
