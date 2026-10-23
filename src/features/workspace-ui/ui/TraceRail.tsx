'use client';

import { useTranslations } from 'next-intl';
import { useState, type KeyboardEvent, type PointerEvent } from 'react';

export type TraceDay = { date: string; value: number; readout: string; beforeStart?: boolean };
export type TraceEvent = { dayIndex: number; label: string; tone?: 'signal' | 'pending' };

const W = 1000;
const H = 100;
const BASE = H - 18;

/**
 * The 1px activity waveform (DESIGN.md "Trace Rail"). Static at rest; pointer, tap or
 * arrow keys pin a crosshair with a mono readout. The visual is aria-hidden; `summary`
 * carries the same information for screen readers.
 */
export function TraceRail({ days, events = [], kind = 'learner', title, emptyLabel, summary, size = 'default' }: { days: TraceDay[]; events?: TraceEvent[]; kind?: 'learner' | 'staff'; title?: string; emptyLabel?: string; summary?: string; size?: 'default' | 'compact' }) {
  const t = useTranslations('bench.shared');
  const [active, setActive] = useState<number | null>(null);
  title ??= t(kind === 'staff' ? 'traceStaff' : 'traceLearner');
  emptyLabel ??= t(kind === 'staff' ? 'noGrades' : 'noReadings');
  summary ??= events.length ? t('traceSummary', { events: events.slice(-3).map(event => event.label).join('; ') }) : t('traceSummaryEmpty');
  const relativeDayLabel = (daysAgo: number) => daysAgo === 0 ? t('today') : t('daysAgo', { count: daysAgo });
  const count = days.length;
  const max = Math.max(1, ...days.map(day => day.value));
  const empty = days.every(day => day.value === 0) && events.length === 0;
  const x = (index: number) => count <= 1 ? 0 : (index / (count - 1)) * W;
  const y = (value: number) => BASE - (value / max) * (BASE - 16);
  const measured = days.map((day, index) => ({ ...day, index })).filter(day => !day.beforeStart);
  const firstMeasured = measured[0]?.index ?? 0;
  const path = measured.map(day => `${x(day.index).toFixed(1)},${y(day.value).toFixed(1)}`).join(' L');
  const pinFrom = (clientX: number, rect: DOMRect) => setActive(Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * (count - 1)));
  const onPointer = (event: PointerEvent<HTMLDivElement>) => pinFrom(event.clientX, event.currentTarget.getBoundingClientRect());
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); setActive(current => current === null ? count - 1 : Math.max(0, current - 1)); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); setActive(current => current === null ? count - 1 : Math.min(count - 1, current + 1)); }
    else if (event.key === 'Escape') setActive(null);
  };
  const activeDay = active === null ? null : days[active];
  const activeEvent = active === null ? undefined : events.find(event => event.dayIndex === active);
  const left = active === null ? 0 : (active / Math.max(1, count - 1)) * 100;
  return <div className="vf-trace" data-size={size === 'compact' ? 'compact' : undefined} tabIndex={0} role="group" aria-label={title}
    onPointerMove={event => { if (event.pointerType === 'mouse') onPointer(event); }} onPointerDown={onPointer} onPointerLeave={event => { if (event.pointerType === 'mouse') setActive(null); }} onKeyDown={onKey} onBlur={() => setActive(null)}>
    <span className="sr-only">{summary}</span>
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {firstMeasured > 0 ? <line className="vf-wave-pre" x1={0} x2={x(firstMeasured)} y1={BASE} y2={BASE} /> : null}
      <line className="vf-base" x1={x(firstMeasured)} x2={W} y1={BASE} y2={BASE} />
      {!empty && path ? <><path className="vf-wave-area" d={`M${path} L${x(measured[measured.length - 1].index)},${BASE} L${x(firstMeasured)},${BASE} Z`} /><path className="vf-wave" d={`M${path}`} /></> : null}
      {events.map(event => <rect key={`${event.dayIndex}:${event.label}`} className="vf-event" data-tone={event.tone} x={x(event.dayIndex) - 4} y={12} width={8} height={8} />)}
    </svg>
    <span className="vf-trace-label vf-kicker" data-tone="muted" aria-hidden="true">{title}</span>
    {empty ? <span className="vf-trace-note vf-meta" aria-hidden="true">{emptyLabel}</span> : null}
    {activeDay ? <>
      <span className="vf-trace-cross" style={{ left: `${left}%` }} aria-hidden="true" />
      <span className="vf-trace-readout" aria-live="polite" style={{ left: `${left}%`, transform: left > 70 ? 'translate(calc(-100% - 10px), -50%)' : 'translate(10px, -50%)' }}>
        {relativeDayLabel(count - 1 - (active ?? 0))} · {activeEvent ? activeEvent.label : activeDay.readout}
      </span>
    </> : null}
  </div>;
}
