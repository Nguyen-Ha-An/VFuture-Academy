import { notFound } from 'next/navigation';
import { compileCourse } from '@/content-engine/compile';
import { FIXTURES, fixtureResolver, fixtureNames } from '@/content-engine/fixtures';
import { PlaygroundClient } from './PlaygroundClient';

export const dynamic = 'force-dynamic';

export default async function PlaygroundPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const compiled = Object.fromEntries(await Promise.all(fixtureNames.map(async (name) => {
    const r = await compileCourse(FIXTURES[name], fixtureResolver);
    return [name, { ok: r.ok, report: r.report, compiled: r.compiled ?? null }];
  })));
  return <PlaygroundClient data={compiled} />;
}
