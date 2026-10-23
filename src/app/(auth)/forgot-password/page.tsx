import { getLocale } from 'next-intl/server';
import { ForgotPasswordForm } from '@/components/ForgotPasswordForm';
import { AuthMain, authBenchEnabled } from '@/features/workspace-ui/auth/AuthMain';

export async function generateMetadata() { return { title: await getLocale() === 'en' ? 'Reset your password' : 'Khôi phục mật khẩu' }; }

export default function ForgotPasswordPage() {
  const bench = authBenchEnabled();
  return <AuthMain bench={bench}><ForgotPasswordForm bench={bench} /></AuthMain>;
}
