import { academyBackend } from '@/lib/identity/provider';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  if (academyBackend() !== 'azure') return (await import('@/lib/identity/legacy-popup')).legacyPopupLogin(request);
  return (await import('@/lib/identity/routes')).azureLogin(request);
}
