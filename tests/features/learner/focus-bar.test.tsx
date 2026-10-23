// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import { withBenchMessages } from '@/messages/bench';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { FocusOutline } from '@/features/learner/ui/FocusOutline';
import { ActivityFooter } from '@/features/workspace-ui/learner/activity/ActivityFooter';
import { ActivityPager } from '@/features/workspace-ui/learner/activity/ActivityPager';
import { ActivityProgressProvider, useActivityLock, useActivityProgress } from '@/features/workspace-ui/learner/activity/ActivityProgress';
import { FocusBar } from '@/features/workspace-ui/learner/activity/FocusBar';

const messages = withBenchMessages(en, 'en');
const activity = messages.bench.learner.activity;
afterEach(() => cleanup());

let reportProgress: ReturnType<typeof useActivityProgress> = null;
function Reporter() { reportProgress = useActivityProgress(); return null; }
function Lock({ locked }: { locked: boolean }) { useActivityLock(locked); return null; }

const modules = [{ id: 'm1', title: 'Foundations', items: [{ id: 'one', title: 'One', status: 'completed' }, { id: 'two', title: 'Two', status: 'in_progress' }] }];

function Fixture({ locked = false }: { locked?: boolean }) {
  return <NextIntlClientProvider locale="en" messages={messages}>
    <ActivityProgressProvider initial={{ completed: 1, total: 4 }} status="in_progress">
      <FocusBar
        course={{ title: 'A very long course title that keeps going well past the bar width', href: '/app/courses/course' }}
        position={{ current: 2, total: 4 }}
        outline={<FocusOutline courseId="course" itemId="two" modules={modules} />}
      />
      <Reporter />
      <Lock locked={locked} />
      <ActivityPager label={activity.pager} previous={{ href: '/app/courses/course/items/one', title: 'One', kicker: 'Previous · Lesson' }} next={{ href: '/app/courses/course/items/three', title: 'Three', kicker: 'Next · Exam' }} />
    </ActivityProgressProvider>
  </NextIntlClientProvider>;
}

describe('FocusBar', () => {
  it('is a nav with no brand link, one dialog trigger and a mono position readout', () => {
    render(<Fixture />);
    const bar = screen.getByRole('navigation', { name: activity.bar });
    expect(bar.tagName).toBe('NAV');
    expect(within(bar).queryByRole('link', { name: /VFuture/i })).toBeNull();
    expect(bar.querySelector('a[href="/app"]')).toBeNull();
    expect(within(bar).getByRole('link', { name: 'Back to course: A very long course title that keeps going well past the bar width' })).toHaveAttribute('href', '/app/courses/course');
    expect(document.querySelectorAll('[aria-haspopup="dialog"]')).toHaveLength(1);
    expect(within(bar).getByRole('button', { name: en.learner.focus.outline })).toHaveAttribute('aria-haspopup', 'dialog');
    expect(bar).toHaveTextContent('02 / 04');
    expect(within(bar).queryByRole('button', { name: /search|command/i })).toBeNull();
  });

  it('offers theme only under More options', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const more = screen.getByRole('button', { name: activity.more });
    expect(more).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(more);
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitemradio').map((item) => item.textContent);
    expect(items).toHaveLength(3);
    expect(items).toEqual(expect.arrayContaining([
      messages.bench.shared.theme.system, messages.bench.shared.theme.light, messages.bench.shared.theme.dark,
    ].map((label) => expect.stringContaining(label))));
    expect(within(menu).queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('follows progress reported by the player', () => {
    render(<Fixture />);
    const progress = screen.getByRole('progressbar', { name: '1 of 4 items complete' });
    expect(progress).toHaveAttribute('aria-valuenow', '1');
    act(() => reportProgress!.report({ completed: 2, total: 4 }, 'completed'));
    expect(screen.getByRole('progressbar', { name: '2 of 4 items complete' })).toHaveAttribute('aria-valuenow', '2');
  });
});

describe('ActivityPager and ActivityFooter', () => {
  it('names previous and next with kind kickers and hides while an attempt is active', () => {
    const { rerender } = render(<Fixture />);
    const pager = screen.getByRole('navigation', { name: activity.pager });
    expect(within(pager).getByRole('link', { name: /Previous · Lesson.*One/ })).toHaveAttribute('data-dir', 'previous');
    expect(within(pager).getByRole('link', { name: /Next · Exam.*Three/ })).toHaveAttribute('data-dir', 'next');
    rerender(<Fixture locked />);
    expect(screen.queryByRole('navigation', { name: activity.pager })).toBeNull();
    rerender(<Fixture />);
    expect(screen.getByRole('navigation', { name: activity.pager })).toBeInTheDocument();
  });

  it('keeps Previous before Next in the DOM, with no CSS reordering at any width (WCAG 1.3.2, 2.4.3)', () => {
    render(<Fixture />);
    const links = within(screen.getByRole('navigation', { name: activity.pager })).getAllByRole('link');
    expect(links.map(link => link.getAttribute('data-dir'))).toEqual(['previous', 'next']);
    const css = readFileSync(path.join(process.cwd(), 'src/features/workspace-ui/learner/learner.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const pagerRules = css.match(/[^{}]*\.vf-(?:activity-)?pager[^{}]*\{[^}]*\}/g) ?? [];
    expect(pagerRules.length).toBeGreaterThan(0);
    for (const rule of pagerRules) expect(rule, rule).not.toMatch(/(?:^|[{;\s])(?:order|flex-direction|grid-auto-flow)\s*:|row-reverse|column-reverse/);
    // Next keeps its signal emphasis on phones.
    expect(css).toMatch(/@media \(max-width: 759px\) \{\s*\.vf-pager-link\[data-dir="next"\] \{[^}]*border-left: 2px solid var\(--vf-signal\)/);
  });

  it('shows the state tag and the single primary action', () => {
    render(<ActivityFooter status={{ tone: 'fault', label: activity.state.notSaved }} action={<a className="vf-btn vf-btn-primary" href="/next">Next</a>} />);
    expect(screen.getByText(activity.state.notSaved).closest('.vf-tag')).toHaveAttribute('data-tone', 'fault');
    expect(document.querySelectorAll('.vf-btn-primary')).toHaveLength(1);
  });
});
