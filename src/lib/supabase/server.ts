import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import { gatewayClientOptions } from '@/lib/backend-gateway';
import { createServiceClient } from '@/lib/supabase/service-client';

/**
 * Returns a request-scoped client bound to the user's Supabase auth cookies.
 * Queries made through it are subject to the database's RLS policies.
 */
export async function supabaseUser() {
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot mutate response cookies. A future proxy
          // refreshes sessions for those render-only request paths.
        }
      },
    },
    ...gatewayClientOptions(process.env, env.NEXT_PUBLIC_SUPABASE_URL),
  });
}

/** Server-only client for trusted administration jobs; it bypasses RLS. */
export function supabaseService() {
  return createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}
