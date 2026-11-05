import { Suspense } from 'react';
import { FrameworkProof } from '../framework-proof';

type Query = Promise<Record<string, string | string[] | undefined>>;

async function QueryProof({ searchParams }: { searchParams: Query }) {
  const query = await searchParams;
  const locale = query.lang === 'vi' ? 'vi' : 'en';
  const theme = query.theme === 'dark' ? 'dark' : 'light';
  return <FrameworkProof locale={locale} theme={theme}><p data-testid="server-content">Server-rendered course content.</p></FrameworkProof>;
}

export default function Page({ searchParams }: { searchParams: Query }) {
  return <Suspense fallback={<p>Loading course workspace…</p>}><QueryProof searchParams={searchParams} /></Suspense>;
}
