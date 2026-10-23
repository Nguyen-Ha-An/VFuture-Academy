import "server-only";

import { unstable_cache } from "next/cache";
import {
  resolveL10nString,
  type L10nString,
  type Locale,
  type MediaRef,
} from "@/content-engine";
import {
  internalContentFingerprint,
  isInternalContentId,
  withoutInternalContent,
} from "@/lib/internal-content";
import { supabaseService } from "@/lib/supabase/server";
import { PUBLIC_CACHE_TAGS } from "@/features/marketing/public-cache";

export { MARKETING_SECTIONS, type MarketingSection } from "@/features/marketing/section-order";

export interface PublicSkill {
  id: string;
  name: string;
}

export interface PublicCourse {
  id: string;
  slug: string;
  title: string;
  summary: string;
  level: string;
  pathway: string;
  difficulty: string;
  estimatedMinutes?: number;
  skills: PublicSkill[];
  cover?: MediaRef;
  publishedAt?: string;
}

export interface PublicCourseItem {
  id: string;
  type: "lesson" | "exam" | "assignment";
  title: string;
  required: boolean;
  estimatedMinutes?: number;
}

export interface PublicCourseModule {
  id: string;
  title: string;
  items: PublicCourseItem[];
}

export interface PublicCourseDetail extends PublicCourse {
  learningOutcomes: string[];
  modules: PublicCourseModule[];
  relatedOpportunityIds: string[];
}

export interface PublicOpportunity {
  id: string;
  title: string;
  summary: string;
  organization?: string;
  applicationUrl?: string;
}

type UnknownRecord = Record<string, unknown>;

const PUBLIC_COURSE_OUTLINE_SELECT = `
  version_id,
  course_id,
  outline,
  meta,
  access,
  skills,
  default_language,
  course_versions!inner(published_at,manifest)
`;

const MAX_PUBLIC_COURSES = 500;
const PUBLIC_COURSE_REVALIDATE_SECONDS = 3600;

function recordOf(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function oneRecord(value: unknown): UnknownRecord | null {
  if (Array.isArray(value)) return recordOf(value[0]);
  return recordOf(value);
}

function localizedString(value: unknown, locale: Locale, defaultLocale: Locale) {
  if (typeof value === "string") return value;
  const map = recordOf(value);
  if (!map) return "";
  return resolveL10nString(map as L10nString, locale, defaultLocale);
}

function defaultLocaleOf(row: UnknownRecord): Locale {
  return row.default_language === "en" ? "en" : "vi";
}

function publishedCourseOf(row: UnknownRecord, course: UnknownRecord) {
  if (course.current_version_id !== row.version_id) return null;
  if (course.id !== row.course_id) return null;
  if (recordOf(row.access)?.scope !== "global") return null;
  return course;
}

function publicSkills(value: unknown, locale: Locale, defaultLocale: Locale): PublicSkill[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const skill = recordOf(entry);
    if (!skill || typeof skill.id !== "string") return [];
    return [{ id: skill.id, name: localizedString(skill.name, locale, defaultLocale) }];
  });
}

function publicCourseOf(
  row: UnknownRecord,
  publishedCourse: UnknownRecord,
  locale: Locale,
): PublicCourse | null {
  const course = publishedCourseOf(row, publishedCourse);
  const meta = recordOf(row.meta);
  if (!course || !meta || typeof course.id !== "string") return null;
  const defaultLocale = defaultLocaleOf(row);
  const estimatedMinutes =
    typeof meta.estimatedMinutes === "number" ? meta.estimatedMinutes : undefined;
  const cover = recordOf(meta.cover) as MediaRef | null;
  const publishedAt = oneRecord(row.course_versions)?.published_at;

  return {
    id: course.id,
    slug: typeof course.slug === "string" ? course.slug : course.id,
    title: localizedString(meta.title, locale, defaultLocale),
    summary: localizedString(meta.summary, locale, defaultLocale),
    level: typeof meta.level === "string" ? meta.level : "foundation",
    pathway: typeof meta.pathway === "string" ? meta.pathway : "core-future-skills",
    difficulty: typeof meta.difficulty === "string" ? meta.difficulty : "beginner",
    ...(estimatedMinutes !== undefined ? { estimatedMinutes } : {}),
    skills: publicSkills(row.skills, locale, defaultLocale),
    ...(cover ? { cover } : {}),
    ...(typeof publishedAt === "string" ? { publishedAt } : {}),
  };
}

