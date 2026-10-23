import { scopeKey } from '@/lib/admin-scope';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { ResourceDocumentSchema, type ResourceDocument } from '@/content-engine/schema/bundle';
import { actorResourcePermissionCheck, createResourceService, type ResourceDatabase, type StudioResourceRecord } from '@/features/resources/service';
import { ResourceEditor } from '@/features/resources/ui/ResourceEditor';
import { can } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import { typedContentPageContext } from '@/features/admin/content-review-production';
import { assertContentAccess, type ContentReviewDatabase } from '@/features/admin/content-review';
import { EditorPageHeader } from '@/features/studio/ui/content/EditorPageHeader';

type PageProps = { params: Promise<{ id: string }> };

const newResource: ResourceDocument = ResourceDocumentSchema.parse({
  schemaVersion: 1,
  kind: 'resource',
  id: 'new-resource',
  languages: ['vi', 'en'],
  defaultLanguage: 'vi',
  title: { vi: 'Tài nguyên mới', en: 'New resource' },
  summary: { vi: 'Mô tả ngắn.', en: 'Short summary.' },
  resourceType: 'guide',
  branchScope: { scope: 'global' },
  tags: [],
  skills: [],
  pathways: [],
  body: {
    vi: { blocks: [{ type: 'paragraph', content: [{ text: 'Bắt đầu viết nội dung.' }] }] },
    en: { blocks: [{ type: 'paragraph', content: [{ text: 'Start writing the content.' }] }] },
  },
});

export default async function StudioResourceDetailPage({ params }: PageProps) {
  const [{ id }, context, t] = await Promise.all([
    params,
    typedContentPageContext('content.edit', 'resource.edit'),
    getTranslations('studio.resources'),
  ]);
  const actor = context.actor;
  let document = newResource;
  let status = 'draft';
  let record: StudioResourceRecord | undefined;
  if (id !== 'new') {
    await assertContentAccess(supabaseService() as unknown as ContentReviewDatabase, actor, 'resource', id, 'content.read');
    const service = createResourceService({
      database: supabaseService() as unknown as ResourceDatabase,
      requirePermission: actorResourcePermissionCheck(actor, context.scope),
      scope: context.scope,
    });
    const row = await service.getStudio(id);
    const parsed = ResourceDocumentSchema.safeParse(row.document);
    if (!parsed.success) notFound();
    document = parsed.data;
    status = row.status;
    record = row;
  }

  const statusLabel = status === 'published' || status === 'archived'
    ? t(`statuses.${status}`)
    : t('statuses.draft');
  const title = typeof document.title === 'string'
    ? document.title
    : document.title.en ?? document.title.vi ?? t('untitled');
  const knownStatus = status === 'published' || status === 'archived' ? status : 'draft';
  return <div className="mx-auto flex w-full max-w-7xl flex-col gap-6"><EditorPageHeader backHref="/studio/resources" backLabel={t('back')} title={title} status={{ kind: 'content', value: knownStatus, label: statusLabel }} /><ResourceEditor key={id} recoveryKey={`studio:recovery:${context.actor.userId}:${scopeKey(context.scope)}:resource:${id}`} initialDocument={document} initialRecord={record} initialStatus={status as 'draft' | 'published' | 'archived'} isNew={id === 'new'} canPublish={can(actor, 'resource.publish', context.scope)} /></div>;
}
