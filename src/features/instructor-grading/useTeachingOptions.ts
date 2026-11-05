'use client';

import { useEffect, useState } from 'react';
import { readApiData, workspaceErrorMessage } from '@/features/studio/ui/client';

export type TeachingVersion = { courseId: string; courseTitle: string; courseVersionId: string; version: number | null };
export type TeachingOptions = { courses: { id: string; title: string }[]; versions: TeachingVersion[] };
const empty: TeachingOptions = { courses: [], versions: [] };

/** Options are returned only for the explicitly selected school. */
export function useTeachingOptions(branchId: string, locale: 'vi' | 'en') {
  const [options, setOptions] = useState<TeachingOptions>(empty);
  const [error, setError] = useState('');
  const [loadedBranch, setLoadedBranch] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setOptions(empty); setLoadedBranch(''); setError('');
    if (branchId) {
      const query = new URLSearchParams({ branchId, locale });
      void fetch(`/api/v1/teaching/options?${query}`, { signal: controller.signal })
        .then(response => readApiData<TeachingOptions>(response))
        .then(data => { if (!controller.signal.aborted) { setOptions(data); setLoadedBranch(branchId); } })
        .catch(cause => { if (!controller.signal.aborted) setError(workspaceErrorMessage(cause, locale === 'vi' ? 'Không thể tải khóa học.' : 'Could not load courses.')); });
    }
    return () => controller.abort();
  }, [branchId, locale]);
  return { options: loadedBranch === branchId ? options : empty, error };
}
