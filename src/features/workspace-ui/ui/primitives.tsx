import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { BenchState } from './BenchState';

export type Tone = 'signal' | 'pending' | 'fault' | 'neutral';

/** The VFuture symbol, drawn square and currentColor for the bench bar and console. */
export function BrandMark({ className }: { className?: string }) {
  return <svg className={cn('vf-brand-mark', className)} viewBox="0 0 126 125" aria-hidden="true" focusable="false"><path d="M2 0H39V10H19L29 30H47V39H33L45 63L39 75Z" /><path d="M0 57L10 52L33 102L86 0H126L64 124L53 103L59 91L64 101L109 10H93L33 125Z" /></svg>;
}

export function Kicker({ children, tone, className, as: Tag = 'p' }: { children: ReactNode; tone?: 'muted'; className?: string; as?: 'p' | 'span' | 'div' }) {
  return <Tag className={cn('vf-kicker m-0', className)} data-tone={tone}>{children}</Tag>;
}

export function Meta({ children, className, as: Tag = 'p' }: { children: ReactNode; className?: string; as?: 'p' | 'span' | 'div' }) {
  return <Tag className={cn('vf-meta m-0', className)}>{children}</Tag>;
}

export function StateTag({ tone = 'neutral', plain, children }: { tone?: Tone; plain?: boolean; children: ReactNode }) {
  return <span className="vf-tag" data-tone={tone === 'neutral' ? undefined : tone} data-plain={plain || undefined}>{children}</span>;
}

const clamp = (value: number) => Math.max(0, Math.min(100, value));

/**
 * Progress as a target band, a fill and a marker. The band renders only when a real target
 * exists (DESIGN.md: no invented pace). `label` is the accessible reading with numbers.
 */
export function ToleranceBar({ value, band, tone, label, ticks }: { value: number; band?: readonly [number, number] | null; tone?: 'pending'; label: string; ticks?: boolean }) {
  const v = clamp(value);
  return <div className="vf-tol" role="img" aria-label={label} data-tone={tone}>
    {band ? <span className="vf-tol-band" style={{ left: `${clamp(band[0])}%`, width: `${clamp(band[1]) - clamp(band[0])}%` }} /> : null}
    <span className="vf-tol-fill" style={{ width: `${v}%` }} />
    {ticks ? <span className="vf-tol-ticks" /> : null}
    <span className="vf-tol-mark" style={{ left: `min(${v}%, calc(100% - 1px))` }} />
  </div>;
}

/** Level scale for skills: ticks per level plus a marker, never a tolerance band. */
export function LevelScale({ level, max = 5, label }: { level: number; max?: number; label: string }) {
  return <ToleranceBar value={(Math.max(0, Math.min(max, level)) / max) * 100} label={label} ticks />;
}

export function Sparkline({ values, className, label }: { values: number[]; className?: string; label?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => `${((index / (values.length - 1)) * 100).toFixed(1)},${(26 - (value / max) * 22).toFixed(1)}`).join(' ');
  return <svg className={cn('vf-spark', className)} viewBox="0 0 100 28" preserveAspectRatio="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}><polyline points={points} /></svg>;
}

export function ReadoutCell({ label, children, detail, className }: { label: string; children: ReactNode; detail?: ReactNode; className?: string }) {
  return <div className={cn('vf-readout-cell', className)}><span className="vf-kicker" data-tone="muted">{label}</span>{children}{detail ? <span className="vf-meta">{detail}</span> : null}</div>;
}

export function Delta({ text, tone }: { text: string; tone: 'up' | 'down' | 'flat' | 'new' }) {
  return <span className={cn('vf-meta', tone === 'up' && 'vf-delta-up', tone === 'down' && 'vf-delta-down')}>{text}</span>;
}

export function MentorQuote({ author, meta, children }: { author: string; meta?: ReactNode; children: ReactNode }) {
  return <figure className="vf-mentor m-0"><figcaption className="grid content-start gap-1"><b className="font-medium">{author}</b>{meta ? <span className="vf-meta">{meta}</span> : null}</figcaption><blockquote>{children}</blockquote></figure>;
}

/** Empty list or section. A thin wrapper over BenchState that keeps `role=status`. */
export function EmptyBench({ kicker, title, description, action, headingLevel = 3 }: { kicker?: string; title: string; description?: string; action?: ReactNode; headingLevel?: 2 | 3 }) {
  return <BenchState kind="empty" role="status" kicker={kicker} title={title} titleAs={headingLevel === 2 ? 'h2' : 'h3'} body={description} actions={action} />;
}

/**
 * Hairline surface with an 8px radius (--vf-radius-card). Cards never nest: a card inside a card
 * renders flat (workspace.css). `flush` drops the padding for tables and hairline lists.
 */
export function Card({ as: Tag = 'section', title, titleId, headingLevel = 2, actions, flush, children, className, 'aria-label': ariaLabel }: { as?: 'section' | 'div' | 'article'; title?: ReactNode; titleId?: string; headingLevel?: 2 | 3; actions?: ReactNode; flush?: boolean; children: ReactNode; className?: string; 'aria-label'?: string }) {
  const generatedId = useId();
  const headingId = title ? titleId ?? `${generatedId}-title` : undefined;
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return <Tag className={cn('vf-card', className)} data-flush={flush || undefined} aria-label={ariaLabel} aria-labelledby={!ariaLabel && headingId ? headingId : undefined}>
    {title || actions ? <div className="vf-card-head">{title ? <Heading id={headingId} className="vf-h2">{title}</Heading> : null}{actions}</div> : null}
    {children}
  </Tag>;
}

export function Notice({ tone = 'signal', label, children, action }: { tone?: 'signal' | 'pending' | 'fault'; label: string; children: ReactNode; action?: ReactNode }) {
  return <div className="vf-notice" data-tone={tone} role={tone === 'fault' ? 'alert' : 'status'}><span className="vf-kicker">{label}</span><div className="min-w-0">{children}</div>{action ?? <span />}</div>;
}

/** Static hairline skeleton: rules where content will be, mono dashes for values, no shimmer. */
export function BenchSkeleton({ rows = 3, label, sweep }: { rows?: number; label: string; sweep?: boolean }) {
  return <div role="status" aria-live="polite" aria-busy="true" className={cn('grid gap-4 py-2', sweep && 'vf-sweep')}>
    <span className="sr-only">{label}</span>
    <span className="vf-skel w-1/3" aria-hidden="true" />
    {Array.from({ length: rows }, (_, index) => <div key={index} className="grid gap-3" aria-hidden="true"><div className="flex items-center justify-between gap-4"><span className="vf-skel w-1/2" /><span className="vf-meta">—</span></div><span className="vf-skel-line" /></div>)}
  </div>;
}
