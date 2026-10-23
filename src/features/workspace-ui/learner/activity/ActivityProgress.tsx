'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { StateTag, ToleranceBar } from '../../ui/primitives';
import { activityStatus, activityStatusTag, type ActivityStatus } from './status';

export type ActivityProgressValue = { completed: number; total: number };

type ActivityContextValue = {
  value: ActivityProgressValue;
  status: ActivityStatus;
  /** True while an exam attempt runs: the pager hides and leaving goes through the exam guard. */
  locked: boolean;
  report(next: ActivityProgressValue, status?: ActivityStatus): void;
  setLocked(locked: boolean): void;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);

/**
 * Client state for a server-rendered activity frame: the player reports completion here so the
 * focus bar readout and the head state tag update without a refresh.
 */
export function ActivityProgressProvider({ initial, status, children }: { initial: ActivityProgressValue; status?: string; children: ReactNode }) {
  const [value, setValue] = useState(initial);
  const [current, setCurrent] = useState<ActivityStatus>(() => activityStatus(status));
  const [locked, setLocked] = useState(false);
  const report = useCallback((next: ActivityProgressValue, nextStatus?: ActivityStatus) => {
    setValue(next);
    if (nextStatus) setCurrent(nextStatus);
  }, []);
  const context = useMemo(() => ({ value, status: current, locked, report, setLocked }), [value, current, locked, report]);
  return <ActivityContext.Provider value={context}>{children}</ActivityContext.Provider>;
}

/** Null outside an activity frame; the player then keeps its own inline progress card. */
export function useActivityProgress(): Pick<ActivityContextValue, 'value' | 'status' | 'report'> | null {
  return useContext(ActivityContext);
}

/** Locks the frame while `locked` is true (an active exam attempt) and releases it on unmount. */
export function useActivityLock(locked: boolean) {
  const setLocked = useContext(ActivityContext)?.setLocked;
  useEffect(() => {
    if (!setLocked) return;
    setLocked(locked);
    return () => setLocked(false);
  }, [locked, setLocked]);
}

export function useActivityLocked(): boolean {
  return useContext(ActivityContext)?.locked ?? false;
}

/** Course progress for the focus bar: an accessible progressbar over a decorative tolerance bar. */
export function ActivityProgressReadout({ fallback }: { fallback?: ActivityProgressValue }) {
  const t = useTranslations('bench.learner.activity');
  const value = useContext(ActivityContext)?.value ?? fallback;
  if (!value) return null;
  const text = t('progress', value);
  return <div className="vf-focus-progress" role="progressbar" aria-label={text} aria-valuemin={0} aria-valuemax={value.total} aria-valuenow={value.completed} aria-valuetext={text}>
    <div aria-hidden="true"><ToleranceBar value={value.total ? (value.completed / value.total) * 100 : 0} label="" /></div>
    <span className="vf-meta" aria-hidden="true">{value.completed}/{value.total}</span>
  </div>;
}

/** The head's state tag; follows completion reported by the player. */
export function ActivityStatusTag({ initial }: { initial: string }) {
  const t = useTranslations('bench.learner.activity.state');
  const status = useContext(ActivityContext)?.status ?? activityStatus(initial);
  const tag = activityStatusTag(status);
  return <StateTag tone={tag.tone}>{t(tag.key)}</StateTag>;
}
