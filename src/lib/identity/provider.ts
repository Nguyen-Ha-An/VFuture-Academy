type EnvironmentSource = Readonly<Record<string, string | undefined>>;
/** Both build-time browser and server selectors must agree before Azure can serve traffic. */
export function academyBackend(source: EnvironmentSource = process.env): 'azure' | 'supabase' {
  const server = source.ACADEMY_BACKEND || 'supabase';
  const browser = source.NEXT_PUBLIC_ACADEMY_BACKEND || 'supabase';
  if (!['supabase', 'azure'].includes(server) || server !== browser) throw new Error('Academy backend selectors must agree');
  return server as 'azure' | 'supabase';
}
export function azureBrowserIdentityEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ACADEMY_BACKEND === 'azure';
}
