'use client';

import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env-client';

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

/** Browser client uses only publishable configuration and cookie-backed auth. */
export function supabaseBrowser() {
  browserClient ??= createBrowserClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return browserClient;
}
