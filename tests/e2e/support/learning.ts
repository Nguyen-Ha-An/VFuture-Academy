import type { Locator, Page } from "@playwright/test";

import { expect } from "./fixtures";

export async function ensureEnrolled(page: Page, courseId = "ai-foundations"): Promise<void> {
  const response = await page.request.post(`/api/v1/courses/${encodeURIComponent(courseId)}/enroll`);
  expect(response.ok(), `Unable to enroll in ${courseId}: HTTP ${response.status()}`).toBeTruthy();
}

export async function expectVisibleKeyboardFocus(target: Locator): Promise<void> {
  await expect(target).toBeFocused();
  expect(await target.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
}

export async function focusKeyboardBoundary(target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  await target.evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error("Keyboard boundary is not focusable.");
    if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
    element.focus();
  });
  await expect(target).toBeFocused();
}

export async function tabToNext(page: Page, target: Locator): Promise<void> {
  await page.keyboard.press("Tab");
  await expectVisibleKeyboardFocus(target);
}

export async function selectRadioByKeyboard(
  page: Page,
  group: Locator,
  target: Locator,
  direction: "ArrowDown" | "ArrowRight" = "ArrowRight",
): Promise<void> {
  await expect(group).toBeVisible();
  const radios = group.getByRole("radio");
  const count = await radios.count();
  expect(count, "A keyboard radio group must contain options.").toBeGreaterThan(0);

  await page.keyboard.press("Tab");
  for (let index = 0; index < count; index += 1) {
    const targetFocused = await target.evaluate(
      (element) => element === element.ownerDocument.activeElement,
    );
    if (targetFocused) {
      if (!(await target.isChecked())) await page.keyboard.press("Space");
      await expect(target).toBeChecked();
      await expectVisibleKeyboardFocus(target);
      return;
    }
    await page.keyboard.press(direction);
  }
  throw new Error("Arrow-key navigation did not reach the requested radio option.");
}
