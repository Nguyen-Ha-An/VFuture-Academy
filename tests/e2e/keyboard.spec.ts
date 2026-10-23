import { test, expect } from "./support/fixtures";
import type { Locator, Page } from "@playwright/test";
import {
  ensureEnrolled,
  expectVisibleKeyboardFocus,
  focusKeyboardBoundary,
  selectRadioByKeyboard,
  tabToNext,
} from "./support/learning";

async function tabUntilFocused(page: Page, target: Locator, maxTabs = 20): Promise<void> {
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === element.ownerDocument.activeElement)) {
      await expectVisibleKeyboardFocus(target);
      return;
    }
  }
  throw new Error(`Tab navigation did not reach ${await target.getAttribute("aria-label") ?? await target.textContent() ?? "the target"}.`);
}

test.describe("@recovery-15 keyboard-only learning flows", () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ role: "keyboardLearner" });

  test.beforeEach(async ({ rolePage }) => {
    await ensureEnrolled(rolePage);
  });

  test("answers and submits the graded quiz without a pointer", async ({ rolePage }) => {
    await rolePage.goto("/learn/ai-foundations/items/what-is-ai");
    const quiz = rolePage.getByRole("region", { name: "Quick check" });
    await focusKeyboardBoundary(quiz);

    const firstGroup = quiz.getByRole("radiogroup").nth(0);
    const learnedPatterns = quiz.getByRole("radio", { name: /learning patterns from examples/i });
    await selectRadioByKeyboard(rolePage, firstGroup, learnedPatterns, "ArrowDown");

    const chatGpt = quiz.getByRole("checkbox", { name: "ChatGPT" });
    await tabToNext(rolePage, chatGpt);
    await rolePage.keyboard.press("Space");
    await expect(chatGpt).toBeChecked();
    const spamFilter = quiz.getByRole("checkbox", { name: /spam filter/i });
    await tabToNext(rolePage, spamFilter);
    const midjourney = quiz.getByRole("checkbox", { name: "Midjourney" });
    await tabToNext(rolePage, midjourney);
    await rolePage.keyboard.press("Space");
    await expect(midjourney).toBeChecked();

    const trueFalseGroup = quiz.getByRole("radiogroup").nth(1);
    const falseOption = quiz.getByRole("radio", { name: /false/i });
    await selectRadioByKeyboard(rolePage, trueFalseGroup, falseOption);

    const blank = quiz.getByRole("textbox", { name: "Blank 1" });
    await tabToNext(rolePage, blank);
    await rolePage.keyboard.type("prompt");
    await expect(blank).toHaveValue("prompt");

    const submit = quiz.getByRole("button", { name: "Submit", exact: true });
    await tabToNext(rolePage, submit);
    const submitted = rolePage.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/quizzes/submit'
      && response.request().method() === 'POST', { timeout: 30_000 });
    await rolePage.keyboard.press("Enter");
    const response = await submitted;
    expect(response.ok(), `Keyboard quiz submission failed with HTTP ${response.status()}`).toBeTruthy();
    expect((await response.json()).data?.passed).toBe(true);
    await expect(quiz.getByText(/passed/i)).toBeVisible({ timeout: 15_000 });
  });

  test("starts, answers, navigates, and submits the exam player without a pointer", async ({ rolePage }) => {
    await rolePage.goto("/learn/ai-foundations/items/exam-m1");
    const start = rolePage.getByRole("button", { name: "Start exam" });
    await focusKeyboardBoundary(start.locator("xpath=ancestor::article[1]"));
    await tabToNext(rolePage, start);
    await rolePage.keyboard.press("Enter");
    await expect(rolePage.getByRole("timer")).toBeVisible();

    const sectionHeading = rolePage.getByRole("heading", { level: 3 }).first();
    await focusKeyboardBoundary(sectionHeading);
    const firstQuestion = rolePage.locator("[data-exam-question]").first();
    const firstGroup = firstQuestion.getByRole("radiogroup");
    const firstTextbox = firstQuestion.getByRole("textbox");
    if (await firstGroup.isVisible()) {
      const firstAnswer = firstGroup.getByRole("radio").last();
      await selectRadioByKeyboard(rolePage, firstGroup, firstAnswer);
    } else {
      await tabToNext(rolePage, firstTextbox);
      await rolePage.keyboard.type("AI can support responsible study when learners verify outputs, protect private data, cite sources, and use human judgment for important decisions and limitations.");
      await expect(firstTextbox).not.toHaveValue("");
    }

    const flag = firstQuestion.getByRole("button", { name: /Flag question 1/ });
    await tabToNext(rolePage, flag);
    const next = rolePage.getByRole("button", { name: "Next", exact: true });
    await tabToNext(rolePage, next);
    await rolePage.keyboard.press("Enter");
    await expect(rolePage.getByText(/Question 2 of/i)).toBeVisible();
    await expect(rolePage.locator("[data-exam-question]").first().getByRole("heading", { level: 4 })).toBeFocused();

    const submitExam = rolePage.getByRole("button", { name: "Submit exam" });
    await tabUntilFocused(rolePage, submitExam);
    await rolePage.keyboard.press("Enter");
    const dialog = rolePage.getByRole("dialog", { name: "Submit exam?" });
    await expect(dialog).toBeVisible();
    const keepWorking = dialog.getByRole("button", { name: "Keep working" });
    await expectVisibleKeyboardFocus(keepWorking);
    const submitNow = dialog.getByRole("button", { name: "Submit now" });
    await tabToNext(rolePage, submitNow);
    await rolePage.keyboard.press("Enter");
    await expect(rolePage.getByRole("heading", { name: "Exam review" })).toBeVisible({ timeout: 15_000 });
  });
});
