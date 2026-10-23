import type { ContentStatus, ReviewStatus } from '@/features/staff-ui/components/status-tones';

/**
 * One lifecycle stage per content item, in strip order:
 * Draft → In review → Changes requested → Approved → Published · Archived.
 */
export const CONTENT_STAGES = [
  'draft',
  'in_review',
  'changes_requested',
  'approved',
  'published',
  'archived',
] as const;
export type ContentStage = (typeof CONTENT_STAGES)[number];

export type ContentStageInput = {
  /** Status of the item's latest review request (cms_review_requests.status), if any. */
  reviewStatus?: ReviewStatus | null;
  contentStatus: ContentStatus;
};

/**
 * An open review decides the stage (pending → in review, changes requested, approved and not yet
 * published). A stale or withdrawn review means the author is editing again, so the item counts as
 * draft. Without a live review (none, or one already published) the content status decides.
 */
export function contentStage({ reviewStatus, contentStatus }: ContentStageInput): ContentStage {
  switch (reviewStatus) {
    case 'pending':
      return 'in_review';
    case 'changes_requested':
      return 'changes_requested';
    case 'approved':
      return 'approved';
    case 'stale':
    case 'withdrawn':
      return 'draft';
    default:
      return contentStatus;
  }
}

/** Snapshot count per stage; every stage is present, zero when empty. */
export function stageCounts(items: Iterable<ContentStageInput>): Record<ContentStage, number> {
  const counts = Object.fromEntries(CONTENT_STAGES.map((stage) => [stage, 0])) as Record<ContentStage, number>;
  for (const item of items) counts[contentStage(item)] += 1;
  return counts;
}

const EDITOR_ROUTES: Record<string, string> = {
  resource: '/studio/resources/',
  opportunity: '/studio/opportunities/',
  project: '/studio/projects/',
};

/**
 * Where a content row opens. cms_list_content points editable resources, opportunities and projects
 * at a narrowed library view (`/studio/library?type=…&id=…`), which only reloads the list; their
 * editors live at /studio/{resources,opportunities,projects}/[id]. Read-only rows (another school's
 * content, linked to the learner page under /app) keep the link they were given.
 */
export function contentEditorHref(contentType: unknown, contentId: unknown, studioHref: string): string {
  const base = typeof contentType === 'string' ? EDITOR_ROUTES[contentType] : undefined;
  if (!base || typeof contentId !== 'string' || !contentId || !studioHref.startsWith('/studio/')) return studioHref;
  return `${base}${encodeURIComponent(contentId)}`;
}
