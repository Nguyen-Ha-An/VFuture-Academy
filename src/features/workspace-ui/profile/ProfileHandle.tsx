'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/**
 * The learner's @handle, shown once in the profile head meta. It follows a handle saved from the
 * public profile settings (`profile-handle-saved`) without waiting for a refresh.
 */
export function ProfileHandle({ handle }: { handle: string | null }) {
  const t = useTranslations('bench.profile');
  const [visible, setVisible] = useState(handle);
  useEffect(() => setVisible(handle), [handle]);
  useEffect(() => {
    const update = (event: Event) => {
      const next = (event as CustomEvent<{ handle?: unknown }>).detail?.handle;
      if (typeof next === 'string' && next) setVisible(next);
    };
    window.addEventListener('profile-handle-saved', update);
    return () => window.removeEventListener('profile-handle-saved', update);
  }, []);
  return <>{visible ? t('handle', { handle: visible }) : t('noHandle')}</>;
}
