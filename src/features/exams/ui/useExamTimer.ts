'use client';

import { useEffect, useRef, useState } from 'react';

interface TimerAnnouncements {
  fiveMinutes: string;
  oneMinute: string;
  expired: string;
}

interface UseExamTimerOptions {
  deadlineAt: Date | null;
  serverNow: () => Promise<Date>;
  onExpired: () => void | Promise<void>;
  announcements: TimerAnnouncements;
}

interface ClockAnchor {
  timeMs: number;
  monotonicMs: number;
}

const SYNC_TIMEOUT_MS = 5_000;
const RESYNC_INTERVAL_MS = 60_000;

export function useExamTimer({
  deadlineAt,
  serverNow,
  onExpired,
  announcements,
}: UseExamTimerOptions) {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;

  useEffect(() => {
    if (!deadlineAt) {
      setRemainingSeconds(null);
      setAnnouncement('');
      return;
    }

    let active = true;
    let authoritative = false;
    let hasServerAnchor = false;
    let syncGeneration = 0;
    let warning: 'five' | 'one' | 'expired' | null = null;
    let autoSubmitted = false;
    const deadlineMs = new Date(deadlineAt).getTime();
    let anchor: ClockAnchor = {
      timeMs: Date.now(),
      monotonicMs: performance.now(),
    };

    const estimatedNow = () => anchor.timeMs + (performance.now() - anchor.monotonicMs);
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadlineMs - estimatedNow()) / 1_000));
      setRemainingSeconds(remaining);
      if (!authoritative) return;
      if (remaining === 0) {
        if (warning !== 'expired') {
          warning = 'expired';
          setAnnouncement(announcements.expired);
        }
        if (!autoSubmitted) {
          autoSubmitted = true;
          void onExpiredRef.current();
        }
      } else if (remaining <= 60 && warning !== 'one') {
        warning = 'one';
        setAnnouncement(announcements.oneMinute);
      } else if (remaining <= 300 && warning === null) {
        warning = 'five';
        setAnnouncement(announcements.fiveMinutes);
      }
    };

    const synchronize = () => {
      const generation = ++syncGeneration;
      const requestWallMs = Date.now();
      const requestMonotonicMs = performance.now();
      void serverNow().then((serverDate) => {
        if (!active || generation !== syncGeneration) return;
        const responseMonotonicMs = performance.now();
        const roundTripMs = Math.max(0, responseMonotonicMs - requestMonotonicMs);
        const midpointWallMs = requestWallMs + (roundTripMs / 2);
        const offsetMs = serverDate.getTime() - midpointWallMs;
        const synchronizedNowMs = requestWallMs + roundTripMs + offsetMs;
        const currentEstimateMs = estimatedNow();
        anchor = {
          timeMs: hasServerAnchor
            ? Math.max(currentEstimateMs, synchronizedNowMs)
            : synchronizedNowMs,
          monotonicMs: responseMonotonicMs,
        };
        hasServerAnchor = true;
        authoritative = true;
        tick();
      }).catch(() => {
        if (!active || generation !== syncGeneration) return;
        authoritative = true;
        tick();
      });
    };

    tick();
    synchronize();
    const tickInterval = window.setInterval(tick, 1_000);
    const syncInterval = window.setInterval(synchronize, RESYNC_INTERVAL_MS);
    const syncTimeout = window.setTimeout(() => {
      authoritative = true;
      tick();
    }, SYNC_TIMEOUT_MS);

    return () => {
      active = false;
      window.clearInterval(tickInterval);
      window.clearInterval(syncInterval);
      window.clearTimeout(syncTimeout);
    };
  }, [announcements.expired, announcements.fiveMinutes, announcements.oneMinute, deadlineAt, serverNow]);

  return { announcement, remainingSeconds };
}
