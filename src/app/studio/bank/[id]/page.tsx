import Link from 'next/link';
import { ArrowLeftIcon } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';

import { actorPermissionCheck, createBankService, type BankDatabase } from '@/features/bank/service';
import { BankQuestionEditor, type BankQuestionDetail } from '@/features/studio/ui/BankQuestionEditor';
import { supabaseService } from '@/lib/supabase/server';
import { typedContentPageContext } from '@/features/admin/content-review-production';
import { assertContentAccess, type ContentReviewDatabase } from '@/features/admin/content-review';
import { EmptyState, StatusBadge } from '@/features/staff-ui/components';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function questionTitle(payload: unknown, locale: string, fallback: string): string {
  const source = record(payload);
  const content = record(source?.content);
  const candidate = source?.title ?? content?.title ?? content?.prompt;
  if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  const localized = record(candidate);
  for (const language of [locale, 'vi', 'en']) {
    const value = localized?.[language];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

type BankQuestionPageDetail = Omit<BankQuestionDetail, 'latestVersion'> & {
  latestVersion: BankQuestionDetail['latestVersion'] | null;
};

function detailOf(value: unknown): BankQuestionPageDetail {
  const detail = record(value);
  const latest = record(detail?.latestVersion);
  if (!detail || typeof detail.id !== 'string' || typeof detail.status !== 'string') throw new Error('Question detail is incomplete');
  const languages = Array.isArray(detail.languages) ? detail.languages.filter((value): value is 'vi' | 'en' => value === 'vi' || value === 'en') : [];
  const currentVersionId = typeof detail.currentVersionId === 'string' ? detail.currentVersionId : null;
  if (detail.latestVersion === null) return { id: detail.id, status: detail.status, currentVersionId, languages: languages.length ? languages : ['vi'], latestVersion: null };
  if (!latest || typeof latest.id !== 'string' || typeof latest.version !== 'number') throw new Error('Question detail is incomplete');
  return { id: detail.id, status: detail.status, currentVersionId, languages: languages.length ? languages : ['vi'], latestVersion: { id: latest.id, version: latest.version, payload: latest.payload, renders: record(latest.renders) ?? {}, grading: latest.grading } };
}

export default async function BankQuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await typedContentPageContext('content.edit', 'bank.edit');
  const actor = context.actor;
  await assertContentAccess(supabaseService() as unknown as ContentReviewDatabase, actor, 'bank_question', id, 'content.read');
  const service = createBankService({
    database: supabaseService() as unknown as BankDatabase,
    requirePermission: actorPermissionCheck(actor, context.scope),
    scope: context.scope,
  });
  const [rawDetail, t, review, locale] = await Promise.all([service.get(id), getTranslations('studio.bank.detail'), getTranslations('studioReview.bank'), getLocale()]);
  const detail = detailOf(rawDetail);
  const title = questionTitle(detail.latestVersion?.payload, locale, t('titleFallback'));
  const recoveryScope = context.scope.kind === 'central' ? 'central' : `branch:${context.scope.branchId}`;
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <Link href="/studio/bank" className="inline-flex min-h-9 w-fit items-center gap-2 rounded-md text-sm leading-normal text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        {t('back')}
      </Link>
      <StaffPageHeader eyebrow={t('eyebrow')} title={title} actions={<StatusBadge kind="content" value={detail.status} />} />
      {detail.latestVersion ? (
        <BankQuestionEditor initialDetail={{ ...detail, latestVersion: detail.latestVersion }} recoveryKey={`studio:${actor.userId}:${recoveryScope}:bank:${detail.id}`} />
      ) : (
        <EmptyState title={review('noVersionsTitle')} description={review('noVersionsDescription')} headingLevel={2} className="bg-card px-6 py-14" />
      )}
    </div>
  );
}