function publicModules(value: unknown, locale: Locale, defaultLocale: Locale) {
  const outline = recordOf(value);
  if (!outline || !Array.isArray(outline.modules)) return [];

  return outline.modules.flatMap((moduleValue): PublicCourseModule[] => {
    const courseModule = recordOf(moduleValue);
    if (!courseModule || typeof courseModule.id !== "string") return [];
    const items = Array.isArray(courseModule.items)
      ? courseModule.items.flatMap((itemValue): PublicCourseItem[] => {
          const item = recordOf(itemValue);
          if (
            !item ||
            typeof item.id !== "string" ||
            !["lesson", "exam", "assignment"].includes(String(item.type))
          ) {
            return [];
          }
          const estimatedMinutes =
            typeof item.estimatedMinutes === "number" ? item.estimatedMinutes : undefined;
          return [
            {
              id: item.id,
              type: item.type as PublicCourseItem["type"],
              title: localizedString(item.title, locale, defaultLocale),
              required: item.required !== false,
              ...(estimatedMinutes !== undefined ? { estimatedMinutes } : {}),
            },
          ];
        })
      : [];
    return [
      {
        id: courseModule.id,
        title: localizedString(courseModule.title, locale, defaultLocale),
        items,
      },
    ];
  });
}

async function publishedCourseRows(
  client: ReturnType<typeof supabaseService>,
  limit: number,
  courseId?: string,
): Promise<UnknownRecord[]> {
  let query = client
      .from("courses")
      .select("id,slug,current_version_id")
      .eq("status", "published")
      .order("id", { ascending: true });
  if (courseId) query = query.eq("id", courseId);
  const { data, error } = await query.limit(Math.max(1, limit));
  if (error) throw new Error("Public courses could not be loaded");
  return Array.isArray(data) ? data.flatMap((row) => (recordOf(row) ? [row as UnknownRecord] : [])) : [];
}

async function publicCourseOutlineRows(
  client: ReturnType<typeof supabaseService>,
  currentVersionIds: string[],
): Promise<UnknownRecord[]> {
  if (currentVersionIds.length === 0) return [];
  const { data, error } = await client
      .from("course_version_outline")
      .select(PUBLIC_COURSE_OUTLINE_SELECT)
      .in("version_id", currentVersionIds)
      .eq("access->>scope", "global")
      .order("course_id", { ascending: true });
  if (error) throw new Error("Public course outlines could not be loaded");
  return Array.isArray(data) ? data.flatMap((row) => (recordOf(row) ? [row as UnknownRecord] : [])) : [];
}

async function listPublicCoursesUncached(locale: Locale): Promise<PublicCourse[]> {
  const client = supabaseService();
  const courses = await publishedCourseRows(client, MAX_PUBLIC_COURSES);
  const versionIds = courses.flatMap((course) =>
    typeof course.current_version_id === "string" ? [course.current_version_id] : [],
  );
  const outlines = await publicCourseOutlineRows(client, versionIds);
  const outlinesByVersion = new Map(
    outlines.flatMap((row) =>
      typeof row.version_id === "string" ? [[row.version_id, row] as const] : [],
    ),
  );

  return courses.flatMap((course) => {
    if (typeof course.current_version_id !== "string") return [];
    const row = outlinesByVersion.get(course.current_version_id);
    if (!row) return [];
    const publicCourse = publicCourseOf(row, course, locale);
    return publicCourse ? [publicCourse] : [];
  });
}

const listPublicCoursesCached = unstable_cache(
  listPublicCoursesUncached,
  ["marketing-public-courses", internalContentFingerprint()],
  { revalidate: PUBLIC_COURSE_REVALIDATE_SECONDS, tags: [PUBLIC_CACHE_TAGS.courses] },
);

export async function listPublicCourses(
  locale: Locale,
  { limit = 6 }: { limit?: number } = {},
): Promise<PublicCourse[]> {
  const safeLimit = Math.min(Math.max(1, limit), MAX_PUBLIC_COURSES);
  // The guard runs on the cached value, so a warm cache can never re-surface fixtures.
  return withoutInternalContent(await listPublicCoursesCached(locale), (course) => course.id).slice(0, safeLimit);
}

