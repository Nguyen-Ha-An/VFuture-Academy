import type { AnchorHTMLAttributes, ReactNode } from 'react';
// Emulate Next client navigation only. No focus, scroll, or source behavior is supplied here.
export default function Link({ href, children, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) {
 return <a href={href} {...props} onClick={event=>{
  onClick?.(event);
  if(event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target || props.download) return;
  const url = new URL(href, location.href);
  if(url.origin!==location.origin) return;
  event.preventDefault(); history.pushState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate'));
 }}>{children}</a>;
}
