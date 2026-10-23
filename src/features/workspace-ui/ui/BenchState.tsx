import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type BenchStateKind = 'empty' | 'filtered' | 'not-found' | 'fault';

export type BenchStateProps = {
  kind: BenchStateKind;
  kicker?: ReactNode;
  title: ReactNode;
  titleAs?: 'h1' | 'h2' | 'h3';
  titleId?: string;
  body?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** Live-region role. Empty and filtered states default to `status`; page states have none. */
  role?: 'status' | 'alert';
  className?: string;
};

/**
 * One anatomy for empty, filtered, not-found and fault states: kicker, title, body, mono meta and
 * actions. Empty and filtered states sit on the signal grid (DESIGN: grid only on login and
 * empty states); fault takes the fault rule; not-found is a plain hairline panel.
 */
export function BenchState({ kind, kicker, title, titleAs = 'h3', titleId, body, meta, actions, role, className }: BenchStateProps) {
  const Heading = titleAs;
  const isEmpty = kind === 'empty' || kind === 'filtered';
  const Root = titleAs === 'h1' ? 'section' : 'div';
  const liveRole = role ?? (isEmpty ? 'status' : undefined);
  return <Root
    className={cn(kind === 'fault' ? 'vf-l-fault' : 'vf-empty', isEmpty && 'vf-grid-bg', className)}
    data-kind={kind}
    role={liveRole}
    aria-labelledby={Root === 'section' && titleId ? titleId : undefined}
  >
    {kicker ? <span className="vf-kicker">{kicker}</span> : null}
    <Heading id={titleId} className={titleAs === 'h1' ? 'vf-title-sm' : 'vf-empty-title'}>{title}</Heading>
    {body ? typeof body === 'string' ? <p>{body}</p> : body : null}
    {meta ? <span className="vf-meta">{meta}</span> : null}
    {actions ? <div className="vf-state-actions">{actions}</div> : null}
  </Root>;
}

export type PageSkeletonVariant = 'home' | 'directory' | 'detail' | 'activity';

const Bar = ({ className }: { className: string }) => <span className={cn('vf-skel', className)} />;
const Dash = () => <span className="vf-meta">—</span>;

function SkeletonHead({ crumbs, lead = true }: { crumbs?: boolean; lead?: boolean }) {
  return <div className="vf-l-skel-head">
    {crumbs ? <Bar className="w-40" /> : null}
    <Bar className="w-28" />
    <Bar className="vf-l-skel-title w-2/3" />
    {lead ? <Bar className="w-1/2" /> : null}
  </div>;
}

function SkeletonRows({ rows }: { rows: number }) {
  return <div className="vf-l-skel-rows">
    {Array.from({ length: rows }, (_, index) => <div key={index} className="vf-l-skel-row"><Bar className="w-12" /><span className="grid gap-2"><Bar className="w-2/3" /><Bar className="w-1/3" /></span><Dash /></div>)}
  </div>;
}

function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return <div className="vf-l-skel-card">
    <Bar className="w-1/3" />
    {Array.from({ length: lines }, (_, index) => <span key={index} className="vf-skel-line" />)}
    <Bar className="w-1/2" />
  </div>;
}

function SkeletonLayout({ variant }: { variant: PageSkeletonVariant }) {
  if (variant === 'home') return <>
    <div className="vf-l-skel-card vf-l-skel-anchor"><Bar className="w-28" /><Bar className="vf-l-skel-title w-1/2" /><Bar className="w-2/5" /><span className="vf-skel-line" /></div>
    <div className="vf-l-skel-readout">{Array.from({ length: 4 }, (_, index) => <div key={index}><Bar className="w-2/3" /><Dash /></div>)}</div>
    <SkeletonRows rows={3} />
  </>;
  if (variant === 'directory') return <>
    <SkeletonHead />
    <div className="vf-l-skel-controls">{Array.from({ length: 4 }, (_, index) => <span key={index} className="vf-l-skel-control" />)}</div>
    <Bar className="w-24" />
    <SkeletonRows rows={5} />
  </>;
  if (variant === 'detail') return <>
    <SkeletonHead crumbs />
    <div className="vf-l-split" data-aside="">
      <div className="grid gap-6" data-area="main"><SkeletonCard lines={4} /><SkeletonCard /></div>
      <div data-area="aside"><SkeletonCard lines={2} /></div>
    </div>
  </>;
  return <div className="vf-l-skel-reading">
    <SkeletonHead lead={false} />
    {Array.from({ length: 6 }, (_, index) => <Bar key={index} className={index % 3 === 2 ? 'w-3/5' : 'w-full'} />)}
    <SkeletonCard lines={2} />
  </div>;
}

/**
 * Route loading state: a static hairline skeleton that mirrors the final layout, with mono dashes
 * where values will be. No shimmer and no motion (spec 4.12).
 */
export function PageSkeleton({ variant, label }: { variant: PageSkeletonVariant; label: string }) {
  return <div role="status" aria-live="polite" aria-busy="true" className="vf-l-skeleton" data-variant={variant}>
    <span className="sr-only">{label}</span>
    <div className="vf-l-skeleton-body" aria-hidden="true"><SkeletonLayout variant={variant} /></div>
  </div>;
}
