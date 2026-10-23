'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/classic';

/** Import text is local until explicitly applied to the authoring form. */
export function ImportTextRecovery({ value, appliedValue, storageKey, onRestore, disabled }: {
  value: string; appliedValue: string; storageKey?: string; onRestore: (value: string) => void; disabled: boolean;
}) {
  const vi = useLocale() === 'vi';
  const [candidate, setCandidate] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const owner = useRef(crypto.randomUUID());
  const latest = useRef({ value, appliedValue, storageKey }); latest.current = { value, appliedValue, storageKey };
  useEffect(() => {
    if (!storageKey) return;
    try { const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null'); if (typeof stored?.source === 'string' && stored.source !== latest.current.appliedValue) setCandidate(stored.source); }
    catch { setFailed(true); }
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey) return;
    if (value === appliedValue) {
      try { const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null'); if (stored?.owner === owner.current) localStorage.removeItem(storageKey); } catch { setFailed(true); }
      return;
    }
    const timer = setTimeout(() => { try { localStorage.setItem(storageKey, JSON.stringify({ owner: owner.current, source: value })); } catch { setFailed(true); } }, 300);
    return () => clearTimeout(timer);
  }, [value, appliedValue, storageKey]);
  useEffect(() => {
    const persist = () => { const current = latest.current; if (!current.storageKey || current.value === current.appliedValue) return; try { localStorage.setItem(current.storageKey, JSON.stringify({ owner: owner.current, source: current.value })); } catch { /* Mounted UI reports storage errors. */ } };
    window.addEventListener('beforeunload', persist);
    return () => { persist(); window.removeEventListener('beforeunload', persist); };
  }, []);
  return <div className="space-y-2 text-sm">
    {value !== appliedValue ? <p role="status">{vi ? 'JSON chưa được áp dụng vào biểu mẫu và chưa lưu lên server. Bấm Nhập JSON để áp dụng.' : 'This JSON has not been applied to the form or saved to the server. Select Import JSON to apply it.'}</p> : null}
    {candidate !== null ? <div><p>{vi ? 'Có JSON nhập dở trên thiết bị này.' : 'Unapplied JSON is available on this device.'}</p><Button type="button" disabled={disabled} onClick={() => { onRestore(candidate); setCandidate(null); }}>{vi ? 'Khôi phục JSON' : 'Restore JSON'}</Button></div> : null}
    {failed ? <p role="alert">{vi ? 'Không thể lưu bản JSON khôi phục trên thiết bị.' : 'Could not save JSON recovery on this device.'}</p> : null}
  </div>;
}
