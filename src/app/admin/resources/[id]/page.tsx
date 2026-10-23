import { redirect } from 'next/navigation';
import { routes } from '@/lib/routes';
export default async function LegacyPage({ params, searchParams }: { params: Promise<{id:string}>; searchParams?: Promise<Record<string,string|string[]|undefined>> }) {
  redirect(routes.studio.resource((await params).id, await searchParams));
}
