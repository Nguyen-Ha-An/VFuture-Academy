import type { SupabaseClient, User } from '@supabase/supabase-js';

/** The Azure data transport must never fall through to a Supabase Auth endpoint. */
export function azureAuthFacade(database: SupabaseClient, currentUser: () => Promise<User | null> = async () => null): SupabaseClient['auth'] {
  const unsupported = async () => ({ data: null, error: { message: 'This operation requires the configured Azure identity provider', status: 501 } });
  const admin = new Proxy({
    getUserById: async (id: string) => {
      const { data, error } = await database.rpc('academy_identity_get_user', { p_id: id });
      return error ? { data: { user: null }, error } : data ? { data: { user: data as User }, error: null } : { data: { user: null }, error: { message: 'User not found', status: 404 } };
    },
    oauth: new Proxy({}, { get: () => unsupported }),
  }, { get(target, property) { return Reflect.get(target, property) ?? unsupported; } });
  return new Proxy({
    getUser: async (token?: string) => token ? { data: { user: null }, error: { message: 'Provider tokens must be verified through Azure identity', status: 401 } } : { data: { user: await currentUser() }, error: null },
    admin,
  }, { get(target, property) { return Reflect.get(target, property) ?? unsupported; } }) as unknown as SupabaseClient['auth'];
}
