'use client';

import { useState } from 'react';
import type { VideoBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { asText } from '../text';
import { engineStrings, tr } from '../strings';

export function youtubeEmbedUrl(url: string): string | null {
  try { const u = new URL(url); const id = u.hostname === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v') ?? (u.pathname.startsWith('/embed/') ? u.pathname.split('/')[2] : null); return id && /^[\w-]{3,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null; } catch { return null; }
}
export function vimeoEmbedUrl(url: string): string | null {
  try { const u = new URL(url); const id = u.pathname.split('/').find((p) => /^\d{5,}$/.test(p)); return id ? `https://player.vimeo.com/video/${id}` : null; } catch { return null; }
}

export function Video({ block, runtime }: BlockRendererProps<VideoBlock>) {
  const [failed, setFailed] = useState(false);
  const captionText = block.caption ? asText(block.caption) : null;
  const caption = captionText ? <figcaption className="mt-2 text-center text-sm text-muted-foreground">{captionText}</figcaption> : null;
  if (block.provider) {
    const src = block.provider === 'youtube' ? youtubeEmbedUrl(block.url) : vimeoEmbedUrl(block.url);
    if (!src) return <p role="note" className="text-sm text-destructive">{tr(runtime.locale, engineStrings.video.invalid)}</p>;
    const providerName = block.provider === 'youtube' ? 'YouTube' : 'Vimeo';
    const frameTitle = captionText ? `${providerName}: ${captionText}` : `${providerName} video`;
    const watchLabel = runtime.locale === 'vi' ? `Xem trên ${providerName}` : `Watch on ${providerName}`;
    const unavailable = runtime.locale === 'vi' ? 'Không thể hiển thị video nhúng này.' : 'This embedded video is unavailable.';
    return <figure><div className="aspect-video w-full overflow-hidden rounded-md bg-black">{failed ? <div role="status" className="grid h-full place-items-center bg-muted p-6 text-center text-sm text-muted-foreground">{unavailable}</div> : <iframe title={frameTitle} src={src} onError={() => setFailed(true)} className="h-full w-full" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" loading="lazy" />}</div>{caption}<p className="mt-2 text-center text-sm"><a href={block.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{watchLabel}</a></p></figure>;
  }
  const unavailable = runtime.locale === 'vi' ? 'Không thể tải video này.' : 'This video is unavailable.';
  return <figure><div className="aspect-video w-full overflow-hidden rounded-md bg-black">{failed ? <div role="status" className="grid h-full place-items-center bg-muted p-6 text-center text-sm text-muted-foreground">{unavailable}</div> : <video controls preload="metadata" src={runtime.resolveMedia(block.src)} poster={block.poster ? runtime.resolveMedia(block.poster) : undefined} onError={() => setFailed(true)} className="h-full w-full rounded-md bg-black object-contain" />}</div>{caption}</figure>;
}
