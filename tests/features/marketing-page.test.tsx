// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { CourseCard } from "@/features/marketing/CourseCard";
import { LandingSections } from "@/features/marketing/LandingSections";
import { MARKETING_SECTIONS } from "@/features/marketing/section-order";
import { Faq } from "@/features/marketing/sections/Faq";
import { OpportunitiesTeaser } from "@/features/marketing/sections/OpportunitiesTeaser";

vi.mock("next/image", async () => {
  const { createElement } = await import("react");
  return {
    default: (props: React.ImgHTMLAttributes<HTMLImageElement>) =>
      createElement("img", props),
  };
});

const course = {
  id: "ai-foundations",
  slug: "ai-foundations",
  title: "AI Foundations",
  summary: "Understand AI and build a product.",
  level: "foundation",
  pathway: "ai-emerging-technology",
  difficulty: "beginner",
  estimatedMinutes: 240,
  skills: [{ id: "ai-literacy", name: "AI literacy" }],
};

function Provider({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>;
}

afterEach(cleanup);

describe("marketing landing page", () => {
  it("renders its sections in MARKETING_SECTIONS order", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <LandingSections
          courses={[course]}
          opportunities={[
            {
              id: "build-sprint",
              title: "Build sprint",
              summary: "Ship a real product with a mentor.",
            },
          ]}
        />
      </NextIntlClientProvider>,
    );

    expect(
      [...container.querySelectorAll("[data-marketing-section]")].map((node) =>
        node.getAttribute("data-marketing-section"),
      ),
    ).toEqual(MARKETING_SECTIONS);
  });

  it("keeps empty future-data sections hidden without breaking narrative order", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <LandingSections courses={[]} opportunities={[]} />
      </NextIntlClientProvider>,
    );

    expect(
      [...container.querySelectorAll("[data-marketing-section]")].map((node) =>
        node.getAttribute("data-marketing-section"),
      ),
    ).toEqual(MARKETING_SECTIONS);
    expect(container.querySelector('[data-marketing-section="featured-courses"]')?.hasAttribute("hidden")).toBe(true);
    expect(container.querySelector('[data-marketing-section="opportunities"]')?.hasAttribute("hidden")).toBe(true);
  });

  it('exposes all four public discovery entry points', () => {
    render(<Provider><LandingSections courses={[]} opportunities={[]} /></Provider>);
    expect(screen.getByRole('link', { name: /01 Courses/ }).getAttribute('href')).toBe('/courses');
    expect(screen.getByRole('link', { name: /02 Resources/ }).getAttribute('href')).toBe('/resources');
    expect(screen.getByRole('link', { name: /03 Opportunities/ }).getAttribute('href')).toBe('/opportunities');
    expect(screen.getByRole('link', { name: /04 Projects/ }).getAttribute('href')).toBe('/projects');
  });

  it("links every teaser card to its real opportunity detail route", () => {
    render(
      <Provider>
        <OpportunitiesTeaser opportunities={[
          {
            id: "external-opportunity",
            title: "External opportunity",
            summary: "Apply on the organizer site.",
            applicationUrl: "https://opportunities.example/apply",
          },
          {
            id: "future-detail-page",
            title: "Future detail page",
            summary: "Applications are not open yet.",
          },
        ]} />
      </Provider>,
    );

    const externalLink = screen.getByRole("link", { name: /External opportunity/ });
    expect(externalLink.getAttribute("href")).toBe("/opportunities/external-opportunity");
    expect(externalLink.getAttribute("target")).toBeNull();
    expect(externalLink.closest("article")?.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Future detail page/ }).getAttribute("href")).toBe("/opportunities/future-detail-page");
  });

  it("renders a course cover image with responsive sizing and a neutral absent-cover placeholder", () => {
    const { container, rerender } = render(
      <Provider>
        <CourseCard
          course={{
            ...course,
            cover: {
              url: "https://project.supabase.co/storage/v1/object/public/media/course-cover.png",
            },
          }}
        />
      </Provider>,
    );

    const image = screen.getByRole("img", { name: "AI Foundations" });
    expect(image.getAttribute("src")).toBe(
      "https://project.supabase.co/storage/v1/object/public/media/course-cover.png",
    );
    expect(image.hasAttribute("sizes")).toBe(true);

    rerender(<Provider><CourseCard course={course} /></Provider>);
    expect(screen.queryByRole("img", { name: "AI Foundations" })).toBeNull();
    expect(container.querySelector("[data-course-cover-placeholder]")).not.toBeNull();
  });

  it('resolves asset-backed course covers through the public media route', () => {
    render(<Provider><CourseCard course={{ ...course, cover: { assetId: 'cover one' } }} /></Provider>);
    expect(screen.getByRole('img', { name: 'AI Foundations' }).getAttribute('src')).toBe('/api/v1/public/media/cover%20one');
  });

  it("labels visual groups without aria-label on role-less divs", () => {
    const { container } = render(
      <Provider>
        <LandingSections courses={[course]} opportunities={[]} />
      </Provider>,
    );

    expect(container.querySelectorAll("div[aria-label]:not([role])")).toHaveLength(0);
  });

  it("styles the FAQ icon from the native details open state", () => {
    const { container } = render(<Provider><Faq /></Provider>);
    const details = container.querySelector("details");
    const icon = details?.querySelector("summary svg");

    expect(icon?.classList.contains("group-open:rotate-45")).toBe(true);
  });
});
