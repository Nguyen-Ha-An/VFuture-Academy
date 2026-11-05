'use client';

import { Responsive } from '@instructure/ui-responsive/v11_7';

/**
 * InstUI 11.7.10 skips element measurements equal to the listener's initial width.
 * Renew that native listener outside ResizeObserver delivery, without remounting
 * children or changing native query matching. Media listeners remain unchanged.
 */
export class CanvasResponsive extends Responsive {
  override addMatchListener(...[query, updateMatches, match = this.props.match]: Parameters<Responsive['addMatchListener']>) {
    const element = this.ref;
    const ownerWindow = element?.ownerDocument.defaultView;
    if (match !== 'element' || !element || !ownerWindow) return super.addMatchListener(query, updateMatches, match);

    let initialWidth = 0;
    let generation = 0;
    let removed = false;
    let frame: number | null = null;
    const attachNative = () => {
      initialWidth = element.getBoundingClientRect().width;
      const currentGeneration = generation;
      return super.addMatchListener(query, (...args) => {
        if (!removed && currentGeneration === generation) updateMatches(...args);
      }, match);
    };
    let nativeListener = attachNative();
    const initial = element.getBoundingClientRect();
    let lastWidth = initial.width;
    let lastHeight = initial.height;
    const returnObserver = new ResizeObserver(entries => {
      if (removed) return;
      for (const entry of entries) {
        if (entry.target !== element) continue;
        const { width, height } = entry.contentRect;
        if (width === initialWidth && (width !== lastWidth || height !== lastHeight) && frame === null) {
          // Keep observing, but ignore pending callbacks from the old measurement.
          // Renewal reads live geometry in the next frame, coalescing rapid resizes.
          generation++;
          frame = ownerWindow.requestAnimationFrame(() => {
            frame = null;
            if (removed) return;
            nativeListener.remove(); // Also cancels its stale pending debounce.
            nativeListener = attachNative();
          });
        }
        lastWidth = width;
        lastHeight = height;
      }
    });
    returnObserver.observe(element);
    return {
      remove() {
        removed = true;
        generation++;
        if (frame !== null) ownerWindow.cancelAnimationFrame(frame);
        frame = null;
        returnObserver.disconnect();
        nativeListener.remove();
      },
    };
  }
}
