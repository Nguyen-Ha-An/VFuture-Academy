/** Category prefixes are managed by identity provisioning, never by role grants. */
export const PROFILE_HANDLE_PATTERN = /^(STU|VFU)-[a-z0-9][a-z0-9_-]{2,31}$/;
export const PROFILE_HANDLE_SUFFIX_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/;
/** Legacy URLs remain resolvable through the private alias projection. */
export const PROFILE_LOOKUP_PATTERN = /^(?:(STU|VFU)-)?[a-z0-9][a-z0-9_-]{2,31}$/;
export function handlePrefix(handle: string | null): 'STU-' | 'VFU-' {
  return handle?.startsWith('VFU-') ? 'VFU-' : 'STU-';
}
export function handleSuffix(handle: string | null): string {
  return handle?.replace(/^(STU|VFU)-/, '') ?? '';
}
