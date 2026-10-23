import type { AnchorHTMLAttributes, ReactNode } from 'react';

/** Browser-harness stand-in for `next/link`: a plain anchor, minus the router-only props Next consumes. */
type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
  prefetch?: boolean | null;
  scroll?: boolean;
  replace?: boolean;
  shallow?: boolean;
};

export default function Link({ href, children, prefetch: _prefetch, scroll: _scroll, replace: _replace, shallow: _shallow, ...props }: LinkProps) {
  return <a href={href} {...props}>{children}</a>;
}
