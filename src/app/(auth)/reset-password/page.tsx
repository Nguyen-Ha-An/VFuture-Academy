import { getLocale } from 'next-intl/server';
import { ResetPasswordForm } from '@/components/ResetPasswordForm';
import { AuthMain, authBenchEnabled } from '@/features/workspace-ui/auth/AuthMain';

export async function generateMetadata() { return { title: await getLocale() === 'en' ? 'Choose a new password' : 'Đặt mật khẩu mới' }; }

export default function ResetPasswordPage() {
  const bench = authBenchEnabled();
  return <AuthMain bench={bench}><ResetPasswordForm bench={bench} /></AuthMain>;
}
