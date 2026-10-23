'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/classic';
import { reportError } from '@/lib/observability';

type GlobalError = Error & { digest?: string };

export default function GlobalErrorPage({ error, reset }: { error: GlobalError; reset: () => void }) {
  const [correlationId, setCorrelationId] = useState<string>();
  useEffect(() => {
    setCorrelationId(reportError(error, { area: 'global', digest: error.digest }));
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="grid min-h-screen place-items-center bg-white px-6 py-16 text-slate-950">
          <section className="w-full max-w-xl rounded-2xl border border-slate-200 p-8 shadow-sm" aria-labelledby="global-error-title">
            <h1 id="global-error-title" className="text-3xl font-semibold tracking-tight">Something went wrong / Đã xảy ra lỗi</h1>
            <p className="mt-4 text-slate-600">Please try again. If the problem continues, contact an administrator. / Vui lòng thử lại. Nếu sự cố tiếp diễn, hãy liên hệ quản trị viên.</p>
            {correlationId ? (
              <p className="mt-3 font-mono text-sm text-slate-600">
                Reference / Mã tham chiếu: {correlationId}
              </p>
            ) : null}
            <Button className="mt-7" onClick={reset}>Try again / Thử lại</Button>
          </section>
        </main>
      </body>
    </html>
  );
}
