export type OpportunityAvailability = 'upcoming' | 'open' | 'closed';

export function opportunityAvailability(
  openAt: string | null,
  closeAt: string | null,
  now: Date = new Date(),
): OpportunityAvailability {
  const time = now.getTime();
  if (openAt && time < Date.parse(openAt)) return 'upcoming';
  // Opportunity windows retain their established inclusive closing boundary.
  if (closeAt && time > Date.parse(closeAt)) return 'closed';
  return 'open';
}

export function requiredCourseEligibility(
  requiredCourseIds: readonly string[],
  statuses: ReadonlyMap<string, string>,
): { eligible: boolean; incompleteCourseIds: string[] } {
  const incompleteCourseIds = requiredCourseIds.filter((courseId) => statuses.get(courseId) !== 'completed');
  return { eligible: incompleteCourseIds.length === 0, incompleteCourseIds };
}
