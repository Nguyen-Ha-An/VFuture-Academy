import { academyBackend } from '../identity/provider';
import { createClient } from '@supabase/supabase-js';
import { gatewayClientOptions } from '../backend-gateway';
import { createAzureDataClient } from '../database/azure-client';
import { azureAuthFacade } from '../database/auth-facade';
import { createRetainedStorage, withVerifiedInventory } from '../storage/retained-storage';

/**
 * Creates a trusted Supabase client without importing Next's server-only guard.
 * Never import this module from client code: the caller supplies a service-role secret.
 * When SUPABASE_GATEWAY_KEY is set (self-hosted gateway) it is sent as a header; scripts
 * and the application both pick it up from process.env, and unset changes nothing.
 */
export function createServiceClient(url: string, serviceRoleKey: string) {
  if (academyBackend() === 'azure') {
    const database = createAzureDataClient('service_role');
    Object.defineProperty(database, 'auth', { value: azureAuthFacade(database) });
    Object.defineProperty(database, 'storage', { value: withVerifiedInventory(createRetainedStorage(), database) });
    return database;
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    ...gatewayClientOptions(process.env, url),
  });
}
