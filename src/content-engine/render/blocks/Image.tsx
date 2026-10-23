'use client';

import { useState } from 'react';
import type { ImageBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { asText } from '../text';
const widths = { sm: 'max-w-sm', md: 'max-w-2xl', full: 'w-full' } as const;
export function Image({ block, runtime }: BlockRendererProps<ImageBlock>) {
  const [failed, setFailed] = useState(false);
  const alt = asText(block.alt);
  const unavailable = runtime.locale === 'vi' ? 'Không thể tải hình ảnh này.' : 'This image is unavailable.';
  return (
    <figure className={`mx-auto ${widths[block.width ?? 'md']}`}>
      {failed ? <div role="img" aria-label={`${alt}. ${unavailable}`} className="grid aspect-video w-full place-items-center rounded-md border border-border bg-muted p-6 text-center text-sm text-muted-foreground"><span>{unavailable}</span></div> : <><img /* eslint-disable-line @next/next/no-img-element -- engine is framework-free */ src={runtime.resolveMedia(block.src)} alt={alt} loading="lazy" onError={() => setFailed(true)} className="h-auto min-h-40 w-full rounded-md bg-muted object-contain" /></>}
      {block.caption ? <figcaption className="mt-2 text-center text-sm text-muted-foreground">{asText(block.caption)}</figcaption> : null}
    </figure>
  );
}
