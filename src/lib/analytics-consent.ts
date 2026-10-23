export const ANALYTICS_CONSENT_COOKIE = 'vf_analytics_consent';
export const ANALYTICS_CONSENT_VERSION = 'v1';
export const ANALYTICS_CONSENT_MAX_AGE = 180 * 24 * 60 * 60;
export type AnalyticsConsent = 'unknown' | 'granted' | 'denied';

/** Missing, duplicate, malformed and old-version preferences all fail closed. */
export function readAnalyticsConsent(cookieHeader: string | null | undefined): AnalyticsConsent {
  const values = (cookieHeader ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${ANALYTICS_CONSENT_COOKIE}=`))
    .map((part) => part.slice(ANALYTICS_CONSENT_COOKIE.length + 1));
  if (values.length !== 1) return 'unknown';
  if (values[0] === `${ANALYTICS_CONSENT_VERSION}.granted`) return 'granted';
  if (values[0] === `${ANALYTICS_CONSENT_VERSION}.denied`) return 'denied';
  return 'unknown';
}
