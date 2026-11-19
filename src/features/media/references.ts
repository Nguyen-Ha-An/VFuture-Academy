/** Callers supply only a projection that this learner is authorized to receive. */
export function referencesAsset(value: unknown, assetId: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => referencesAsset(entry, assetId));
  if (!value || typeof value !== 'object') return false;
  const object = value as Record<string, unknown>;
  return object.assetId === assetId || Object.values(object).some((entry) => referencesAsset(entry, assetId));
}
