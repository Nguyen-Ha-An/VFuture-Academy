import {expect, test} from '@playwright/test';

// Full-page grading, driven against the local browser fixture: no server, no database.
// It replaces the old drawer-based journey, which is no longer reachable in the product.

// The grading routes must mount the real GradingShell. Mounting StudioShell here rendered a blank
// sidebar — no authoring nav item matches a grading permission — and every screenshot inherited it.
test('grading pages render the assessment workspace shell and its full sidebar', async ({page}, info) => {
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/grading/exams/fixture-attempt');

  const sidebar = page.getByRole('navigation', {name: 'Assessment & grading navigation'});
  await expect(sidebar).toBeVisible();
  for (const [label, href] of [['Assessments', '/grading/assessments'], ['Grading queue', '/grading/queue'], ['Learning reports', '/grading/reports']] as const) {
    await expect(sidebar.getByRole('link', {name: label})).toHaveAttribute('href', href);
  }
  // The workspace switcher offers all three staff workspaces, not just this one.
  for (const href of ['/studio', '/grading', '/admin']) {
    await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();
  }
  await page.screenshot({path: info.outputPath('grading-shell.png'), fullPage: true});
});

test('reports render inside the same assessment workspace shell', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/grading/reports?canGrade=1&lang=en');
  const sidebar = page.getByRole('navigation', {name: 'Assessment & grading navigation'});
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole('link', {name: 'Learning reports'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Learning reports', exact: true})).toBeVisible();
});

test('completes exam grading on one page and locks the result from the server response', async ({page}, info) => {
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/grading/exams/fixture-attempt');

  // Full page, not a drawer.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('link', {name: 'Back to grading queue'})).toHaveAttribute('href', '/grading/queue');
  await expect(page.getByText('Question scores stay a private draft and remain editable until you complete grading.')).toBeVisible();

  // A manual score already saved stays editable before completion, and nothing on the page claims
  // the question is still awaiting grading while showing its score.
  await page.getByRole('button', {name: /2\. Essay/}).click();
  await expect(page.getByLabel('Points')).toBeEnabled();
  await expect(page.getByLabel('Points')).toHaveValue('2');
  await expect(page.getByText('This question is no longer pending manual grading.')).toHaveCount(0);

  // A re-scored draft persists through the refetch the save triggers.
  await page.getByLabel('Points').fill('4');
  await page.getByLabel('Feedback').fill('Reworked answer accepted');
  await page.getByRole('button', {name: 'Save question grade'}).click();
  await expect(page.getByRole('status')).toContainText('Question grade saved.');
  await expect(page.getByLabel('Points')).toHaveValue('4');
  await expect(page.getByLabel('Feedback')).toHaveValue('Reworked answer accepted');

  const complete = page.getByRole('button', {name: 'Complete grading'});
  await expect(complete).toBeEnabled();
  await complete.click();

  await expect(page.getByRole('status')).toContainText('Grading completed. The learner can see the score and feedback.');
  await expect(page.getByRole('heading', {name: 'Completed result'})).toBeVisible();
  await expect(page.getByText('5 / 5 · 100%')).toBeVisible();
  await expect(page.getByText('The learner can see this score and feedback now.')).toBeVisible();
  await expect(page.getByText("Answer keys and explanations stay governed by this assessment's own review configuration.")).toBeVisible();
  await expect(page.getByRole('button', {name: 'Complete grading'})).toHaveCount(0);
  await expect(page.getByText('Grading is complete; scores can no longer be edited.')).toBeVisible();
  await page.screenshot({path: info.outputPath('grading-exam-completed.png')});
});

test('refuses to lock when the completion response is incomplete and keeps the scores', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/grading/exams/fixture-attempt?completion=malformed');
  await page.getByRole('button', {name: 'Complete grading'}).click();

  await expect(page.getByRole('alert')).toContainText('The server did not fully confirm the completion.');
  await expect(page.getByRole('heading', {name: 'Completed result'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Complete grading'})).toBeEnabled();
  await page.getByRole('button', {name: /2\. Essay/}).click();
  await expect(page.getByLabel('Points')).toHaveValue('2');
});

test('saves an assignment draft, then completes it and shows the score and feedback', async ({page}, info) => {
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/grading/assignments/fixture-submission');
  await expect(page.getByText('Pinned assignment instructions')).toBeVisible();
  await expect(page.getByText('A grading draft stays private: the learner sees no score or feedback until you complete grading.')).toBeVisible();

  // Completion is refused until the rubric is fully scored; a draft is not.
  await expect(page.getByRole('button', {name: 'Complete grading'})).toBeDisabled();
  await page.getByRole('spinbutton', {name: 'Quality'}).fill('3');
  await page.getByRole('textbox', {name: 'Feedback'}).fill('Solid attempt');
  await page.getByRole('button', {name: 'Save grading draft'}).click();
  await expect(page.getByRole('status')).toContainText('Grading draft saved.');
  await expect(page.getByRole('heading', {name: 'Completed result'})).toHaveCount(0);

  await page.getByRole('button', {name: 'Complete grading'}).click();
  await expect(page.getByRole('status')).toContainText('Grading completed. The learner can see the score and feedback.');
  await expect(page.getByRole('heading', {name: 'Completed result'})).toBeVisible();
  await expect(page.getByLabel('Completed result').getByText('Solid attempt')).toBeVisible();
  await expect(page.getByText('This completed grade is immutable.')).toBeVisible();
  await expect(page.getByRole('textbox', {name: 'Feedback'})).toBeDisabled();
  await page.screenshot({path: info.outputPath('grading-assignment-completed.png')});
});

test('mobile grading separates prompt from scoring and completes without page overflow', async ({page}, info) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/grading/assignments/fixture-submission');
  await expect(page.getByText('Pinned assignment instructions')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Submit assignment'})).toHaveCount(0);

  await page.getByRole('tab', {name: 'Rubric and points'}).click();
  await expect(page.getByRole('spinbutton', {name: 'Quality'})).toBeVisible();
  await expect(page.getByText('Pinned assignment instructions')).toBeHidden();
  await page.getByRole('spinbutton', {name: 'Quality'}).fill('4');
  await page.getByRole('button', {name: 'Complete grading'}).click();
  await expect(page.getByRole('heading', {name: 'Completed result'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({path: info.outputPath('grading-mobile.png')});
});

test('drives the grading workbench by keyboard alone', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/grading/exams/fixture-attempt');
  await page.getByRole('button', {name: '1. Single choice'}).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name: /2\. Essay/})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Points')).toBeEnabled();

  await page.getByRole('button', {name: 'Complete grading'}).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', {name: 'Completed result'})).toBeVisible();
});
