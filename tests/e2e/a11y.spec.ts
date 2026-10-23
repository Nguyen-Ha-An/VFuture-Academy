import { writeFile } from "node:fs/promises";
import type { Page } from "@playwright/test";

import course from "../../src/content-engine/fixtures/ai-foundations/course.json";
import assignment from "../../src/content-engine/fixtures/ai-foundations/items/final-product.json";
import exam from "../../src/content-engine/fixtures/ai-foundations/items/exam-m1.json";
import lesson from "../../src/content-engine/fixtures/ai-foundations/items/what-is-ai.json";
import en from "../../src/messages/en.json";
import vi from "../../src/messages/vi.json";
import {
  expectNoOwnedWcagViolations,
  expectNoWcagViolations,
  KNOWN_YOUTUBE_PLAYER_FINDINGS,
} from "./support/accessibility";
import { setLocale } from "./support/auth";
import { test, expect } from "./support/fixtures";
import { ensureEnrolled } from "./support/learning";

const localeCases = [
  {
    code: "vi" as const,
    messages: vi,
    title: (value: { vi: string; en: string }) => value.vi,
    assignmentSubmit: "Nộp bài",
    quizTitle: "Kiểm tra nhanh",
  },
  {
    code: "en" as const,
    messages: en,
    title: (value: { vi: string; en: string }) => value.en,
    assignmentSubmit: "Submit assignment",
    quizTitle: "Quick check",
  },
];

