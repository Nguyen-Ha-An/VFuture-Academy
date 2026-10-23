import type { Locale } from '@/content-engine/schema/common';
import type { ProjectListEntry, ProjectStatus } from '@/features/projects/service';
import { readableId } from '@/features/workspace-ui/format';

type CatalogEntry = {
  id: string;
  title: string;
  skills: Array<{ id: string; name: string }>;
};

export type ProjectBenchFilter = { status?: ProjectStatus; skill?: string; course?: string };
export type ProjectFilterOption = { id: string; label: string };

/** Readable label for a skill or course id with no catalog name (never a "Skill ID:" prefix). */
export const readableProjectId = readableId;

export function projectBenchOptions(
  projects: readonly ProjectListEntry[],
  catalog: readonly CatalogEntry[],
  locale: Locale,
): { skills: ProjectFilterOption[]; courses: ProjectFilterOption[] } {
  const courseNames = new Map(catalog.map(course => [course.id, course.title]));
  const skillNames = new Map(catalog.flatMap(course => course.skills.map(skill => [skill.id, skill.name] as const)));
  const collator = new Intl.Collator(locale);
  const options = (ids: string[], names: Map<string, string>) => [...new Set(ids)]
    .map(id => ({ id, label: names.get(id) || readableProjectId(id) }))
    .sort((left, right) => collator.compare(left.label, right.label));
  return {
    skills: options(projects.flatMap(project => project.skills), skillNames),
    courses: options(projects.flatMap(project => project.courseIds), courseNames),
  };
}

/**
 * Proposal picker options straight from the learner catalog, so a course with
 * no project yet (or no skills) is still offered. Skills are deduplicated by id.
 */
export function projectProposalOptions(
  catalog: readonly CatalogEntry[],
  locale: Locale,
): { skills: ProjectFilterOption[]; courses: ProjectFilterOption[] } {
  const collator = new Intl.Collator(locale);
  const byLabel = (left: ProjectFilterOption, right: ProjectFilterOption) => collator.compare(left.label, right.label);
  const courses = new Map<string, ProjectFilterOption>();
  const skills = new Map<string, ProjectFilterOption>();
  for (const course of catalog) {
    if (!courses.has(course.id)) courses.set(course.id, { id: course.id, label: course.title || readableProjectId(course.id) });
    for (const skill of course.skills) {
      if (!skills.has(skill.id)) skills.set(skill.id, { id: skill.id, label: skill.name || readableProjectId(skill.id) });
    }
  }
  return { skills: [...skills.values()].sort(byLabel), courses: [...courses.values()].sort(byLabel) };
}

export function filterBenchProjects(
  projects: readonly ProjectListEntry[],
  filter: ProjectBenchFilter,
): ProjectListEntry[] {
  return projects.filter(project => (!filter.status || project.status === filter.status)
    && (!filter.skill || project.skills.includes(filter.skill))
    && (!filter.course || project.courseIds.includes(filter.course)));
}
