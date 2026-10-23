import type { NextStepBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { asText } from '../text';
export function NextStep({ block, runtime }: BlockRendererProps<NextStepBlock>) {
  return <a href={runtime.hrefFor(block.target)} className="block rounded-md border border-border border-l-2 border-l-primary bg-card p-4 hover:bg-muted"><span className="block text-xs font-medium uppercase tracking-wide text-primary">{runtime.locale === 'vi' ? 'Tiếp theo' : 'Up next'}</span><span className="text-lg font-semibold">{asText(block.title)} <span aria-hidden="true">→</span></span>{block.description ? <span className="mt-1 block text-sm text-muted-foreground">{asText(block.description)}</span> : null}</a>;
}
