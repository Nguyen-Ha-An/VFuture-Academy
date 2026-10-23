import type { CSSProperties, ImgHTMLAttributes } from 'react';

/** Browser-harness stand-in for `next/image`: a plain <img>, with `fill` laid out as Next does. */
type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | { src: string };
  fill?: boolean;
  unoptimized?: boolean;
  priority?: boolean;
  quality?: number;
  placeholder?: string;
  blurDataURL?: string;
};

export default function Image({ src, fill, unoptimized: _unoptimized, priority: _priority, quality: _quality, placeholder: _placeholder, blurDataURL: _blur, style, alt, ...props }: ImageProps) {
  const fillStyle: CSSProperties | undefined = fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%' } : undefined;
  // eslint-disable-next-line @next/next/no-img-element -- harness stand-in for next/image itself
  return <img src={typeof src === 'string' ? src : src.src} alt={alt} style={{ ...fillStyle, ...style }} {...props} />;
}
