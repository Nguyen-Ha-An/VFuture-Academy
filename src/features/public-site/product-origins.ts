/** Public cross-product origins are deployment configuration, never source dependencies. */
export const CENTRAL_URL = process.env.NEXT_PUBLIC_CENTRAL_URL?.replace(/\/$/, '') || null;
export const COMPETITION_URL = process.env.NEXT_PUBLIC_COMPETITION_URL?.replace(/\/$/, '') || null;
