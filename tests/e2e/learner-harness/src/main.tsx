import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { AppShell } from '@/components/AppShell';
import Home from '@/app/app/page';
import Catalog from '@/app/app/courses/page';
import Course from '@/app/app/courses/[courseId]/page';
import Item from '@/app/app/courses/[courseId]/items/[itemId]/page';
import Explore from '@/app/app/explore/page';
import Loading from '@/app/app/loading';
import { resolveAsync } from '../../student-harness/src/resolve-async';
import { usePathname, useSearchParams } from './next-navigation';
import { locale, messages } from './i18n';
import '@/app/globals.css';

async function content(path: string, search: string) {
  if (path === '/app/courses') return Catalog({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(search))) });
  const parts = path.split('/');
  if (parts[2] === 'courses' && parts[4] === 'items') return Item({ params: Promise.resolve({ courseId: parts[3], itemId: parts[5] }) });
  if (parts[2] === 'courses' && parts[3]) return Course({ params: Promise.resolve({ courseId: parts[3] }) });
  if (path === '/app/explore') return Explore();
  if (path === '/app/loading') return Loading();
  return Home();
}

function Fixture() {
  const path = usePathname();
  const search = useSearchParams().toString();
  const [page, setPage] = useState<ReactNode>(null);
  const [loaded, setLoaded] = useState('');
  const route = `${path}?${search}`;
  useEffect(() => {
    let current = true;
    // Resolve nested async server slots (the dashboard trace and readout) as the RSC renderer would.
    void content(path, search).then(resolveAsync)
      .catch((error: Error) => <pre role="alert">{String(error.stack)}</pre>)
      .then((result) => { if (current) { setPage(result); setLoaded(route); } });
    return () => { current = false; };
  }, [path, search, route]);
  // Commit each server-page fixture before mounting its shell so heading focus matches an RSC commit.
  return <NextIntlClientProvider locale={locale()} messages={messages()}>{loaded === route ? <AppShell key={route} userName={'A very long student account name '.repeat(12)} initials="AN">{page}</AppShell> : null}</NextIntlClientProvider>;
}

document.documentElement.lang = locale();
createRoot(document.getElementById('root')!).render(<Fixture />);
