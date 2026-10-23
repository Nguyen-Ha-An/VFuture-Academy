import type { Metadata } from 'next';
import { SITE_NAME } from '@/features/public-site/site-config';
import { AuthBenchShell } from '@/features/workspace-ui/auth/AuthBenchShell';
import { authBenchEnabled } from '@/features/workspace-ui/auth/AuthMain';

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  robots: { index: false, follow: false },
  icons: { icon: [{ url: '/labs/vfuture-symbol.svg', type: 'image/svg+xml' }] },
};
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  if (!authBenchEnabled()) return children;
  return <AuthBenchShell>{children}</AuthBenchShell>;
}
