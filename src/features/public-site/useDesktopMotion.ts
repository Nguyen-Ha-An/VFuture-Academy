'use client';

import { useEffect, useState } from 'react';

const desktopMotion = '(min-width: 768px) and (any-hover: hover) and (prefers-reduced-motion: no-preference)';

export function useDesktopMotion() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(desktopMotion);
    const update = () => setEnabled(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return enabled;
}
