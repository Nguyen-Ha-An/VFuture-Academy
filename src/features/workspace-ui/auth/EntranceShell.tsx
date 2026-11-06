import Link from 'next/link';
import Image from 'next/image';
import { Suspense, type ReactNode } from 'react';
import { getLocale } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import './entrance.css';

export async function EntranceShell({ children }: { children: ReactNode }) {
  const english = await getLocale() === 'en';
  const query = english ? '?lang=en' : '';
  return <div className="entrance-shell">
    <div className="entrance-content">
      <Link href={`/${query}`} className="entrance-brand" aria-label="VFuture Academy">
        <Image src="/labs/vfuture-symbol.svg" alt="" width={42} height={42} />
        <span>VFuture <strong>Academy</strong></span>
      </Link>
      {children}
      <footer className="entrance-footer">
        <Suspense fallback={null}><LocaleSwitcher variant="links" /></Suspense>
        <div><Link href={`/privacy${query}`}>{english ? 'Privacy notice' : 'Quyền riêng tư'}</Link><span aria-hidden="true"> · </span><Link href={`/terms${query}`}>{english ? 'Terms of use' : 'Điều khoản sử dụng'}</Link></div>
      </footer>
    </div>
  </div>;
}
