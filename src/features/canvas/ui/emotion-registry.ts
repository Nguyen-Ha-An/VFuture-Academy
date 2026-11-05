import createCache from '@emotion/cache';

export type CanvasStyle = { name: string; isGlobal: boolean; css: string };

/** A navigation may deliver a new request nonce while the document keeps its original CSP. */
export function canvasDocumentNonce(requestNonce?: string): string | undefined {
  if (typeof document === 'undefined') return requestNonce;
  return document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce || requestNonce;
}

/** One cache per mounted registry/request. Keep CSS out of streamed component siblings. */
export function createCanvasEmotionRegistry(requestNonce?: string) {
  const nonce = canvasDocumentNonce(requestNonce);
  const cache = createCache({ key: 'academy-instui', nonce });
  cache.compat = true;
  const insert = cache.insert;
  let pending: CanvasStyle[] = [];
  cache.insert = (...args) => {
    const [selector, serialized] = args;
    const fresh = cache.inserted[serialized.name] === undefined;
    const result = insert(...args);
    const css = cache.inserted[serialized.name];
    // Browser insertion stores true and writes through Emotion's ordinary nonce-aware
    // sheet. Only SSR compat insertion stores CSS that Next must flush into the head.
    if (fresh && typeof css === 'string') pending.push({ name: serialized.name, isGlobal: !selector, css });
    return result;
  };
  return {
    cache,
    nonce,
    flush() {
      const styles = pending;
      pending = [];
      return styles;
    },
  };
}
