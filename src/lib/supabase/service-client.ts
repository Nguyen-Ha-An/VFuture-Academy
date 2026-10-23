import { createClient } from '@supabase/supabase-js';

/**
 * Creates a trusted Supabase client without importing Next's server-only guard.
 * Never import this module from client code: the caller supplies a service-role secret.
 */
export function createServiceClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
