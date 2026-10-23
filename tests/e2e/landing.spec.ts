import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import en from "../../src/messages/en.json";

test.describe("@main-unique public marketing experience", () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/analytics', (route) => route.fulfill({ status: 204 }));
  });
  test("offers Academy learning paths and local course discovery", async ({ page }) => {
    await page.goto('/?lang=en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${en.academyGateway.hero.titleLead} ${en.academyGateway.hero.titleEmphasis}`);
    await expect(page.getByRole('group', { name: en.labs.academy.explorer.label }).getByRole('button')).toHaveCount(5);
    await page.getByRole('link', { name: en.academyGateway.hero.browseCourses, exact: true }).first().click();
    await expect(page).toHaveURL(/\/courses\?lang=en$/);
  });

  test("lang query switches and persists the English headline", async ({ page }) => {
    await page.goto("/?lang=en");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: `${en.academyGateway.hero.titleLead} ${en.academyGateway.hero.titleEmphasis}`,
      }),
    ).toBeVisible();

    await page.goto("/courses");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Courses");
  });

  test("catalog lists the seeded published course", async ({ page }) => {
    await page.goto("/courses?lang=en");
    await expect(page.getByRole("link", { name: "Open AI Foundations" })).toBeVisible();
  });

  test("course overview exposes outcomes and outline titles but no lesson body", async ({ page }) => {
    await page.goto("/courses/ai-foundations?lang=en");
    await expect(page.getByRole("heading", { name: "What you will be able to do" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The AI landscape" })).toBeVisible();
    await expect(page.getByText("What is AI?", { exact: true })).toBeVisible();
    await expect(page.getByText("AI is a broad field of systems", { exact: false })).toHaveCount(0);
  });

  test("landing has no serious or critical axe violations", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter(
        (violation) => violation.impact === "serious" || violation.impact === "critical",
      ),
    ).toEqual([]);
  });
});
