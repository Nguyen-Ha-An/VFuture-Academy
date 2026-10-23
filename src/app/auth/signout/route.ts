import { NextResponse } from 'next/server';
import { supabaseUser } from '@/lib/supabase/server';
import { env } from '@/lib/env';

export async function POST(_request: Request) {
  const supabase = await supabaseUser();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', env.NEXT_PUBLIC_APP_URL), 303);
}
