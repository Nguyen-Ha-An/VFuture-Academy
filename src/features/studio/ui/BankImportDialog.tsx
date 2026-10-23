'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { itemRef } from '@/content-engine/diagnostics';
import { parseJsonDocument } from '@/content-engine/validate/parse';

type ApiIssue = { path?: Array<string | number>; message?: string };

function issueMessage(issue: ApiIssue, fallback: string): string {
  const path = issue.path?.length ? `${issue.path.join('.')} — ` : '';
  return `${path}${issue.message ?? fallback}`;
}

export function BankImportDialog() {
  const t = useTranslations('studio.bank');
  const locale = useLocale() === 'vi' ? 'vi' : 'en';
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [messageKind, setMessageKind] = useState<'error' | 'success' | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessages([]);
    setMessageKind(null);
    try {
      // Strict first: duplicate keys, comments, BOMs and non-finite numbers are
      // reported here. The request then sends the author's exact bytes rather than
      // a re-serialized value, so the server sees the same evidence — JSON.stringify
      // would silently drop the losing half of a duplicate key.
      const parsed = parseJsonDocument(text, itemRef('bank-import'));
      if (parsed.errors.length) {
        setMessages(parsed.errors.map((diagnostic) => diagnostic.message[locale]));
        setMessageKind('error');
        return;
      }
      const response = await fetch('/api/v1/studio/bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      });
      const body = await response.json() as { error?: { message?: string; issues?: ApiIssue[] } };
      if (!response.ok) {
        const issues = body.error?.issues;
        setMessages(issues?.length
          ? issues.map((issue) => issueMessage(issue, t('importError')))
          : [body.error?.message ?? t('importError')]);
        setMessageKind('error');
        return;
      }
      setText('');
      setMessages([t('importSuccess')]);
      setMessageKind('success');
      router.refresh();
    } catch (caught) {
      setMessages([caught instanceof Error ? caught.message : t('importError')]);
      setMessageKind('error');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
      <DialogTrigger asChild><Button className="min-h-11 sm:min-h-9">{t('import')}</Button></DialogTrigger>
      <DialogContent showCloseButton={false} aria-busy={pending} className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-4 text-left sm:px-6">
          <DialogTitle className="leading-normal">{t('importTitle')}</DialogTitle>
          <DialogDescription className="leading-normal">{t('importDescription')}</DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-5 sm:px-6">
            <label className="block text-sm font-medium leading-normal" htmlFor="bank-import-json">{t('json')}</label>
            <Textarea id="bank-import-json" className="min-h-64 resize-y font-mono text-xs leading-normal" value={text} onChange={(event) => setText(event.target.value)} required spellCheck={false} />
            <div role="status" aria-live="polite" aria-atomic="true" className={messageKind === 'success' && messages.length > 0 ? 'rounded-md border border-success-border bg-success p-3 text-sm leading-normal text-success-foreground' : undefined}>
              {messageKind === 'success' && messages.length > 0 ? <ul className="space-y-1">{messages.map((message, index) => <li className="break-words [overflow-wrap:anywhere]" key={`${message}-${index}`}>{message}</li>)}</ul> : null}
            </div>
            {messageKind === 'error' && messages.length > 0 ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-normal text-destructive-soft-foreground"><ul className="space-y-1">{messages.map((message, index) => <li className="break-words [overflow-wrap:anywhere]" key={`${message}-${index}`}>{message}</li>)}</ul></div> : null}
          </div>
          <DialogFooter className="shrink-0 border-t border-border px-4 py-4 sm:px-6">
            <DialogClose asChild><Button variant="outline" disabled={pending} className="min-h-11 w-full sm:min-h-9 sm:w-auto">{t('cancel')}</Button></DialogClose>
            <Button type="submit" disabled={pending || !text.trim()} className="min-h-11 w-full sm:min-h-9 sm:w-auto">{pending ? t('importing') : t('importAction')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