async function getPublicCourseUncached(
  courseId: string,
  locale: Locale,
): Promise<PublicCourseDetail | null> {
  const client = supabaseService();
  const courses = await publishedCourseRows(client, 1, courseId);
  const course = courses[0];
  if (!course || typeof course.current_version_id !== "string") return null;
  const rows = await publicCourseOutlineRows(client, [course.current_version_id]);
  for (const row of rows) {
    const publicCourse = publicCourseOf(row, course, locale);
    if (!publicCourse || publicCourse.id !== courseId) continue;
    const meta = recordOf(row.meta);
    const defaultLocale = defaultLocaleOf(row);
    return {
      ...publicCourse,
      learningOutcomes: Array.isArray(meta?.learningOutcomes)
        ? meta.learningOutcomes.map((outcome) => localizedString(outcome, locale, defaultLocale))
        : [],
      modules: publicModules(row.outline, locale, defaultLocale),
      relatedOpportunityIds: (() => {
        const manifest = recordOf(oneRecord(row.course_versions)?.manifest);
        return Array.isArray(manifest?.relatedOpportunities)
          ? manifest.relatedOpportunities.filter((id): id is string => typeof id === "string")
          : [];
      })(),
    };
  }
  return null;
}

const getPublicCourseCached = unstable_cache(
  getPublicCourseUncached,
  ["marketing-public-course", internalContentFingerprint()],
  { revalidate: PUBLIC_COURSE_REVALIDATE_SECONDS, tags: [PUBLIC_CACHE_TAGS.courses] },
);

export async function getPublicCourse(
  courseId: string,
  locale: Locale,
): Promise<PublicCourseDetail | null> {
  if (isInternalContentId(courseId)) return null;
  return getPublicCourseCached(courseId, locale);
}

function textFromRichContent(value: unknown) {
  const richContent = recordOf(value);
  if (!richContent || !Array.isArray(richContent.blocks)) return "";
  const text = richContent.blocks.flatMap((blockValue) => {
    const block = recordOf(blockValue);
    if (!block || !Array.isArray(block.content)) return [];
    return block.content.flatMap((runValue) => {
      const run = recordOf(runValue);
      return typeof run?.text === "string" ? [run.text] : [];
    });
  });
  return text.join(" ").trim();
}

function safeApplicationUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function publicOpportunityOf(value: unknown, locale: Locale): PublicOpportunity | null {
  const opportunity = recordOf(value);
  if (!opportunity || typeof opportunity.id !== "string") return null;
  const localizedDescription = recordOf(opportunity.description)?.[locale]
    ?? recordOf(opportunity.description)?.vi
    ?? recordOf(opportunity.description)?.en
    ?? opportunity.description;
  const applicationUrl = safeApplicationUrl(opportunity.application_url);
  return {
    id: opportunity.id,
    title: localizedString(opportunity.title, locale, "vi"),
    summary: textFromRichContent(localizedDescription),
    ...(typeof opportunity.organization === "string" ? { organization: opportunity.organization } : {}),
    ...(applicationUrl ? { applicationUrl } : {}),
  };
}

export async function listPublicOpportunitiesByIds(
  locale: Locale,
  ids: string[],
): Promise<PublicOpportunity[]> {
  const requested = withoutInternalContent([...new Set(ids)], (id) => id).slice(0, 20);
  if (requested.length === 0) return [];
  const { data, error } = await supabaseService()
      .from("opportunities")
      .select("id,title,organization,description,application_url,status,branch_scope")
      .in("id", requested)
      .eq("status", "published")
      .eq("branch_scope->>scope", "global")
      .limit(20);
  if (error) throw new Error("Public opportunities could not be loaded");
  return Array.isArray(data) ? data.flatMap((value) => {
      const opportunity = publicOpportunityOf(value, locale);
      return opportunity ? [opportunity] : [];
    }) : [];
}

export async function listFeaturedOpportunities(
  locale: Locale,
  { limit = 3 }: { limit?: number } = {},
): Promise<PublicOpportunity[]> {
  const now = new Date();
    const { data, error } = await supabaseService()
      .from("opportunities")
      .select("id,title,organization,description,application_url,status,featured,open_at,close_at")
      .eq("status", "published")
      .eq("featured", true)
      .eq("branch_scope->>scope", "global")
      .order("open_at", { ascending: false })
      .limit(Math.min(Math.max(limit * 3, 3), 30));
  if (error) throw new Error("Featured opportunities could not be loaded");
  if (!Array.isArray(data)) return [];

    return data.flatMap((value): PublicOpportunity[] => {
      const opportunity = recordOf(value);
      if (!opportunity || (typeof opportunity.id === "string" && isInternalContentId(opportunity.id))) return [];
      const opensAt = typeof opportunity.open_at === "string" ? new Date(opportunity.open_at) : null;
      const closesAt = typeof opportunity.close_at === "string" ? new Date(opportunity.close_at) : null;
      if ((opensAt && opensAt > now) || (closesAt && closesAt < now)) return [];
      const publicOpportunity = publicOpportunityOf(opportunity, locale);
      return publicOpportunity ? [publicOpportunity] : [];
    }).slice(0, Math.min(Math.max(limit, 1), 10));
}
