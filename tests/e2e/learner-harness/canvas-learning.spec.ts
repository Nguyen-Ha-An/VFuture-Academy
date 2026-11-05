import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import en from '../../../src/messages/en.json';
import vi from '../../../src/messages/vi.json';

for (const locale of ['en', 'vi'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`Canvas course tabs, real results and calendar ${locale} ${theme}`, async ({ page }) => {
      const messages = locale === 'en' ? en : vi;
      const rootWarnings: string[] = [];
      page.on('console', message => { if (message.type() === 'error' && message.text().includes('createRoot()')) rootWarnings.push(message.text()); });
      await page.addInitScript(value => sessionStorage.setItem('fixture-locale', value), locale);
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/app');
      const continueButton = page.locator('[data-canvas-action="continue"]');
      await expect(continueButton).toBeVisible();
      await expect(continueButton).toHaveAttribute('href', '/app/courses/active/items/long');
      expect(await continueButton.evaluate(element => getComputedStyle(element).color !== getComputedStyle(element).backgroundColor)).toBe(true);
      expect(await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze().then(result => result.violations)).toEqual([]);
      await page.locator('a[href="/app/tasks"]').click();
      await expect(page.getByRole('link', { name: 'Unscheduled research journal' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Submitted reflection' })).toBeVisible();
      await expect(page.getByText(locale === 'en' ? 'Submitted late' : 'Nộp muộn', { exact: true })).toBeVisible();
      expect(await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze().then(result => result.violations)).toEqual([]);
      const assignment = page.getByRole('link', { name: 'Community research assignment', exact: true });
      await expect(assignment).toHaveAttribute('href', '/app/courses/active/items/research-assignment');
      await assignment.click();
      await expect(page.locator('main h1')).toHaveText('Community research assignment');
      await expect(page.getByRole('textbox', { name: locale === 'en' ? 'Notes' : 'Ghi chú', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: locale === 'en' ? 'Submit assignment' : 'Nộp bài', exact: true })).toBeDisabled();
      await page.goto('/app/courses/active');
      const nav = page.getByRole('navigation', { name: 'active course', exact: true });
      await expect(nav.getByRole('link')).toHaveCount(6);
      const views = ['overview', 'modules', 'assignments', 'grades', 'announcements', 'calendar'];
      expect(await nav.getByRole('link').evaluateAll(links => links.map(link => new URL((link as HTMLAnchorElement).href).searchParams.get('view')))).toEqual(views);
      await expect(nav.locator('a[href*="view=overview"]')).toHaveAttribute('aria-current', 'page');
      await nav.locator('a[href$="view=modules"]').click();
      await expect(page.getByRole('heading', { name: 'Module one', exact: true })).toBeVisible();
      await expect(nav.locator('a[href*="view=modules"]')).toHaveAttribute('aria-current', 'page');
      const optional = page.getByRole('link', { name: /Optional practice/ });
      await expect(optional).toContainText(messages.learner.course.optional);
      await optional.click();
      await expect(page).toHaveURL(/items\/optional$/);
      await page.goto('/app/courses/active?view=assignments');
      await expect(page.getByRole('link', { name: 'Community research assignment', exact: true })).toHaveAttribute('href', '/app/courses/active/items/research-assignment');
      await page.goto('/app/courses/active?view=grades');
      const gradeScore = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Recorded module exam', exact: true }) }).getByRole('cell', { name: /7\.5\s*\/\s*10/ });
      await expect(gradeScore).toHaveCount(1);
      await expect(gradeScore).toBeVisible();
      await expect(page.getByText('75%', { exact: true })).toHaveCount(0);
      await page.goto('/app/courses/active?view=announcements');
      await expect(page.getByRole('heading', { name: 'Welcome to the course' })).toBeVisible();
      await page.goto('/app/calendar?month=2026-11');
      await expect(page.locator('.canvas-month-grid')).toBeVisible();
      const scheduled = page.locator('.canvas-month-grid').getByRole('link', { name: /Community research assignment/ });
      await expect(scheduled).toHaveAttribute('href', '/app/courses/active/items/research-assignment');
      await expect(scheduled.locator('time')).toContainText('16:00');
      expect(Date.parse((await scheduled.locator('time').getAttribute('datetime'))!)).toBe(Date.parse('2026-11-12T09:00:00Z'));
      await expect(page.getByText(/ICT/)).toBeVisible();
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(axe.violations).toEqual([]);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('.canvas-month-grid')).toBeHidden();
      await expect(page.locator('.canvas-agenda')).toBeVisible();
      const agendaLink = page.locator('.canvas-agenda').getByRole('link', { name: 'Community research assignment', exact: true });
      await expect(agendaLink).toBeVisible();
      await expect(agendaLink).toHaveAttribute('href', '/app/courses/active/items/research-assignment');
      const agendaRow = page.locator('.canvas-agenda').getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Community research assignment', exact: true }) });
      await expect(agendaRow.locator(':scope > time')).toContainText('16:00');
      expect(Date.parse((await agendaRow.locator(':scope > time').getAttribute('datetime'))!)).toBe(Date.parse('2026-11-12T09:00:00Z'));
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
      const mobileAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(mobileAxe.violations).toEqual([]);
      await page.locator('[aria-controls="learner-mobile-navigation"]').click();
      const drawer = page.getByRole('dialog');
      await expect(drawer).toBeVisible();
      expect(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      const calendarLink = drawer.locator('a[href="/app/calendar"]');
      await calendarLink.click();
      await expect(drawer).toHaveCount(0);
      await expect(page).toHaveURL('/app/calendar');
      await page.goto('/app/results');
      const mobileScore = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Recorded module exam', exact: true }) }).getByRole('cell', { name: /7\.5\s*\/\s*10/ });
      await expect(mobileScore).toHaveCount(1);
      await expect(mobileScore).toBeVisible();
      const recorded = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Recorded module exam', exact: true }) });
      await expect(recorded.locator('time')).toBeVisible();
      expect(Date.parse((await recorded.locator('time').getAttribute('datetime'))!)).toBe(Date.parse('2026-11-03T01:00:00Z'));
      await expect(recorded.getByText('75%', { exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
      expect(rootWarnings).toEqual([]);
    });
  }
}

for (const width of [390, 1440]) {
  for (const item of ['long', 'exam']) {
    test(`Canvas sticky navigation and ${item} stay separate while scrolling at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await page.goto(`/app/courses/active/items/${item}`);
      await expect(page.locator('main h1')).toBeVisible();
      if (item === 'exam') await expect(page.getByRole('timer').first()).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 700));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(150);
      const rectangles = await page.evaluate(() => {
        const rect = (selector: string) => { const bounds = document.querySelector(selector)!.getBoundingClientRect(); return { top: bounds.top, bottom: bounds.bottom }; };
        return { header: rect('.canvas-learner-header'), focus: rect('.vf-focus-bar'), search: rect('.canvas-learner-header .vf-l-search-trigger'), aside: document.querySelector('.vf-exam-split > [data-area="aside"]') ? rect('.vf-exam-split > [data-area="aside"]') : null };
      });
      expect(rectangles.focus.top).toBeGreaterThanOrEqual(rectangles.header.bottom - 1);
      expect(rectangles.search.top).toBeGreaterThanOrEqual(rectangles.header.top);
      await expect(page.locator('.canvas-learner-header .vf-l-search-trigger')).toBeInViewport();
      for (const control of await page.locator('.vf-focus-bar').getByRole('button').all()) await expect(control).toBeInViewport();
      if (width >= 1100 && rectangles.aside) {
        expect(rectangles.aside.top).toBeGreaterThanOrEqual(rectangles.focus.bottom + 15);
      }
      if (item === 'exam') await expect(page.getByRole('timer').first()).toBeInViewport();
      const search = page.locator('.canvas-learner-header .vf-l-search-trigger');
      await search.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(search).toBeFocused();
    });
  }
}

test('learner account theme updates real InstUI action colors without reloading', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/app');
  const action = page.locator('[data-canvas-action="continue"]');
  await expect(action).toBeVisible();
  const light = await action.evaluate(element => getComputedStyle(element).color);
  await page.getByRole('button', { name: en.learner.focus.account, exact: true }).click();
  const tray = page.getByRole('dialog', { name: en.learner.focus.account, exact: true });
  await expect(tray).toBeVisible();
  const theme = tray.getByRole('combobox', { name: 'Theme', exact: true });
  await theme.click();
  await tray.getByRole('option', { name: 'Dark', exact: true }).click();
  await expect(theme).toHaveValue('Dark');
  await expect(page.locator('.vf-workspace')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => action.evaluate(element => getComputedStyle(element).color)).not.toBe(light);
  await theme.click();
  await tray.getByRole('option', { name: 'Light', exact: true }).click();
  await expect(theme).toHaveValue('Light');
  await expect.poll(() => action.evaluate(element => getComputedStyle(element).color)).toBe(light);
});
