import type { ResourceLinkBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { asText } from '../text';
/** A resource id is never a readable title; without an authored label the link names the action. */
const open = { vi: 'Mở tài nguyên', en: 'Open resource' } as const;
export function ResourceLink({ block, runtime }: BlockRendererProps<ResourceLinkBlock>) {
  return <a href={runtime.hrefFor({ kind: 'resource', id: block.resourceId })} onClick={() => runtime.onActivityComplete(block.id)} className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border bg-card p-3 hover:bg-muted"><span><span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{runtime.locale === 'vi' ? 'Tài nguyên' : 'Resource'}</span><span className="font-medium">{asText(block.label) || open[runtime.locale]}</span></span><span aria-hidden="true" className="text-muted-foreground">→</span></a>;
}
