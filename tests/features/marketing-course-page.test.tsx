// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import viMessages from "@/messages/vi.json";

vi.mock("server-only", () => ({}));
vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://labs.example.test' } }));
vi.mock('@/features/public-site/PublicStickyAction', () => ({ PublicStickyAction: () => null }));



const mocks = vi.hoisted(() => ({
  getPublicCourse: vi.fn(),
  listPublicOpportunitiesByIds: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn().mockResolvedValue("en"),
  getTranslations: vi.fn().mockResolvedValue(
    (key: string, values?: Record<string, string | number>) =>
      values ? `${key}:${Object.values(values).join(":")}` : key,
  ),
}));

vi.mock("@/features/marketing/public-courses", () => ({
  getPublicCourse: mocks.getPublicCourse,
  listPublicOpportunitiesByIds: mocks.listPublicOpportunitiesByIds,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/courses/ai-foundations",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
  notFound: vi.fn(() => {
    throw new Error("not_found");
  }),
}));

import PublicCoursePage from "@/app/(public)/courses/[courseId]/page";

afterEach(cleanup);

describe("public course page", () => {
  beforeEach(() => {
    mocks.listPublicOpportunitiesByIds.mockResolvedValue([]);
  });

  it("labels the learner handoff accurately in both locales", () => {
    expect(en.marketing.course.continueToCourse).toBe("Continue to course");
    expect(viMessages.marketing.course.continueToCourse).toBe("Tiếp tục đến khoá học");
  });

  it("renders repeated outcome text without duplicate React keys", async () => {
    mocks.getPublicCourse.mockResolvedValueOnce({
      id: "ai-foundations",
      slug: "ai-foundations",
      title: "AI Foundations",
      summary: "Understand AI and build a product.",
      level: "foundation",
      pathway: "ai-emerging-technology",
      difficulty: "beginner",
      estimatedMinutes: 240,
      skills: [],
      learningOutcomes: ["Explain AI.", "Explain AI."],
      modules: [],
      relatedOpportunityIds: [],
    });
    const reactErrors: unknown[][] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      reactErrors.push(args);
    });

    render(await PublicCoursePage({
      params: Promise.resolve({ courseId: "ai-foundations" }),
    }));

    errorSpy.mockRestore();
    expect(reactErrors.flat().join(" ")).not.toContain("same key");
  });

  it("renders published related opportunities from the course manifest", async () => {
    mocks.getPublicCourse.mockResolvedValueOnce({
      id: "ai-foundations", slug: "ai-foundations", title: "AI Foundations", summary: "Build.",
      level: "foundation", pathway: "ai-emerging-technology", difficulty: "beginner",
      skills: [], learningOutcomes: [], modules: [], relatedOpportunityIds: ["build-sprint"],
    });
    mocks.listPublicOpportunitiesByIds.mockResolvedValueOnce([
      { id: "build-sprint", title: "Build sprint", summary: "Ship something." },
    ]);

    render(await PublicCoursePage({ params: Promise.resolve({ courseId: "ai-foundations" }) }));

    expect(screen.getByRole("link", { name: "course.continueToCourse" }).getAttribute("href"))
      .toBe("/app/courses/ai-foundations");
    expect(screen.getByRole("link", { name: "Build sprint" }).getAttribute("href")).toBe("/opportunities/build-sprint?lang=en");
    expect(mocks.listPublicOpportunitiesByIds).toHaveBeenCalledWith("en", ["build-sprint"]);
  });
});

describe('public course contextual navigation', () => {
  it('preserves pathway and page on back while keeping protected continuation exact', async () => {
    mocks.getPublicCourse.mockResolvedValue({ id: 'ai-foundations', slug: 'ai-foundations', title: 'AI Foundations', summary: 'Build.', level: 'foundation', pathway: 'ai-emerging-technology', difficulty: 'beginner', skills: [], learningOutcomes: [], modules: [], relatedOpportunityIds: [] });
    mocks.listPublicOpportunitiesByIds.mockResolvedValue([]);
    render(await PublicCoursePage({ params: Promise.resolve({ courseId: 'ai-foundations' }), searchParams: Promise.resolve({ pathway: 'ai-emerging-technology', page: '2', returnTo: 'https://untrusted.example/' }) }));
    expect(screen.getByRole('link', { name: 'course.back' }).getAttribute('href')).toBe('/courses?pathway=ai-emerging-technology&page=2&lang=en');
    expect(screen.getByRole('link', { name: 'course.continueToCourse' }).getAttribute('href')).toBe('/app/courses/ai-foundations');
    expect(document.querySelectorAll('h1')).toHaveLength(1);
  });
});
