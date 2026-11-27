'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { CanvasButton as Button } from '@/features/canvas/ui';
import { SectionCard } from '@/features/staff-ui/components';
import type { ResourceFilesState } from '@/features/resources/files-pilot';

const copy = {
  en: {
    title: 'VFuture Files PDF', choose: 'Choose a PDF (up to 4 MiB)', upload: 'Submit PDF for review',
    refresh: 'Check Files release status', read: 'Open PDF', select: 'Choose a PDF before uploading.',
    network: 'Files could not complete this request. Try again.',
    empty: 'Choose an approved PDF for this public resource. A Files publisher will review it.',
    uploading: 'Upload interrupted. Select the same PDF and filename to resume.',
    review: 'Waiting for a Files publisher. Check here after publication.',
    published: 'Published in VFuture Files.',
    withdrawn: 'The Files release was withdrawn.',
  },
  vi: {
    title: 'PDF trên VFuture Files', choose: 'Chọn tệp PDF (tối đa 4 MiB)', upload: 'Gửi PDF để xét duyệt',
    refresh: 'Kiểm tra trạng thái phát hành', read: 'Mở PDF', select: 'Hãy chọn tệp PDF trước khi tải lên.',
    network: 'Không thể hoàn tất yêu cầu trên Files. Vui lòng thử lại.',
    empty: 'Chọn tệp PDF đã được duyệt cho tài nguyên công khai này. Người phụ trách Files sẽ xét duyệt.',
    uploading: 'Quá trình tải lên bị gián đoạn. Chọn lại tệp PDF gốc với cùng tên để tiếp tục.',
    review: 'Đang chờ phát hành trên Files. Kiểm tra lại tại đây sau khi phát hành.',
    published: 'Đã phát hành trên VFuture Files.',
    withdrawn: 'Bản phát hành trên Files đã được thu hồi.',
  },
} as const;

async function readState(endpoint: string, init?: RequestInit) {
  const response = await fetch(endpoint, { ...init, cache: 'no-store' });
  if (!response.ok) throw new Error('Files request failed');
  return ((await response.json()) as { data: ResourceFilesState }).data;
}

export function ResourceFilesPilot({
  id, actorId, locale, writesEnabled,
}: {
  id: string;
  actorId: string;
  locale: 'en' | 'vi';
  writesEnabled: boolean;
}) {
  const t = copy[locale];
  const endpoint = `/api/v1/studio/resources/${encodeURIComponent(id)}/files?${new URLSearchParams({ scope: 'central', actorId })}`;
  const [state, setState] = useState<ResourceFilesState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void readState(endpoint, { signal: controller.signal }).then(setState, () => {
      if (!controller.signal.aborted) setError(t.network);
    });
    return () => controller.abort();
  }, [endpoint, t.network]);

  async function run(method: 'POST' | 'PATCH', body?: FormData) {
    setBusy(true);
    setError('');
    try {
      setState(await readState(endpoint, { method, body }));
    } catch {
      setError(t.network);
    } finally {
      setBusy(false);
    }
  }

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) {
      setError(t.select);
      return;
    }
    void run('POST', form);
  }

  return (
    <SectionCard title={t.title} columns={1}>
      <p className="text-sm" aria-live="polite">{state ? t[state.status] : null}</p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {writesEnabled && (state?.status === 'empty' || state?.status === 'uploading') ? (
        <form onSubmit={upload} className="grid gap-3">
          <label className="flex flex-col gap-2 text-sm">
            {t.choose}
            <input required name="file" type="file" accept=".pdf,application/pdf" disabled={busy} />
          </label>
          <Button type="submit" disabled={busy}>{t.upload}</Button>
        </form>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={() => void run('PATCH')} disabled={busy}>{t.refresh}</Button>
        {state?.status === 'published' && state.url ? <a href={state.url} className="underline">{t.read}</a> : null}
      </div>
    </SectionCard>
  );
}
