'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ExamEventInput } from '../types';
import type { ExamClient } from './client';
import type { LearnerExam } from './types';

interface UseIntegrityLogOptions {
  client: Pick<ExamClient, 'events'>;
  containerRef: RefObject<HTMLElement | null>;
  settings: LearnerExam['settings']['integrity'];
  submittingRef: RefObject<boolean>;
}

interface FlushCancellation {
  cancelled: boolean;
}

const NON_RETRYABLE_CODES = new Set(['ATTEMPT_NOT_ACTIVE', 'FORBIDDEN']);

function isNonRetryable(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
    && NON_RETRYABLE_CODES.has(error.code);
}

export function useIntegrityLog({
  client,
  containerRef,
  settings,
  submittingRef,
}: UseIntegrityLogOptions) {
  const [fullscreenRetry, setFullscreenRetry] = useState(false);
  const eventQueueRef = useRef<ExamEventInput[]>([]);
  const eventFlushRef = useRef<Promise<void>>(Promise.resolve());
  const stoppedRef = useRef(false);
  const mountedRef = useRef(true);
  const fullscreenActiveRef = useRef(false);

  const flushEvents = useCallback((options?: {
    force?: boolean;
    cancellation?: FlushCancellation;
  }): Promise<void> => {
    const flush = eventFlushRef.current.then(async () => {
      if (options?.cancellation?.cancelled) return;
      if (!options?.force && (stoppedRef.current || submittingRef.current)) return;
      const batch = eventQueueRef.current.splice(0);
      if (batch.length === 0) return;
      try {
        await client.events(batch);
      } catch (error) {
        if (!isNonRetryable(error) && mountedRef.current) {
          eventQueueRef.current.unshift(...batch);
        }
      }
    });
    eventFlushRef.current = flush;
    return flush;
  }, [client, submittingRef]);

  const flushBeforeSubmit = useCallback(async () => {
    stoppedRef.current = true;
    const cancellation: FlushCancellation = { cancelled: false };
    const flush = flushEvents({ force: true, cancellation });
    let completed = false;
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(() => {
        cancellation.cancelled = true;
        resolve();
      }, 500);
      void flush.finally(() => {
        completed = true;
        window.clearTimeout(timeout);
        resolve();
      });
    });
    if (!completed) cancellation.cancelled = true;
  }, [flushEvents]);

  const resume = useCallback(() => {
    stoppedRef.current = false;
  }, []);

  const requestFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!settings.requireFullscreen) return;
    if (!container?.requestFullscreen) {
      setFullscreenRetry(true);
      return;
    }
    setFullscreenRetry(false);
    try {
      await container.requestFullscreen();
      fullscreenActiveRef.current = true;
    } catch {
      fullscreenActiveRef.current = false;
      setFullscreenRetry(true);
    }
  }, [containerRef, settings.requireFullscreen]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    mountedRef.current = true;
    stoppedRef.current = false;
    const isSubmitting = () => submittingRef.current;
    const queue = (type: ExamEventInput['type'], meta?: Record<string, unknown>) => {
      if (stoppedRef.current || isSubmitting()) return;
      eventQueueRef.current.push({ type, at: new Date(), ...(meta ? { meta } : {}) });
    };
    const onVisibility = () => {
      if (settings.logFocusLoss && document.visibilityState === 'hidden') {
        queue('visibility_hidden');
      }
    };
    const onBlur = () => {
      if (settings.logFocusLoss) queue('focus_lost');
    };
    const onFocus = () => {
      if (settings.logFocusLoss) queue('focus_gained');
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!settings.logPaste) return;
      queue('paste', { characterCount: event.clipboardData?.getData('text').length ?? 0 });
    };
    const onFullscreenChange = () => {
      if (!settings.requireFullscreen) return;
      if (document.fullscreenElement === container) {
        fullscreenActiveRef.current = true;
        setFullscreenRetry(false);
      } else if (fullscreenActiveRef.current) {
        fullscreenActiveRef.current = false;
        setFullscreenRetry(true);
        queue('fullscreen_exit');
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    container.addEventListener('paste', onPaste);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    const interval = window.setInterval(() => void flushEvents(), 10_000);

    if (settings.requireFullscreen) void requestFullscreen();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      container.removeEventListener('paste', onPaste);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.clearInterval(interval);
      const flushOnUnmount = !isSubmitting() && !stoppedRef.current;
      mountedRef.current = false;
      stoppedRef.current = true;
      if (flushOnUnmount) void flushEvents({ force: true });
    };
  }, [containerRef, flushEvents, requestFullscreen, settings, submittingRef]);

  return {
    flushBeforeSubmit,
    fullscreenRetry,
    requestFullscreen,
    resume,
  };
}
