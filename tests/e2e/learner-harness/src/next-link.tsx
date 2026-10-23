import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { useRouter } from './next-navigation';

export default function Link({ href, children, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) {
  const router = useRouter();
  return <a href={href} {...props} onClick={(event) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || props.target === '_blank' || !href.startsWith('/') || href.includes('#')) return;
    event.preventDefault();
    router.push(href);
  }}>{children}</a>;
}
