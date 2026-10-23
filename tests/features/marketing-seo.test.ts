import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://academy.example" },
}));
vi.mock("@/features/marketing/public-courses", () => ({
  listPublicCourses: vi.fn().mockResolvedValue([
    {
      id: "ai-foundations",
      slug: "ai-foundations",
      publishedAt: "2026-09-01T09:30:00.000Z",
    },
  ]),
}));
vi.mock('@/features/marketing/public-discovery', () => ({
  listPublicResources: vi.fn().mockResolvedValue({ items: [{ id: 'guide', publishedAt: '2026-09-02T00:00:00Z' }], total: 1, page: 1, pageSize: 50 }),
  listPublicOpportunities: vi.fn().mockResolvedValue({ items: [{ id: 'sprint', publishedAt: '2026-09-03T00:00:00Z' }], total: 1, page: 1, pageSize: 50 }),
  listPublicProjects: vi.fn().mockResolvedValue({ items: [{ id: 'robot', updatedAt: '2026-09-04T00:00:00Z' }], total: 1, page: 1, pageSize: 50 }),
}));

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { listPublicCourses } from "@/features/marketing/public-courses";
import { listPublicOpportunities, listPublicProjects, listPublicResources } from "@/features/marketing/public-discovery";
afterEach(() => vi.unstubAllEnvs());

describe("marketing discovery metadata", () => {
  it("lists the landing, catalog and each public course in the sitemap", async () => {
    const entries = await sitemap();

    expect(entries.filter((entry) => !entry.url.includes('?')).map((entry) => entry.url)).toEqual([
      "https://academy.example/",
      "https://academy.example/courses",
      "https://academy.example/contact",
      "https://academy.example/courses/ai-foundations",
      'https://academy.example/resources',
      'https://academy.example/opportunities',
      'https://academy.example/projects',
      'https://academy.example/resources/guide',
      'https://academy.example/opportunities/sprint',
      'https://academy.example/projects/robot',
    ]);
    expect(entries.at(-1)?.lastModified).toBe("2026-09-04T00:00:00Z");
    expect(entries.filter((entry) => entry.url.includes('?lang=en'))).toHaveLength(entries.length / 2);
    expect(entries[0].alternates?.languages).toEqual({ vi: 'https://academy.example/', en: 'https://academy.example/?lang=en', 'x-default': 'https://academy.example/' });
  });

  it('excludes draft policies and only includes explicitly approved dated versions', async () => {
    vi.stubEnv('PUBLIC_POLICIES_APPROVED', 'false');
    expect((await sitemap()).some((entry) => /\/(privacy|terms)/.test(entry.url))).toBe(false);
    vi.stubEnv('PUBLIC_POLICIES_APPROVED', 'true');
    vi.stubEnv('PUBLIC_POLICIES_EFFECTIVE_DATE', '2026-09-21');
    expect((await sitemap()).filter((entry) => /\/(privacy|terms)/.test(entry.url))).toHaveLength(4);
  });

  it("omits internal fixtures from the sitemap only while HIDE_INTERNAL_CONTENT is 1", async () => {
    const withFixtures = () => {
      vi.mocked(listPublicCourses).mockResolvedValueOnce([{ id: "ai-foundations" }, { id: "recovery-course" }] as never);
      vi.mocked(listPublicResources).mockResolvedValueOnce({ items: [{ id: "recovery-resource" }], total: 1, page: 1, pageSize: 50 } as never);
      vi.mocked(listPublicOpportunities).mockResolvedValueOnce({ items: [{ id: "schema-stress" }], total: 1, page: 1, pageSize: 50 } as never);
      vi.mocked(listPublicProjects).mockResolvedValueOnce({ items: [{ id: "recovery-project", updatedAt: "2026-09-04T00:00:00Z" }], total: 1, page: 1, pageSize: 50 } as never);
    };
    const fixtureUrls = (entries: Awaited<ReturnType<typeof sitemap>>) => entries.map((entry) => entry.url).filter((url) => /recovery-|schema-stress/.test(url));

    withFixtures();
    expect(fixtureUrls(await sitemap())).toHaveLength(8);

    vi.stubEnv("HIDE_INTERNAL_CONTENT", "1");
    vi.stubEnv("INTERNAL_CONTENT_IDS", "schema-stress");
    withFixtures();
    const entries = await sitemap();
    expect(fixtureUrls(entries)).toEqual([]);
    expect(entries.map((entry) => entry.url)).toContain("https://academy.example/courses/ai-foundations");
  });

  it("keeps private application surfaces out of crawler access", () => {
    expect(robots().rules).toEqual({
      userAgent: "*",
      allow: "/",
      disallow: ["/studio", "/app", "/api", "/home", "/learn", "/auth/", "/admin", "/grading"],
    });
  });
});
