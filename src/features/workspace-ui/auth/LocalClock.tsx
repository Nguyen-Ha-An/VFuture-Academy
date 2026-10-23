'use client';

import { useEffect, useState } from 'react';

const ictClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export function formatIctClock(date: Date) {
  return ictClock.format(date);
}

/** Bench-panel wall clock in Vietnam time. Not a live region: it ticks silently for screen readers. */
export function LocalClock() {
  const [now, setNow] = useState(() => formatIctClock(new Date()));
  useEffect(() => {
    const tick = () => setNow(formatIctClock(new Date()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <time className="vf-mono" suppressHydrationWarning>{now}</time>;
}
