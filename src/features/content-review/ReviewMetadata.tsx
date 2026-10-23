import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { ReviewRow } from '@/features/admin/components/ContentReviewWorkspace';
import { TimelineCard, type TimelineItem } from '@/features/staff-ui/components/TimelineCard';
import { statusTone } from '@/features/staff-ui/components/status-tones';
const object=(v:unknown)=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
export function ReviewDependencies({dependencies,locale}:{dependencies:unknown[];locale:string}) {
  const vi=locale==='vi';
  if(!dependencies.length)return <p className="text-sm leading-normal text-muted-foreground">{vi?'Không có tài nguyên được ghim.':'No pinned resources.'}</p>;
  return <ul className="space-y-3">{dependencies.map((value,index)=>{const d=object(value)??{};const assets=Array.isArray(d.assets)?d.assets:[];const kind=String(d.kind??(vi?'Tài nguyên':'Resource'));return <li key={index} className="rounded-lg border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="min-w-0 break-words text-sm font-medium leading-normal">{kind} · {String(d.id??d.itemId??d.blockId??'')}</h3><Badge variant="neutral">{vi?'Đã ghim khi gửi duyệt':'Pinned at submission'}</Badge></div>{typeof d.revision_key==='string'&&<p className="mt-2 break-all text-xs leading-normal text-muted-foreground">{d.revision_key}</p>}{assets.length>0&&<ul className="mt-3 space-y-2">{assets.map((asset,i)=>{const a=object(asset)??{};return <li key={i} className="border-t border-border pt-2 text-sm leading-normal">{String(a.purpose??(vi?'tài nguyên':'asset'))} · {String(a.id??'')} · <span className="tabular-nums">{String(a.sizeBytes??'')}</span> {vi?'byte':'bytes'}<p className="break-all text-xs leading-normal text-muted-foreground">{String(a.checksum??'')}</p></li>})}</ul>}{d.kind==='asset'&&typeof d.id==='string'&&<a className="mt-2 inline-flex min-h-9 items-center text-sm font-medium underline underline-offset-4" href={`/api/v1/media/${encodeURIComponent(d.id)}`} target="_blank" rel="noopener noreferrer">{vi?'Mở tài nguyên':'Open resource'}</a>}</li>})}</ul>;
}

/**
 * Every review request for one content item, newest first, as a timeline: readable state label and tone,
 * submission time, the submitter's name when `submitters` (keyed by lower-cased user id) knows it,
 * the decision note and the reviewed revision.
 */
export function ReviewHistory({rows,submitters}:{rows:ReviewRow[];/** Kept for callers; dates follow the intl provider's locale. */ locale?:string;submitters?:Record<string,string>}) {
  const t=useTranslations('staffUi.studio.reviews.history');
  const states=useTranslations('cmsAdmin.states');
  const kit=useTranslations('staffUi.kit.status.review');
  const label=(status:string)=>states.has(status)?states(status):kit.has(status)?kit(status):status;
  const items:TimelineItem[]=[...rows].sort((a,b)=>b.submitted_at.localeCompare(a.submitted_at)).map(row=>({
    id:row.id,
    title:t('submitted'),
    status:{tone:statusTone('review',row.status),label:label(row.status)},
    at:row.submitted_at,
    actor:row.submitted_by?submitters?.[row.submitted_by.toLowerCase()]??null:null,
    description:<>
      {row.decision_note?<p className="whitespace-pre-wrap break-words leading-normal text-foreground">{row.decision_note}</p>:null}
      <p className="break-all text-xs leading-normal">{row.revision_key}</p>
    </>,
  }));
  // The preview section above already owns the h2, so the history heading is an h3.
  return <TimelineCard title={t('title')} emptyLabel={t('empty')} items={items} headingLevel={3} className="p-0 border-0" />;
}
