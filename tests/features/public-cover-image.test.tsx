// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ImgHTMLAttributes } from 'react';

vi.mock('next/image', () => ({
  default: ({ unoptimized, ...props }: ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => createElement('img', { ...props, 'data-unoptimized': String(unoptimized) }),
}));

import { PublicCoverImage } from '@/features/public-site/PublicCoverImage';

const props = { src: '/api/v1/public/media/cover-one', alt: '', width: 960, height: 540, sizes: '(min-width: 768px) 46vw, 92vw', unoptimized: true };
const image = (src = props.src) => <NextIntlClientProvider locale="en" messages={{}}><PublicCoverImage {...props} src={src} /></NextIntlClientProvider>;

afterEach(cleanup);

describe('public cover image', () => {
  it('preserves public signed-media routing, responsive sizes and valid decoded covers', () => {
    const { container } = render(image());
    const cover = container.querySelector('img')!;
    Object.defineProperties(cover, { naturalWidth: { value: 960 }, naturalHeight: { value: 540 } });
    fireEvent.load(cover);
    expect(cover.getAttribute('src')).toBe(props.src);
    expect(cover.getAttribute('sizes')).toBe(props.sizes);
    expect(cover.getAttribute('data-unoptimized')).toBe('true');
    expect(container.querySelector('[data-public-cover-fallback]')).toBeNull();
  });

  it.each(['error', 'degenerate'] as const)('uses a neutral branded fallback for %s images', condition => {
    const { container } = render(image());
    const cover = container.querySelector('img')!;
    if (condition === 'error') fireEvent.error(cover);
    else {
      Object.defineProperties(cover, { naturalWidth: { value: 1 }, naturalHeight: { value: 1 } });
      fireEvent.load(cover);
    }
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-public-cover-fallback]')?.textContent).toContain('VFuture Academy');
    expect(container.querySelector('[data-public-cover-fallback]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('tries a new source after the previous image fails', () => {
    const { container, rerender } = render(image());
    fireEvent.error(container.querySelector('img')!);
    rerender(image('/api/v1/public/media/cover-two'));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/v1/public/media/cover-two');
    expect(container.querySelector('[data-public-cover-fallback]')).toBeNull();
  });
});
