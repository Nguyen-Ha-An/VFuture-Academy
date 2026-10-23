import { redirect } from 'next/navigation';
import { routes } from '@/lib/routes';

export default function LegacyPage(): Promise<void>;
export default function LegacyPage(props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }): Promise<void>;
export default async function LegacyPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  redirect(routes.admin.users(await searchParams));
}
