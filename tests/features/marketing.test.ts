import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import viMessages from "@/messages/vi.json";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  cache: new Map<string, Promise<unknown>>(),
  supabaseService: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: (...args: unknown[]) => unknown,
    keyParts: string[],
  ) => (...args: unknown[]) => {
    const key = JSON.stringify([keyParts, args]);
    if (!mocks.cache.has(key)) mocks.cache.set(key, Promise.resolve(fn(...args)));
    return mocks.cache.get(key);
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseService: mocks.supabaseService,
}));

import {
  MARKETING_SECTIONS,
  getPublicCourse,
  listFeaturedOpportunities,
  listPublicOpportunitiesByIds,
  listPublicCourses,
} from "@/features/marketing/public-courses";

type QueryResult = { data: unknown[] | null; error: { code?: string; message: string } | null };

function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function chainableQuery(rows: unknown[], error: QueryResult["error"] = null) {
  const filters: Array<(row: unknown) => boolean> = [];
  let orderBy: string | undefined;
  let ascending = true;
  let rowLimit: number | undefined;
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      let data = rows.filter((row) => filters.every((filter) => filter(row)));
      if (orderBy) {
        data = [...data].sort((left, right) => {
          const leftValue = String(valueAtPath(left, orderBy ?? "") ?? "");
          const rightValue = String(valueAtPath(right, orderBy ?? "") ?? "");
          return leftValue.localeCompare(rightValue) * (ascending ? 1 : -1);
        });
      }
      if (rowLimit !== undefined) data = data.slice(0, rowLimit);
      return Promise.resolve({ data, error }).then(resolve, reject);
    },
  };

  query.select.mockReturnValue(query);
  query.eq.mockImplementation((path: string, expected: unknown) => {
    if (path === "access->>scope" || path === "branch_scope->>scope") {
      const objectPath = path === "access->>scope" ? "access.scope" : "branch_scope.scope";
      filters.push((row) => valueAtPath(row, objectPath) === expected);
    } else {
      filters.push((row) => valueAtPath(row, path) === expected);
    }
    return query;
  });
  query.in.mockImplementation((path: string, expected: unknown[]) => {
    filters.push((row) => expected.includes(valueAtPath(row, path)));
    return query;
  });
  query.order.mockImplementation((path: string, options?: { ascending?: boolean }) => {
    orderBy = path;
    ascending = options?.ascending !== false;
    return query;
  });
  query.limit.mockImplementation((value: number) => {
    rowLimit = value;
    return query;
  });
  return query;
}

function courseRow({
  courseId = "ai-foundations",
  currentVersionId = "version-1",
  status = "published",
}: {
  courseId?: string;
  currentVersionId?: string;
  status?: "draft" | "published" | "archived";
} = {}) {
  return {
    id: courseId,
    slug: courseId,
    status,
    current_version_id: currentVersionId,
  };
}

function outlineRow({
  access = { scope: "global" },
  courseId = "ai-foundations",
  currentVersionId = "version-1",
  status = "published",
  versionId = "version-1",
}: {
  access?: { scope: "global" } | { scope: "branches"; branchIds: string[] };
  courseId?: string;
  currentVersionId?: string;
  status?: "draft" | "published" | "archived";
  versionId?: string;
} = {}) {
  return {
    version_id: versionId,
    course_id: courseId,
    access,
    default_language: "vi",
    meta: {
      title: { vi: "Nền tảng AI", en: "AI Foundations" },
      summary: { vi: "Hiểu AI và xây sản phẩm.", en: "Understand AI and build a product." },
      level: "foundation",
      pathway: "ai-emerging-technology",
      difficulty: "beginner",
      estimatedMinutes: 240,
      learningOutcomes: [
        { vi: "Giải thích AI.", en: "Explain AI." },
      ],
      cover: { assetId: "asset-cover" },
    },
    skills: [
      { id: "ai-literacy", name: { vi: "Hiểu biết AI", en: "AI literacy" } },
    ],
    outline: {
      modules: [
        {
          id: "m1",
          title: { vi: "Toàn cảnh AI", en: "The AI landscape" },
          items: [
            {
              id: "what-is-ai",
              type: "lesson",
              title: { vi: "AI là gì?", en: "What is AI?" },
              required: true,
              source: { blocks: [{ type: "paragraph", content: "must not leak" }] },
            },
          ],
        },
      ],
    },
    course_versions: {
      published_at: "2026-09-01T09:30:00.000Z",
      manifest: { relatedOpportunities: ["build-sprint"] },
      course_id: courseId,
      courses: {
        id: courseId,
        slug: courseId,
        status,
        current_version_id: currentVersionId,
      },
    },
  };
}

function installTables({
  courses = [],
  outlines = [],
  opportunities = [],
}: {
  courses?: unknown[];
  outlines?: unknown[];
  opportunities?: unknown[];
}) {
  mocks.supabaseService.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === "courses") return chainableQuery(courses);
      if (table === "course_version_outline") return chainableQuery(outlines);
      if (table === "opportunities") return chainableQuery(opportunities);
      throw new Error(`Unexpected table: ${table}`);
    }),
  });
}

function leafKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("public marketing courses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cache.clear();
  });

  it("returns only current published global outlines and localizes their card metadata", async () => {
    installTables({
      courses: [
        courseRow(),
        courseRow({ courseId: "draft-course", currentVersionId: "draft-version-1", status: "draft" }),
        courseRow({ courseId: "branch-course", currentVersionId: "branch-version-1" }),
        courseRow({ courseId: "old-version", currentVersionId: "old-version-2" }),
      ],
      outlines: [
        outlineRow(),
        outlineRow({ courseId: "draft-course", currentVersionId: "draft-version-1", status: "draft", versionId: "draft-version-1" }),
        outlineRow({ courseId: "branch-course", currentVersionId: "branch-version-1", versionId: "branch-version-1", access: { scope: "branches", branchIds: ["vinsmc"] } }),
        outlineRow({ courseId: "old-version", currentVersionId: "old-version-2", versionId: "old-version-1" }),
      ],
    });

    await expect(listPublicCourses("en", { limit: 6 })).resolves.toEqual([
      {
        id: "ai-foundations",
        slug: "ai-foundations",
        title: "AI Foundations",
        summary: "Understand AI and build a product.",
        level: "foundation",
        pathway: "ai-emerging-technology",
        difficulty: "beginner",
        estimatedMinutes: 240,
        skills: [{ id: "ai-literacy", name: "AI literacy" }],
        cover: { assetId: "asset-cover" },
        publishedAt: "2026-09-01T09:30:00.000Z",
      },
    ]);
  });

  it("lists all 50 published courses when each has several versions", async () => {
    const courses = Array.from({ length: 50 }, (_, index) => {
      const courseId = `course-${String(index + 1).padStart(2, "0")}`;
      return courseRow({ courseId, currentVersionId: `${courseId}-version-5` });
    });
    const outlines = courses.flatMap((course) =>
      Array.from({ length: 5 }, (_, index) => outlineRow({
        courseId: course.id,
        currentVersionId: course.current_version_id,
        versionId: `${course.id}-version-${index + 1}`,
      })),
    );
    installTables({ courses, outlines });

    const result = await listPublicCourses("en", { limit: 50 });

    expect(result).toHaveLength(50);
    expect(result.map((course) => course.id)).toEqual(courses.map((course) => course.id));
  });

  it("resolves a current course version after 24 historical versions", async () => {
    const course = courseRow({ currentVersionId: "version-25" });
    const outlines = Array.from({ length: 25 }, (_, index) => outlineRow({
      currentVersionId: course.current_version_id,
      versionId: `version-${index + 1}`,
    }));
    installTables({ courses: [course], outlines });

    await expect(getPublicCourse("ai-foundations", "en")).resolves.toMatchObject({
      id: "ai-foundations",
      title: "AI Foundations",
    });
  });

  it("reuses the locale catalog cache within the revalidation window", async () => {
    installTables({ courses: [courseRow()], outlines: [outlineRow()] });

    await listPublicCourses("en", { limit: 6 });
    await listPublicCourses("en", { limit: 6 });

    const client = mocks.supabaseService.mock.results[0]?.value as { from: ReturnType<typeof vi.fn> };
    expect(mocks.supabaseService).toHaveBeenCalledTimes(1);
    expect(client.from).toHaveBeenCalledTimes(2);
  });

  it("propagates a public course database failure instead of reporting an empty catalog", async () => {
    mocks.supabaseService.mockReturnValue({
      from: vi.fn(() => chainableQuery([], { message: "database offline" })),
    });

    await expect(listPublicCourses("en", { limit: 6 })).rejects.toThrow(
      "Public courses could not be loaded",
    );
  });

  it("reuses the locale-and-course detail cache within the revalidation window", async () => {
    installTables({ courses: [courseRow()], outlines: [outlineRow()] });

    await getPublicCourse("ai-foundations", "en");
    await getPublicCourse("ai-foundations", "en");

    const client = mocks.supabaseService.mock.results[0]?.value as { from: ReturnType<typeof vi.fn> };
    expect(mocks.supabaseService).toHaveBeenCalledTimes(1);
    expect(client.from).toHaveBeenCalledTimes(2);
  });

  it("returns localized outcomes and outline titles without item bodies", async () => {
    installTables({ courses: [courseRow()], outlines: [outlineRow()] });

    const course = await getPublicCourse("ai-foundations", "en");

    expect(course).toMatchObject({
      id: "ai-foundations",
      learningOutcomes: ["Explain AI."],
      modules: [
        {
          id: "m1",
          title: "The AI landscape",
          items: [
            {
              id: "what-is-ai",
              type: "lesson",
              title: "What is AI?",
              required: true,
            },
          ],
        },
      ],
      relatedOpportunityIds: ["build-sprint"],
    });
    expect(JSON.stringify(course)).not.toContain("must not leak");
    expect(JSON.stringify(course)).not.toContain("source");
  });

  it("does not expose an unsafe opportunity application URL", async () => {
    installTables({ opportunities: [{
      id: "build-sprint",
      title: { vi: "Cuộc thi xây dựng", en: "Build sprint" },
      description: { en: { blocks: [] } },
      application_url: "javascript:alert(1)",
      status: "published",
      featured: true,
      branch_scope: { scope: "global" },
      open_at: null,
      close_at: null,
    }] });

    await expect(listFeaturedOpportunities("en", { limit: 3 })).resolves.toEqual([
      { id: "build-sprint", title: "Build sprint", summary: "" },
    ]);
  });

  it("loads only requested published global opportunities for related course links", async () => {
    installTables({ opportunities: [
      { id: "build-sprint", title: { en: "Build sprint" }, description: { en: { blocks: [] } }, status: "published", branch_scope: { scope: "global" } },
      { id: "other", title: { en: "Other" }, description: { en: { blocks: [] } }, status: "published", branch_scope: { scope: "global" } },
      { id: "private", title: { en: "Private" }, description: { en: { blocks: [] } }, status: "published", branch_scope: { scope: "branches", branchIds: ["one"] } },
    ] });

    await expect(listPublicOpportunitiesByIds("en", ["build-sprint", "private"])).resolves.toEqual([
      { id: "build-sprint", title: "Build sprint", summary: "" },
    ]);
  });

  describe("internal fixture guard", () => {
    afterEach(() => vi.unstubAllEnvs());
    const fixtureTables = () => installTables({
      courses: [courseRow(), courseRow({ courseId: "recovery-course", currentVersionId: "recovery-version-1" })],
      outlines: [outlineRow(), outlineRow({ courseId: "recovery-course", currentVersionId: "recovery-version-1", versionId: "recovery-version-1" })],
      opportunities: [
        { id: "build-sprint", title: { en: "Build sprint" }, description: { en: { blocks: [] } }, status: "published", featured: true, branch_scope: { scope: "global" }, open_at: null, close_at: null },
        { id: "recovery-opportunity", title: { en: "Fixture" }, description: { en: { blocks: [] } }, status: "published", featured: true, branch_scope: { scope: "global" }, open_at: null, close_at: null },
      ],
    });

    it("lists fixtures while HIDE_INTERNAL_CONTENT is unset", async () => {
      fixtureTables();
      expect((await listPublicCourses("en", { limit: 6 })).map(({ id }) => id)).toEqual(["ai-foundations", "recovery-course"]);
      await expect(getPublicCourse("recovery-course", "en")).resolves.toMatchObject({ id: "recovery-course" });
      expect((await listFeaturedOpportunities("en", { limit: 3 })).map(({ id }) => id)).toEqual(["build-sprint", "recovery-opportunity"]);
    });

    it("hides fixtures from a cached course list even when the cache already holds them", async () => {
      fixtureTables();
      // Warm the cache before the flag flips, as a deployment with a persisted Data Cache would.
      expect(await listPublicCourses("en", { limit: 6 })).toHaveLength(2);
      await getPublicCourse("recovery-course", "en");
      vi.stubEnv("HIDE_INTERNAL_CONTENT", "1");

      expect((await listPublicCourses("en", { limit: 6 })).map(({ id }) => id)).toEqual(["ai-foundations"]);
      await expect(getPublicCourse("recovery-course", "en")).resolves.toBeNull();
      expect(mocks.supabaseService).toHaveBeenCalledTimes(2);
    });

    it("drops fixtures from featured and related opportunity links", async () => {
      vi.stubEnv("HIDE_INTERNAL_CONTENT", "1");
      fixtureTables();
      expect((await listFeaturedOpportunities("en", { limit: 3 })).map(({ id }) => id)).toEqual(["build-sprint"]);
      expect((await listPublicOpportunitiesByIds("en", ["build-sprint", "recovery-opportunity"])).map(({ id }) => id)).toEqual(["build-sprint"]);
    });
  });
});

describe("marketing contracts", () => {
  it("keeps every marketing message leaf available in both locales", () => {
    expect(leafKeys(viMessages.marketing).sort()).toEqual(leafKeys(en.marketing).sort());
  });

  it("keeps the approved bilingual headline verbatim", () => {
    expect(viMessages.marketing.hero.headline).toBe(
      "Học AI, công nghệ và kỹ năng tương lai — rồi tạo ra sản phẩm thật",
    );
    expect(en.marketing.hero.headline).toBe(
      "Learn AI, technology and future skills, then build something real",
    );
  });

  it("keeps the public landing sections in the approved narrative order", () => {
    expect(MARKETING_SECTIONS).toEqual([
      "hero",
      "loop",
      "ecosystem",
      "pathways",
      "how-it-works",
      "featured-courses",
      "opportunities",
      "participation",
      "for-schools",
      "faq",
      "call-to-action",
    ]);
  });
});
