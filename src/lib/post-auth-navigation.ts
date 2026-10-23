/** Discard prefetched anonymous pages after a session or profile changes. */
export function navigateAfterAuth(destination: string): void {
  window.location.replace(destination);
}
