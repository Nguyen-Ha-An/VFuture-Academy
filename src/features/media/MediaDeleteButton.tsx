'use client';

import { useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

const copy = {
  en: { action: 'Delete file', title: (name: string) => `Delete ${name}?`, description: 'This permanently deletes the stored file. Files used by content, published versions, reviews or learning history cannot be deleted. This action cannot be undone.', cancel: 'Cancel', confirm: 'Delete permanently', busy: 'Deleting…', failed: 'Deletion is not confirmed. Retry to check its status.' },
  vi: { action: 'Xóa tệp', title: (name: string) => `Xóa ${name}?`, description: 'Thao tác này xóa vĩnh viễn tệp đã lưu. Không thể xóa tệp đang được sử dụng trong nội dung, phiên bản đã xuất bản, xét duyệt hoặc lịch sử học tập. Không thể hoàn tác thao tác này.', cancel: 'Hủy', confirm: 'Xóa vĩnh viễn', busy: 'Đang xóa…', failed: 'Chưa xác nhận được việc xóa. Hãy thử lại để kiểm tra trạng thái.' },
};

export function MediaDeleteButton({ assetId, filename, onDeleted, disabled = false, url }: {
  assetId: string; filename: string; onDeleted: () => void; disabled?: boolean; url?: string;
}) {
  const t = copy[useLocale() === 'vi' ? 'vi' : 'en'];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError(null);
    try {
      const response = await fetch(url ?? `/api/v1/studio/media/${encodeURIComponent(assetId)}`, { method: 'DELETE', signal: AbortSignal.timeout(120_000) });
      const body = await response.json() as { data?: { id?: string; deleted?: boolean }; error?: { message?: string } };
      if (!response.ok || body.data?.id !== assetId || body.data.deleted !== true) throw new Error(body.error?.message ?? t.failed);
      setOpen(false); onDeleted();
    } catch (cause) { setError(cause instanceof Error && cause.name !== 'TimeoutError' ? cause.message : t.failed); }
    finally { running.current = false; setBusy(false); }
  }
  return <>
    <Button variant="destructive" size="sm" disabled={disabled || busy} onClick={() => { setError(null); setOpen(true); }}>{t.action}</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent showCloseButton={false}>
        <DialogTitle>{t.title(filename)}</DialogTitle>
        <DialogDescription>{t.description}</DialogDescription>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{t.cancel}</Button>
          <Button variant="destructive" disabled={busy} onClick={() => void remove()}>{busy ? t.busy : t.confirm}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
