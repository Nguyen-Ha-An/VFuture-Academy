export type StudioTimingName =
  | 'studio.workspace.analysis'
  | 'studio.workspace.save.prepare'
  | 'studio.workspace.save.request'
  | 'studio.workspace.save.reconcile'
  | 'studio.workspace.preview.prepare'
  | 'studio.workspace.preview.request';

/** Records duration only. Metric names are fixed and author content is never attached. */
export function recordStudioTiming(name: StudioTimingName, start: number, end = performance.now()): void {
  try {
    performance.measure(name, { start, end });
  } catch {
    // Metrics must never interfere with editing in browsers lacking measure options.
  }
}

export function measureStudioOperation<T>(name: StudioTimingName, operation: () => T): T {
  const start = performance.now();
  try { return operation(); }
  finally { recordStudioTiming(name, start); }
}

export function startStudioTiming(name: StudioTimingName): () => void {
  const start = performance.now();
  return () => recordStudioTiming(name, start);
}
