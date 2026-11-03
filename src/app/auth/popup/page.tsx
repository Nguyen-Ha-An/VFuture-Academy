import { AuthPopupCompletion } from '@/components/AuthPopupCompletion';
import { POPUP_ATTEMPT_PATTERN } from '@/lib/identity/popup-contract';
export const dynamic = 'force-dynamic';
export default async function PopupCompletionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const attempt = typeof params.attempt === 'string' && POPUP_ATTEMPT_PATTERN.test(params.attempt) ? params.attempt : null;
  return <main className="flex min-h-screen items-center justify-center p-6"><AuthPopupCompletion attempt={attempt} status={attempt && params.status === 'success' ? 'success' : 'error'} /></main>;
}
