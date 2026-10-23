import type { OpportunityLinkBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
const rel = { recommended_next_step: { vi: 'Bước tiếp theo được đề xuất', en: 'Recommended next step' }, related: { vi: 'Cơ hội liên quan', en: 'Related opportunity' }, prerequisite_for: { vi: 'Điều kiện cho', en: 'Prerequisite for' } } as const;
/** The block stores only an id, which is never a readable title, so the link names the action. */
const view = { vi: 'Xem cơ hội', en: 'View opportunity' } as const;
export function OpportunityLink({ block, runtime }: BlockRendererProps<OpportunityLinkBlock>) {
  return <a href={runtime.hrefFor({ kind: 'opportunity', id: block.opportunityId })} className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border bg-card p-3 hover:bg-muted"><span><span className="block text-xs font-medium uppercase tracking-wide text-primary">{rel[block.relationship][runtime.locale]}</span><span className="font-medium">{view[runtime.locale]}</span></span><span aria-hidden="true" className="text-muted-foreground">→</span></a>;
}
