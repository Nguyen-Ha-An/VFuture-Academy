export interface OriginRequestClient {
  get(url: string, options: {
    headers: Record<string, string>;
    maxRedirects: number;
  }): Promise<{ status(): number }>;
}

/** Exchanges a bypass header for a cookie in one exact-origin request. */
export async function bootstrapVercelProtection(
  request: OriginRequestClient,
  baseURL: string,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret) return false;
  const origin = new URL(baseURL);
  if (origin.protocol !== 'https:' || origin.username || origin.password
    || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Vercel protection bootstrap requires a credential-free HTTPS origin.');
  }
  const response = await request.get(`${origin.origin}/`, {
    headers: {
      'x-vercel-protection-bypass': secret,
      'x-vercel-set-bypass-cookie': 'true',
    },
    maxRedirects: 0,
  });
  const status = response.status();
  if (status < 200 || status >= 400) throw new Error('Vercel protection bootstrap failed.');
  return true;
}
