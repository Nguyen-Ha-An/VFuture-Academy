import { createClient } from '@supabase/supabase-js';
import { gatewayClientOptions } from '../backend-gateway';

/**
 * Creates a trusted Supabase client without importing Next's server-only guard.
 * Never import this module from client code: the caller supplies a service-role secret.
 * When SUPABASE_GATEWAY_KEY is set (self-hosted gateway) it is sent as a header; scripts
 * and the application both pick it up from process.env, and unset changes nothing.
 */
export function createServiceClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    ...gatewayClientOptions(process.env, url),
  });
}
