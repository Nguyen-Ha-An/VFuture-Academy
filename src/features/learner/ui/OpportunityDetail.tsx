import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { FrameScope, RenderScope } from '@/content-engine/render/render-context';
import { StaticRichContent } from '@/features/ecosystem/ui/StaticRichContent';
import { opportunityAvailability, requiredCourseEligibility } from '@/features/opportunities/availability';
import type { LocalizedOpportunity, OpportunityListFilter } from '@/features/opportunities/service';
import { OpportunityAction, OpportunityViewTracker } from '@/features/opportunities/ui/OpportunityActions';
import { ictDateTime, readableId } from '@/features/workspace-ui/format';
import { DetailPage } from '@/features/workspace-ui/learner/DetailPage';
import { PageHeader } from '@/features/workspace-ui/ui/PageHeader';
import { Card, StateTag, type Tone } from '@/features/workspace-ui/ui/primitives';
import { routes } from '@/lib/routes';
import { availabilityTone } from './OpportunityDiscovery';
import type { DetailTranslate } from './ResourceDetail';

type OpportunityDetailData = LocalizedOpportunity & {
  interested: boolean;
  courseStatuses: Array<{ courseId: string; status: string }>;
};

export type OpportunityCourse = { id: string; title: string; skills?: Array<{ id: string; name: string }> };

/**
 * Eligibility keys with a learner label (`opportunities.eligibilityKeys.*`). Authored keys match
 * ignoring case, spaces, `_` and `-`, plus a few spelled-out aliases (`Minimum age`). `note` renders
 * as prose; any other key is authored data we cannot label, so it is hidden rather than shown raw.
 */
export const ELIGIBILITY_KEYS = ['minAge', 'maxAge', 'grade', 'experience', 'language', 'commitment'] as const;
type EligibilityKey = typeof ELIGIBILITY_KEYS[number] | 'note';

const normalizeKey = (key: string) => key.toLowerCase().replace(/[\s_-]+/g, '');
const ELIGIBILITY_ALIASES: Record<string, EligibilityKey> = {
  note: 'note', notes: 'note',
  minage: 'minAge', minimumage: 'minAge',
  maxage: 'maxAge', maximumage: 'maxAge',
  grade: 'grade', grades: 'grade', gradelevel: 'grade',
  experience: 'experience',
  language: 'language', languages: 'language',
  commitment: 'commitment', timecommitment: 'commitment',
};

/** Known eligibility entries by canonical key; the first authored spelling of a key wins. */
export function knownEligibility(eligibility: Record<string, unknown>): Map<EligibilityKey, unknown> {
  const known = new Map<EligibilityKey, unknown>();
  for (const [key, value] of Object.entries(eligibility)) {
    const canonical = ELIGIBILITY_ALIASES[normalizeKey(key)];
    if (canonical && !known.has(canonical)) known.set(canonical, value);
  }
  return known;
}

function eligibilityValue(value: unknown, t: DetailTranslate): string | null {
  if (typeof value === 'boolean') return t(value ? 'yes' : 'no');
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    const parts = value.map((item) => typeof item === 'string' || typeof item === 'number' ? String(item).trim() : '').filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  return null;
}

function repeatsOnlineLabel(location: string | null, online: boolean, onlineLabel: string, locale: string) {
  return Boolean(online && location && location.trim().toLocaleLowerCase(locale) === onlineLabel.trim().toLocaleLowerCase(locale));
}

const courseTone = (status?: string): Tone => status === 'completed' ? 'signal' : status === 'active' ? 'pending' : 'neutral';

/**
 * Learner opportunity detail on DetailPage: description, ICT dates, recommended skills and courses
 * in the main column, the "Next step" ActionPanel, and eligibility in the aside.
 */
