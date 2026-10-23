/** Project ids that collide with learner routes such as `/app/projects/new`. */
export const RESERVED_PROJECT_IDS: ReadonlySet<string> = new Set(['new']);

const MAX_PROJECT_ID_LENGTH = 64;
const RESERVED_SUFFIX = '-project';

function trimDashes(value: string): string {
  return value.replace(/^-+|-+$/g, '');
}

/** Derives a kebab-case project id from a title, avoiding reserved route segments. */
export function slugifyProjectId(title: string): string {
  const slug = trimDashes(trimDashes(
    title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-'),
  ).slice(0, MAX_PROJECT_ID_LENGTH));
  if (!slug) return 'project';
  if (!RESERVED_PROJECT_IDS.has(slug)) return slug;
  return `${trimDashes(slug.slice(0, MAX_PROJECT_ID_LENGTH - RESERVED_SUFFIX.length))}${RESERVED_SUFFIX}`;
}
