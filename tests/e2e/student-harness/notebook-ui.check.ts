import { expect, test } from '@playwright/test';

const session = {
  userId: 'learner-1',
  courseId: 'ai-basics',
  courseVersionId: 'version-1',
  itemId: 'notebook-lab',
  blockId: null,
  config: {
    runtimeMode: 'jupyterlite',
    templateAssetId: 'template-1',
    templateChecksum: 'a'.repeat(64),
    runtimeProfileId: 'python-data-v1',
    runtimeProfileVersion: '1',
    datasets: [],
  },
  template: null,
  datasets: [],
  draft: null,
  studioRevision: null,
  assignment: {
    locator: { courseId: 'ai-basics', itemId: 'notebook-lab', blockId: null },
    courseVersionId: 'version-1',
    attemptsUsed: 0,
    submissions: [],
    action: { allowed: true, kind: 'initial', expectedLatestSubmissionId: null, nextAttemptNo: 1 },
  },
};

test('refined learner notebook and iframe fit a 390px phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/notebooks/session?**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: session }),
  }));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/app/courses/ai-basics/items/notebook-lab/notebook?lang=en');
  // The activity frame owns the heading: the item title, not a separate "Your notebook" header.
  await expect(page.getByRole('heading', { level: 1, name: 'Notebook lab' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your notebook' })).toHaveCount(0);
  const iframe = page.getByTitle('Python notebook editor');
  await expect(iframe).toBeVisible();
  await expect(iframe.contentFrame().getByText('Notebook frame stand-in')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Notebook lab' })).toBeFocused();
  await page.keyboard.press('Tab');
  const importInput = page.locator('input[type="file"][accept=".ipynb"]');
  await expect(importInput).toBeFocused();
  const visibleFocus = await importInput.locator('..').evaluate(label => getComputedStyle(label).outlineStyle);
  expect(visibleFocus).not.toBe('none');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Download .ipynb' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Save work' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeFocused();

  const geometry = await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Python notebook editor"]')!;
    const main = document.querySelector<HTMLElement>('#learner-main')!;
    const rect = frame.getBoundingClientRect();
    return {
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      mainWidth: main.scrollWidth,
      frame: { x: rect.x, width: rect.width, right: rect.right },
    };
  });
  await testInfo.attach('notebook-390-geometry', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath('notebook-390.png'), fullPage: true });

  expect(geometry.documentWidth).toBeLessThanOrEqual(391);
  expect(geometry.mainWidth).toBeLessThanOrEqual(391);
  expect(geometry.frame.x).toBeGreaterThanOrEqual(-1);
  expect(geometry.frame.right).toBeLessThanOrEqual(391);
  expect(errors).toEqual([]);
});
