import { useTranslations } from 'next-intl';

import { FrameScope, RenderScope } from '@/content-engine/render/render-context';
import { StaticRichContent } from '@/features/ecosystem/ui/StaticRichContent';
import type { LocalizedResource, ResourceListFilter } from '@/features/resources/service';
import { DetailPage } from '@/features/workspace-ui/learner/DetailPage';
import { PageHeader } from '@/features/workspace-ui/ui/PageHeader';
import { Card, StateTag } from '@/features/workspace-ui/ui/primitives';
import { routes } from '@/lib/routes';

export type DetailTranslate = (key: string, values?: Record<string, string | number>) => string;

function attachmentHref(src: LocalizedResource['attachments'][number]['src']) {
  return 'url' in src ? src.url : `/api/v1/media/${encodeURIComponent(src.assetId)}`;
}

/**
 * Learner resource detail on DetailPage. The body is one Card; engine blocks inside it render flat
 * (FrameScope depth 1), so no card nests in a card. The aside holds attachments and tags and only
 * renders when either exists.
 */
export function ResourceDetail({ resource, listContext, t }: { resource: LocalizedResource; listContext: ResourceListFilter; t: DetailTranslate }) {
  const learner = useTranslations('learner');
  const hasAside = resource.attachments.length > 0 || resource.tags.length > 0;
  return <DetailPage
    header={<PageHeader
      crumbs={[{ label: learner('focus.explore'), href: routes.learner.explore() }, { label: learner('focus.resources'), href: routes.learner.resources(listContext) }, { label: resource.title }]}
      kicker={t(`types.${resource.resourceType}`)}
      tags={resource.pathways.length ? resource.pathways.map((pathway) => <StateTag key={pathway} plain>{t(`pathways.${pathway}`)}</StateTag>) : null}
      title={resource.title}
      lead={resource.summary}
    />}
    aside={hasAside ? <>
      {resource.attachments.length ? <Card title={t('attachments')}>
        <ul className="vf-l-rows">{resource.attachments.map((attachment) => {
          const href = attachmentHref(attachment.src);
          return <li key={`${attachment.label}:${href}`}>
            <a href={href} {...('url' in attachment.src ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="vf-l-row vf-l-row-link">{attachment.label}<span aria-hidden="true" className="vf-l-row-arrow">↗</span></a>
          </li>;
        })}</ul>
      </Card> : null}
      {resource.tags.length ? <Card title={t('tags')}>
        <ul className="vf-l-tags">{resource.tags.map((tag) => <li key={tag}><StateTag plain>{tag}</StateTag></li>)}</ul>
      </Card> : null}
    </> : undefined}
  >
    <Card as="div">
      <RenderScope ownerLevel={1} blocks={resource.body.blocks}>
        <FrameScope depth={1}><StaticRichContent content={resource.body} /></FrameScope>
      </RenderScope>
    </Card>
  </DetailPage>;
}
