import { NextResponse } from 'next/server';
import { withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

const readSession = withHandler(async () => {
  const user = await requireApiUser();
  return NextResponse.json({ userId: user.id });
});
/** Only an authenticated actor identifier, for cross-tab staff session checks. */
export async function GET(request: Request) {
  const response = await readSession(request);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
