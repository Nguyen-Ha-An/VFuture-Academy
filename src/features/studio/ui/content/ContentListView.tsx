import Link from 'next/link';
import { PlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import type { ContentListKind, ContentListRow } from '@/features/studio/content-lists-data';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
import { ContentListTable } from './ContentListTable';

export type ContentListViewProps = {
  kind: ContentListKind;
  rows: ContentListRow[];
  /** Server page for resources and opportunities; projects are always one complete list. */
  page?: number;
  hasMore?: boolean;
};

const AREA = { resource: 'studio.resources', opportunity: 'studio.opportunities', project: 'studio.projects' } as const;
const NEW_HREF = { resource: '/studio/resources/new', opportunity: '/studio/opportunities/new', project: '/studio/projects/new' } as const;

/**
 * Resources, opportunities and projects list page: H1 with the one primary action
 * ("New …" / "Create project"), then the data card. Presentational and serializable,
 * so the e2e harness can render it with fixture rows.
 */
export function ContentListView({ kind, rows, page = 1, hasMore = false }: ContentListViewProps) {
  const t = useTranslations(AREA[kind]);
  const projectForm = useTranslations('studio.projects.form');
  const newLabel = kind === 'project' ? projectForm('create') : t('new');
  const newLink = (
    <Button asChild>
      <Link href={NEW_HREF[kind]}>
        <PlusIcon aria-hidden="true" />
        {newLabel}
      </Link>
    </Button>
  );
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <StaffPageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} actions={newLink} />
      <ContentListTable kind={kind} rows={rows} page={page} hasMore={hasMore} />
    </div>
  );
}
