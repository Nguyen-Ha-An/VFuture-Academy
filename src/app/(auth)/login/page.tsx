import { getLocale } from 'next-intl/server';
import { AuthForm } from '@/components/AuthForm';
import { AuthMain, authBenchEnabled } from '@/features/workspace-ui/auth/AuthMain';

export async function generateMetadata() { return { title: await getLocale() === 'en' ? 'Sign in' : 'Đăng nhập' }; }

export default function LoginPage() {
  const bench = authBenchEnabled();
  return <AuthMain bench={bench}><AuthForm mode="login" bench={bench} /></AuthMain>;
}
