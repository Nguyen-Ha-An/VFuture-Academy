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
afterEach(() => vi.unstubAllEnvs());

describe("marketing discovery metadata", () => {
  it('excludes draft policies and only includes explicitly approved dated versions', async () => {
    vi.stubEnv('PUBLIC_POLICIES_APPROVED', 'false');
    expect((await sitemap()).some((entry) => /\/(privacy|terms)/.test(entry.url))).toBe(false);
    vi.stubEnv('PUBLIC_POLICIES_APPROVED', 'true');
    vi.stubEnv('PUBLIC_POLICIES_EFFECTIVE_DATE', '2026-09-21');
    const entries = await sitemap();
    expect(entries.filter((entry) => /\/(privacy|terms)/.test(entry.url))).toHaveLength(4);
    expect(entries.every((entry) => /\/(privacy|terms)(?:\?|$)/.test(entry.url))).toBe(true);
  });

  it("keeps private application surfaces out of crawler access", () => {
    expect(robots().rules).toEqual({
      userAgent: "*",
      allow: "/",
      disallow: ["/studio", "/app", "/api", "/home", "/learn", "/auth/", "/admin", "/grading"],
    });
  });
});
