/** Entra uses this directory default when a name was not collected. */
export function isMissingProfileName(value: unknown): boolean {
  return typeof value !== 'string' || !value.trim() || value.trim().toLowerCase() === 'unknown';
}

/** Call only with provider claims already verified by the authentication flow. */
export function identityDisplayName(claims: Record<string, unknown>): string {
  const text = (value: unknown) => !isMissingProfileName(value) && typeof value === 'string' ? value.trim() : '';
  const name = text(claims.name);
  const fullName = name || [text(claims.given_name), text(claims.family_name)].filter(Boolean).join(' ');
  return fullName.slice(0, 160);
}
