'use client';
import { useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';

/**
 * Mirrors an owner-supplied value in local state so that typing is never interrupted,
 * even when the owner debounces, batches or ignores the emitted change. `syncKey` is a
 * primitive derived from the incoming value: whenever it changes the draft is re-seeded,
 * so programmatic resets and re-hydration from the server still win.
 */
export function useDraft<T>(external: T, syncKey: string): [T, (next: T) => void] {
  const [draft, setDraft] = useState(external);
  const [seen, setSeen] = useState(syncKey);
  if (syncKey !== seen) { setSeen(syncKey); setDraft(external); }
  return [draft, setDraft];
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange'> & { value: string; onValueChange: (next: string) => void };
export function DraftInput({ value, onValueChange, ...rest }: InputProps) {
  const [draft, setDraft] = useDraft(value, value);
  return <input {...rest} value={draft} onChange={(e) => { setDraft(e.target.value); onValueChange(e.target.value); }} />;
}

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'defaultValue' | 'onChange'> & { value: string; onValueChange: (next: string) => void };
export function DraftTextarea({ value, onValueChange, ...rest }: TextareaProps) {
  const [draft, setDraft] = useDraft(value, value);
  return <textarea {...rest} value={draft} onChange={(e) => { setDraft(e.target.value); onValueChange(e.target.value); }} />;
}
