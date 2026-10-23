import type { Permission } from '@/lib/authorization';
import { routes } from '@/lib/routes';

/**
 * Studio owns content authoring and review only. Assessments, grading queues
 * and learning reports live in the Assessment & grading workspace; people,
 * schools, roles, enrollment versions and audit live in Administration.
 */
const STUDIO_PERMISSIONS = ['course.read', 'content.read', 'resource.edit', 'opportunity.edit', 'project.edit', 'media.upload', 'bank.edit', 'content.review', 'content.review.request', 'content.publish'] as const;

export const studioNavigation = [
  { key: 'home', href: routes.studio.dashboard(), permissions: STUDIO_PERMISSIONS, available: true, landing: false },
  { key: 'courses', href: routes.studio.courses(), permissions: ['course.read'], available: true, landing: true },
  { key: 'library', href: routes.studio.library(), permissions: ['content.read', 'course.read', 'resource.edit', 'opportunity.edit', 'project.edit', 'media.upload'], available: true, landing: true,
    matches: [
      { href: routes.studio.resources(), key: 'resources' },
      { href: routes.studio.opportunities(), key: 'opportunities' },
      { href: routes.studio.projects(), key: 'projects' },
      { href: routes.studio.media(), key: 'media' },
    ] },
  { key: 'questionBank', href: routes.studio.bank(), permissions: ['bank.edit'], available: true, landing: true },
  { key: 'reviews', href: routes.studio.reviews(), permissions: ['content.review', 'content.review.request', 'content.publish'], available: true, landing: true },
  { key: 'mcp', href: routes.studio.mcp(), permissions: ['content.read', 'course.read'], available: true, landing: false },
] as const;

/** Studio entry requires an actually reachable authoring destination. */
export function firstAuthoringDestination(permissions: readonly Permission[]): string | null {
  return studioNavigation.find(item => item.landing && item.permissions.some(permission => permissions.includes(permission)))?.href ?? null;
}

export function firstStudioDestination(permissions: readonly Permission[]): string | null {
  return firstAuthoringDestination(permissions);
}
