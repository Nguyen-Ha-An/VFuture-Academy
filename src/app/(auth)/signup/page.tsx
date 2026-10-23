import { getLocale } from 'next-intl/server';
import { AuthForm } from '@/components/AuthForm';
import { AuthMain, authBenchEnabled } from '@/features/workspace-ui/auth/AuthMain';

export async function generateMetadata() { return { title: await getLocale() === 'en' ? 'Create an account' : 'Tạo tài khoản' }; }

export default function SignupPage() {
  const bench = authBenchEnabled();
  return <AuthMain bench={bench}><AuthForm mode="signup" bench={bench} /></AuthMain>;
}
