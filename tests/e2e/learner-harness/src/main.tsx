import { useEffect, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { AppShell } from '@/components/AppShell';
import Home from '@/app/app/page';
import Catalog from '@/app/app/courses/page';
import Course from '@/app/app/courses/[courseId]/page';
import Item from '@/app/app/courses/[courseId]/items/[itemId]/page';
import Explore from '@/app/app/explore/page';
import Calendar from '@/app/app/calendar/page';
import Results from '@/app/app/results/page';
import Tasks from '@/app/app/tasks/page';
import Loading from '@/app/app/loading';
import { resolveAsync } from '../../student-harness/src/resolve-async';
import { usePathname, useSearchParams } from './next-navigation';
import { locale, messages } from './i18n';
import { fixtureLearnerName } from './scenarios';
import { learnerReviewParam } from './review-state';
import '@/app/globals.css';
import '@/app/fonts.css';

async function content(path: string, search: string) {
  if (path === '/app/courses') return Catalog({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(search))) });
  const parts = path.split('/');
  if (parts[2] === 'courses' && parts[4] === 'items') return Item({ params: Promise.resolve({ courseId: parts[3], itemId: parts[5] }) });
  if (parts[2] === 'courses' && parts[3]) return Course({ params: Promise.resolve({ courseId: parts[3] }), searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(search))) });
  if (path === '/app/calendar') return Calendar({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(search))) });
  if (path === '/app/results') return Results();
  if (path === '/app/tasks') return Tasks();
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
  const requestedTheme = learnerReviewParam('theme');
  const theme = requestedTheme === 'light' || requestedTheme === 'dark' ? requestedTheme : 'system';
  useEffect(() => {
    let current = true;
    // Resolve nested async server slots (the dashboard trace and readout) as the RSC renderer would.
    void content(path, search).then(resolveAsync)
      .catch((error: Error) => <pre role="alert">{String(error.stack)}</pre>)
      .then((result) => { if (current) { setPage(result); setLoaded(route); } });
    return () => { current = false; };
  }, [path, search, route]);
  // Commit each server-page fixture before mounting its shell so heading focus matches an RSC commit.
  return <NextIntlClientProvider locale={locale()} messages={messages()}>{loaded === route ? <AppShell key={route} theme={theme} userName={fixtureLearnerName()} initials="AN">{page}</AppShell> : null}</NextIntlClientProvider>;
}

document.documentElement.lang = locale();
type FixtureHotData = { root?: Root };
type FixtureHotContext = { data: FixtureHotData; dispose(callback: (data: FixtureHotData) => void): void };
const hot = (import.meta as ImportMeta & { hot?: FixtureHotContext }).hot;
// Reuse the same React root when fixture modules are invalidated by a review edit.
type FixtureRootContainer = HTMLElement & { academyLearnerRoot?: Root };
const container = document.getElementById('root')! as FixtureRootContainer;
const root = container.academyLearnerRoot ?? hot?.data.root ?? createRoot(container);
container.academyLearnerRoot = root;
if (hot) hot.data.root = root;
root.render(<Fixture />);
hot?.dispose(data => { data.root = root; });
