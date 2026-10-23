'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/classic';

/**
 * Bench submit button. A form action runs inside a transition, so state set by the action
 * itself is not painted until it settles; `useFormStatus` is what reports the in-flight state.
 */
export function PendingSubmit({ label, pendingLabel, disabled, className }: { label: string; pendingLabel: string; disabled?: boolean; className?: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" className={className} disabled={disabled || pending}>{pending ? pendingLabel : label}</Button>;
}