async function expectLocale(page: Page, locale: "vi" | "en") {
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

test.describe("@recovery-15 public WCAG 2.2 AA surfaces", () => {
  for (const locale of localeCases) {
    const pages = [
      { name: "landing", path: "/", heading: `${locale.messages.academyGateway.hero.titleLead} ${locale.messages.academyGateway.hero.titleEmphasis}` },
      { name: "academy", path: "/academy", heading: `${locale.messages.academyGateway.hero.titleLead} ${locale.messages.academyGateway.hero.titleEmphasis}` },
      { name: "catalog", path: "/courses", heading: locale.messages.marketing.catalog.title },
      { name: "course", path: "/courses/ai-foundations", heading: locale.title(course.title) },
    ];

    for (const surface of pages) {
      test(`${surface.name} (${locale.code}) has no WCAG A or AA axe violations`, async ({ page, context, baseURL }) => {
        await setLocale(context, baseURL ?? "http://127.0.0.1:3000", locale.code);
        await page.goto(surface.path);
        await expectLocale(page, locale.code);
        await expect(page.getByRole("heading", { level: 1, name: surface.heading })).toBeVisible();
        await expectNoWcagViolations(page);
      });
    }
  }
});

test.describe("@recovery-15 learner WCAG 2.2 AA surfaces", () => {
  test.use({ role: "a11yLearner" });

  test.beforeEach(async ({ rolePage }) => {
    await ensureEnrolled(rolePage);
  });

  for (const locale of localeCases) {
    test(`lesson with quiz (${locale.code}) has no owned WCAG A or AA axe violations and reports YouTube player findings`, async ({ rolePage, roleContext, baseURL }, testInfo) => {
      await setLocale(roleContext, baseURL ?? "http://127.0.0.1:3000", locale.code);
      await rolePage.goto("/learn/ai-foundations/items/what-is-ai");
      await expectLocale(rolePage, locale.code);
      await expect(rolePage.getByRole("heading", { level: 1, name: locale.title(lesson.title) })).toBeVisible();
      await expect(rolePage.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(rolePage.getByRole("article").getByRole("heading", { level: 2, name: locale.title(lesson.title) })).toBeVisible();
      await expect(rolePage.getByRole("region", { name: locale.quizTitle })).toBeVisible();
      const thirdPartyFindings = await expectNoOwnedWcagViolations(
        rolePage,
      );
      testInfo.annotations.push({
        type: "third-party-accessibility",
        description: thirdPartyFindings.length
          ? `Known YouTube player findings observed: ${thirdPartyFindings.map(({ id, target }) => `${id} at ${target}`).join("; ")}`
          : "Known YouTube player findings were not observed because provider frame content can vary or may not load.",
      });
      const findingsPath = testInfo.outputPath("youtube-player-accessibility-findings.json");
      await writeFile(findingsPath, JSON.stringify({
        scope: "Cross-origin YouTube player document",
        fullPageWcagAaClaimed: false,
        knownFindings: KNOWN_YOUTUBE_PLAYER_FINDINGS,
        observedFindings: thirdPartyFindings,
      }, null, 2));
      await testInfo.attach("youtube-player-accessibility-findings", {
        path: findingsPath,
        contentType: "application/json",
      });
    });

    test(`exam player (${locale.code}) has no WCAG A or AA axe violations`, async ({ rolePage, roleContext, baseURL }) => {
      await setLocale(roleContext, baseURL ?? "http://127.0.0.1:3000", locale.code);
      await rolePage.goto("/learn/ai-foundations/items/exam-m1");
      const examTitle = locale.title(exam.title);
      await expect(rolePage.getByRole("heading", { level: 1, name: examTitle })).toBeVisible();
      const start = rolePage.getByRole("button", { name: locale.messages.exam.intro.start });
      const timer = rolePage.getByRole("timer");
      await expect(start.or(timer)).toBeVisible();
      if (await start.isVisible()) await start.click();
      await expectLocale(rolePage, locale.code);
      await expect(rolePage.getByRole("heading", { level: 1, name: examTitle })).toBeVisible();
      await expect(rolePage.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(rolePage.getByRole("article").getByRole("heading", { level: 2, name: examTitle })).toBeVisible();
      await expect(rolePage.getByRole("timer")).toBeVisible();
      await expectNoWcagViolations(rolePage);
    });

    test(`assignment (${locale.code}) has no WCAG A or AA axe violations`, async ({ rolePage, roleContext, baseURL }) => {
      await setLocale(roleContext, baseURL ?? "http://127.0.0.1:3000", locale.code);
      await rolePage.goto("/learn/ai-foundations/items/final-product");
      await expectLocale(rolePage, locale.code);
      await expect(rolePage.getByRole("heading", { level: 1, name: locale.title(assignment.title) })).toBeVisible();
      await expect(rolePage.getByRole("button", { name: locale.assignmentSubmit })).toBeVisible();
      await expectNoWcagViolations(rolePage);
    });

    test(`profile (${locale.code}) has no WCAG A or AA axe violations`, async ({ rolePage, roleContext, baseURL }) => {
      await setLocale(roleContext, baseURL ?? "http://127.0.0.1:3000", locale.code);
      await rolePage.goto("/profile");
      await expectLocale(rolePage, locale.code);
      await expect(rolePage.getByRole("heading", { level: 1, name: locale.messages.learner.profile.title })).toBeVisible();
      await expectNoWcagViolations(rolePage);
    });
  }
});

test.describe("@recovery-15 Studio WCAG 2.2 AA surfaces", () => {
  test.use({ role: "admin" });

  for (const locale of localeCases) {
    test(`course workspace (${locale.code}) has no WCAG A or AA axe violations`, async ({ rolePage, roleContext, baseURL }) => {
      await setLocale(roleContext, baseURL ?? "http://127.0.0.1:3000", locale.code);
      await rolePage.goto("/studio/courses/ai-foundations");
      await expectLocale(rolePage, locale.code);
      await expect(rolePage.getByRole("heading", { level: 1, name: locale.title(course.title) })).toBeVisible();
      await expect(rolePage.getByRole("navigation", { name: locale.messages.workspace.outline.label })).toBeVisible();
      await expectNoWcagViolations(rolePage);
    });

    test(`grading workspace (${locale.code}) has no WCAG A or AA axe violations`, async ({ rolePage, roleContext, baseURL }) => {
      await setLocale(roleContext, baseURL ?? "http://127.0.0.1:3000", locale.code);
      // /admin/submissions redirects here; the queue page's h1 is "Grading queues" and the submission
      // queue (studio.grading.title) is its embedded h2.
      await rolePage.goto("/grading/queue");
      await expectLocale(rolePage, locale.code);
      await expect(rolePage.getByRole("heading", { level: 1, name: locale.code === "vi" ? "Hàng chờ chấm bài" : "Grading queues" })).toBeVisible();
      await expect(rolePage.getByRole("heading", { level: 2, name: locale.messages.studio.grading.title })).toBeVisible();
      await expectNoWcagViolations(rolePage);
    });
  }
});
