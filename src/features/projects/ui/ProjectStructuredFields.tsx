'use client';

import { CanvasButton, CanvasFormFieldGroup, CanvasSelect, CanvasTextInput } from '@/features/canvas/ui';
import type { ProjectDetail } from '@/features/projects/service';
import { memberFields, outputLinkFields, serializeMemberFields, serializeOutputLinkFields } from './form-utils';

type Props = { value: string; onChange: (value: string) => void; disabled: boolean; locale: 'vi' | 'en'; kind: 'members' | 'outputs'; members?: ProjectDetail['members'] };

/** Edits the existing recoverable form source; persistence and parsing stay in the parent. */
export function ProjectStructuredFields({ value, onChange, disabled, locale, kind, members = [] }: Props) {
  const vi = locale === 'vi';
  const rows = value.split('\n').filter(line => line.trim());
  const columns = (row: string): string[] => kind === 'members' ? memberFields(row) : outputLinkFields(row);
  const serialize = (parts: string[]) => kind === 'members'
    ? serializeMemberFields([parts[0] ?? '', parts[1] ?? 'member'])
    : serializeOutputLinkFields([parts[0] ?? '', parts[1] ?? '', parts[2] ?? '']);
  const change = (index: number, column: number, next: string) => {
    const parts = columns(rows[index]!);
    parts[column] = next;
    onChange(rows.map((row, i) => i === index ? serialize(parts) : row).join('\n'));
  };
  return <div data-project-structured className="min-w-0 space-y-4">
    {rows.map((row, index) => {
      const parts = columns(row);
      const member = members.find(member => member.userId === parts[0]?.trim());
      const description = kind === 'members' ? `${vi ? 'Thành viên' : 'Member'} ${index + 1}${member?.displayName ? ` · ${member.displayName}` : ''}` : `${vi ? 'Sản phẩm' : 'Output'} ${index + 1}`;
      return <div key={index} className="border-b border-border pb-4"><CanvasFormFieldGroup description={description} layout="stacked" rowSpacing="small"><div className="grid min-w-0 gap-4 sm:grid-cols-2">
        {kind === 'members' ? <>
          <CanvasTextInput label={vi ? 'Mã người dùng' : 'User ID'} required value={parts[0] ?? ''} disabled={disabled} onChange={next => change(index, 0, next)} />
          <CanvasSelect label={vi ? 'Vai trò' : 'Role'} value={parts[1]?.trim() || 'member'} disabled={disabled} options={[{value:'owner',label:vi?'Chủ dự án':'Owner'},{value:'mentor',label:vi?'Cố vấn':'Mentor'},{value:'member',label:vi?'Thành viên':'Member'}]} onChange={next => change(index, 1, next)} />
        </> : <>
          <CanvasTextInput label={vi ? 'Nhãn tiếng Việt' : 'Vietnamese label'} value={parts[0] ?? ''} disabled={disabled} onChange={next => change(index, 0, next)} />
          <CanvasTextInput label={vi ? 'Nhãn tiếng Anh' : 'English label'} value={parts[1] ?? ''} disabled={disabled} onChange={next => change(index, 1, next)} />
          <div className="sm:col-span-2"><CanvasTextInput label="URL" type="url" required value={parts[2] ?? ''} disabled={disabled} onChange={next => change(index, 2, next)} /></div>
        </>}
      </div></CanvasFormFieldGroup><div className="mt-3"><CanvasButton variant="outline" size="sm" disabled={disabled} aria-label={`${vi ? 'Xóa' : 'Remove'} ${description}`} onClick={() => onChange(rows.filter((_, i) => i !== index).join('\n'))}>{vi ? 'Xóa' : 'Remove'}</CanvasButton></div></div>;
    })}
    {!rows.length ? <p className="text-sm text-muted-foreground">{vi ? 'Chưa có mục nào.' : 'No entries yet.'}</p> : null}
    <CanvasButton variant="outline" disabled={disabled} onClick={() => onChange([...rows, kind === 'members' ? serializeMemberFields(['', 'member']) : serializeOutputLinkFields(['', '', ''])].join('\n'))}>{kind === 'members' ? vi ? 'Thêm thành viên' : 'Add member' : vi ? 'Thêm sản phẩm' : 'Add output'}</CanvasButton>
  </div>;
}
