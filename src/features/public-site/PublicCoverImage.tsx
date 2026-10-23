'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useLocale } from 'next-intl';
import './public-cover-image.css';

type PublicCoverImageProps = {
  src?: string;
  alt: string;
  width: number;
  height: number;
  sizes: string;
  unoptimized?: boolean;
  className?: string;
};

/** Published cover URLs stay intact; failed or 1px seed images receive a neutral fallback. */
export function PublicCoverImage({ src, alt, className, ...imageProps }: PublicCoverImageProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const locale = useLocale();
  if (!src || failedSource === src) {
    const unavailable = locale === 'en' ? 'Image unavailable' : 'Hình ảnh chưa khả dụng';
    return <div className={`public-cover-fallback ${className ?? ''}`.trim()} data-public-cover-fallback role={alt ? 'img' : undefined} aria-label={alt ? `${unavailable}: ${alt}` : undefined} aria-hidden={alt ? undefined : true}>
      <div className="public-cover-fallback__study" aria-hidden="true"><span /><span /><span /><span /><span /></div>
      <span className="public-cover-fallback__brand" aria-hidden="true">VFuture Academy</span>
    </div>;
  }
  return <Image {...imageProps} src={src} alt={alt} className={className} onError={() => setFailedSource(src)} onLoad={event => {
    if (event.currentTarget.naturalWidth < 2 || event.currentTarget.naturalHeight < 2) setFailedSource(src);
  }} />;
}
