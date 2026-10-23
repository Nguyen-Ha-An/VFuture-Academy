export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (typeof v === 'object' && v !== null) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export async function sha256Hex(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const checksumOf = (v: unknown) => sha256Hex(stableStringify(v));
