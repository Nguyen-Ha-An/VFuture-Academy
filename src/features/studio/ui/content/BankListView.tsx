import { useTranslations } from 'next-intl';

import { DataCard, EmptyState } from '@/features/staff-ui/components';
import { BankImportDialog } from '@/features/studio/ui/BankImportDialog';
import { BankTable, type BankListItem, type BankTableFilters } from '@/features/studio/ui/BankTable';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';

export type BankListViewProps = {
  questions: BankListItem[];
  filters: BankTableFilters;
};

/** Question bank page: H1 with "Import bundle" as the one primary action, then the server-filtered table. */
export function BankListView({ questions, filters }: BankListViewProps) {
  const t = useTranslations('studio.bank');
  const content = useTranslations('staffUi.studio.content.bank');
  const unfiltered = Object.keys(filters).length === 0;
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <StaffPageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} actions={<BankImportDialog />} />
      {questions.length === 0 && unfiltered ? (
        <DataCard title={content('title')}>
          <div className="p-6"><EmptyState title={t('empty')} /></div>
        </DataCard>
      ) : (
        <BankTable questions={questions} filters={filters} />
      )}
    </div>
  );
}