export function OpportunityDetail({ opportunity, listContext, catalog, locale, now, t }: { opportunity: OpportunityDetailData; listContext: OpportunityListFilter; catalog: OpportunityCourse[]; locale: string; now: Date; t: DetailTranslate }) {
  const learner = useTranslations('learner');
  const availability = opportunityAvailability(opportunity.openAt, opportunity.closeAt, now);
  const statuses = new Map(opportunity.courseStatuses.map((course) => [course.courseId, course.status]));
  const eligibility = requiredCourseEligibility(opportunity.requiredCourses, statuses);
  const courseNames = new Map(catalog.map((course) => [course.id, course.title]));
  const skillNames = new Map(catalog.flatMap((course) => course.skills ?? []).map((skill) => [skill.id, skill.name]));
  const dates = ([['openAt', opportunity.openAt], ['closeAt', opportunity.closeAt], ['startAt', opportunity.startAt], ['endAt', opportunity.endAt]] as const)
    .filter((entry): entry is readonly [typeof entry[0], string] => entry[1] !== null && Number.isFinite(Date.parse(entry[1])));
  const courseStatus = (status?: string) => status === 'active' || status === 'completed' || status === 'dropped' ? t(`courseStatuses.${status}`) : t('courseStatuses.notStarted');
  const courseCard = (heading: string, ids: string[]) => ids.length ? <Card title={heading} flush>
    <ul className="vf-l-rows">{ids.map((id) => <li key={id} className="vf-l-row">
      {courseNames.has(id) ? <Link href={routes.learner.course(id)} className="vf-l-row-link">{courseNames.get(id)}</Link> : <span className="vf-meta">{t('courseUnavailable')}</span>}
      <StateTag tone={courseTone(statuses.get(id))}>{courseStatus(statuses.get(id))}</StateTag>
    </li>)}</ul>
  </Card> : null;
  const eligibilityEntries = knownEligibility(opportunity.eligibility);
  const note = eligibilityValue(eligibilityEntries.get('note'), t);
  const known = ELIGIBILITY_KEYS.flatMap((key) => {
    const value = eligibilityValue(eligibilityEntries.get(key), t);
    return value ? [{ key, value }] : [];
  });
  const showLocation = opportunity.location && !repeatsOnlineLabel(opportunity.location, opportunity.online, t('online'), locale);
  const description = opportunity.description;

  return <><OpportunityViewTracker opportunityId={opportunity.id} /><DetailPage
    header={<PageHeader
      crumbs={[{ label: learner('focus.explore'), href: routes.learner.explore() }, { label: learner('focus.opportunities'), href: routes.learner.opportunities(listContext) }, { label: opportunity.title }]}
      kicker={learner('directory.kickers.opportunities')}
      tags={<>
        <StateTag plain>{t(`types.${opportunity.type}`)}</StateTag>
        <StateTag tone={availabilityTone(availability)}>{t(`availability.${availability}`)}</StateTag>
        {opportunity.featured ? <StateTag plain>{t('featured')}</StateTag> : null}
      </>}
      title={opportunity.title}
      lead={<p className="vf-l-lead">{opportunity.organization}</p>}
      meta={[showLocation ? `${t('location')}: ${opportunity.location}` : null, opportunity.online ? t('online') : null]}
    />}
    action={{
      title: t('nextStep'),
      body: <p>{t(availability === 'open' && eligibility.eligible ? 'eligible' : availability !== 'open' ? `action.${availability}` : 'ineligible')}</p>,
      action: <OpportunityAction opportunityId={opportunity.id} applicationUrl={opportunity.applicationUrl} internalApplication={opportunity.internalApplication} initiallyInterested={opportunity.interested} availability={availability} eligible={eligibility.eligible} />,
      note: opportunity.internalApplication ? t('interestNotice') : undefined,
    }}
    aside={<Card title={t('eligibility')}>
      {note ? <p className="vf-l-prose">{note}</p> : null}
      {known.length ? <dl className="vf-l-dl" data-stack="">{known.map(({ key, value }) => <div key={key}><dt>{t(`eligibilityKeys.${key}`)}</dt><dd>{value}</dd></div>)}</dl> : null}
      {!note && !known.length ? <p className="vf-l-prose vf-l-muted">{t('noAdditionalEligibility')}</p> : null}
    </Card>}
  >
    {description.blocks?.length ? <Card title={t('overview')}>
      <RenderScope ownerLevel={2} blocks={description.blocks}>
        <FrameScope depth={1}><StaticRichContent content={description} /></FrameScope>
      </RenderScope>
    </Card> : null}
    {dates.length ? <Card title={t('dates')}>
      <dl className="vf-l-dl">{dates.map(([name, value]) => <div key={name}><dt>{t(`dateLabels.${name}`)}</dt><dd><time dateTime={value}>{ictDateTime(value)}</time></dd></div>)}</dl>
    </Card> : null}
    {opportunity.recommendedSkills.length ? <Card title={t('recommendedSkills')}>
      <ul className="vf-l-tags">{opportunity.recommendedSkills.map((skill) => <li key={skill}><StateTag plain>{skillNames.get(skill) || readableId(skill)}</StateTag></li>)}</ul>
    </Card> : null}
    {courseCard(t('requiredCourses'), opportunity.requiredCourses)}
    {courseCard(t('recommendedCourses'), opportunity.recommendedCourses)}
  </DetailPage></>;
}
