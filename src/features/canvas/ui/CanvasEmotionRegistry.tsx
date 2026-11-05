'use client';

import { useState, type ReactNode } from 'react';
import { useServerInsertedHTML } from 'next/navigation';
import { CacheProvider } from '@instructure/emotion';
import { createCanvasEmotionRegistry } from './emotion-registry';

/** Next flushes each streamed segment's Emotion rules ahead of the content using them.
 * https://nextjs.org/docs/app/guides/css-in-js
 * https://v7.mui.com/joy-ui/integrations/next-js-app-router/
 */
export function CanvasEmotionRegistry({ children, nonce }: { children: ReactNode; nonce?: string }) {
  const [registry] = useState(() => createCanvasEmotionRegistry(nonce));
  useServerInsertedHTML(() => {
    const inserted = registry.flush();
    if (!inserted.length) return null;
    const globals = inserted.filter(style => style.isGlobal);
    const ordinary = inserted.filter(style => !style.isGlobal);
    return <>
      {globals.map(style => <style
        key={style.name}
        nonce={registry.nonce}
        data-emotion={`${registry.cache.key}-global ${style.name}`}
        dangerouslySetInnerHTML={{ __html: style.css }}
      />)}
      {ordinary.length > 0 ? <style
        nonce={registry.nonce}
        data-emotion={`${registry.cache.key} ${ordinary.map(style => style.name).join(' ')}`}
        dangerouslySetInnerHTML={{ __html: ordinary.map(style => style.css).join('') }}
      /> : null}
    </>;
  });
  return <CacheProvider value={registry.cache}>{children}</CacheProvider>;
}
