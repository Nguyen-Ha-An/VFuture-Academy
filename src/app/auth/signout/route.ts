import { academyBackend } from '@/lib/identity/provider';
import { NextResponse } from 'next/server';
import { supabaseUser } from '@/lib/supabase/server';
import { env } from '@/lib/env';

export async function POST(request: Request) {
  if (academyBackend() === 'azure') return (await import('@/lib/identity/routes')).azureLogout(request);
  const supabase = await supabaseUser();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', env.NEXT_PUBLIC_APP_URL), 303);
}
