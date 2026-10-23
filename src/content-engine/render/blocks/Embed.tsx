import type { EmbedBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { asText } from '../text';
import { isAllowedEmbedHost } from '../../schema/rich-content';
import { engineStrings, tr } from '../strings';
const ratios = { '16:9': 'aspect-video', '4:3': 'aspect-[4/3]', '1:1': 'aspect-square' } as const;
export function Embed({ block, runtime }: BlockRendererProps<EmbedBlock>) {
  if (!isAllowedEmbedHost(block.url)) return <p role="note" className="text-sm text-destructive">{tr(runtime.locale, engineStrings.embed.blocked)}</p>;
  return <div className={`w-full overflow-hidden rounded-md border border-border ${ratios[block.aspectRatio ?? '16:9']}`}><iframe title={asText(block.title)} src={block.url} className="h-full w-full" sandbox="allow-scripts allow-same-origin allow-presentation" referrerPolicy="strict-origin-when-cross-origin" loading="lazy" /></div>;
}
