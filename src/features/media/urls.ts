/** Returns the authenticated application URL for a private media asset. */
export function mediaHref(assetId: string): string {
  return `/api/v1/media/${encodeURIComponent(assetId)}`;
}

/** URL for assets proven to be referenced by an anonymous public projection. */
export function publicMediaHref(assetId: string): string {
  return `/api/v1/public/media/${encodeURIComponent(assetId)}`;
}
