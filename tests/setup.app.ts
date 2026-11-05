import { afterAll, vi } from 'vitest';

afterAll(async () => {
  if (typeof document === 'undefined') return;
  // Radix schedules its final focus restoration at unmount. Let those callbacks
  // run before Vitest replaces jsdom's Event constructors with the Node realm.
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
  else await new Promise(resolve => setTimeout(resolve, 0));
});

// JSDOM omits this browser API; real resizing is exercised by the Chromium harnesses.
if (typeof document !== 'undefined' && typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
