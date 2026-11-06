import type { Metadata } from 'next';
import { SITE_NAME } from '@/features/public-site/site-config';
import { EntranceShell } from '@/features/workspace-ui/auth/EntranceShell';

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  robots: { index: false, follow: false },
  icons: { icon: [{ url: '/labs/vfuture-symbol.svg', type: 'image/svg+xml' }] },
};
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <EntranceShell>{children}</EntranceShell>;
}
