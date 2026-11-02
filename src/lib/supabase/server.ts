import 'server-only';
import { academyBackend } from '@/lib/identity/provider';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import { gatewayClientOptions } from '@/lib/backend-gateway';
import { createServiceClient } from '@/lib/supabase/service-client';
import { createAzureDataClient } from '@/lib/database/azure-client';
import { azureAuthFacade } from '@/lib/database/auth-facade';

/**
 * Returns a request-scoped client bound to the user's Supabase auth cookies.
 * Queries made through it are subject to the database's RLS policies.
 */
export async function supabaseUser() {
  if (academyBackend() === 'azure') {
    const { getAzureUser } = await import('@/lib/identity/server');
    const user = await getAzureUser();
    const database = createAzureDataClient('authenticated', user?.id);
    Object.defineProperty(database, 'auth', { value: azureAuthFacade(database, async () => user) });
    // User data clients do not receive Storage service credentials. Every private
    // object operation is authorized by the application and uses supabaseService.
    return database;
  }
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
  return academyBackend() === 'azure'
    ? createServiceClient('', '')
    : createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}
