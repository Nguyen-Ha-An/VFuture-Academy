// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
import { PageHeader } from '@/features/workspace-ui/ui/PageHeader';
import { BenchState } from '@/features/workspace-ui/ui/BenchState';
import { Card } from '@/features/workspace-ui/ui/primitives';

afterEach(() => { document.body.innerHTML = ''; });

function assertServerFocusTarget(markup: string, selector: string) {
  document.body.innerHTML = markup;
  const target = document.querySelector<HTMLElement>(selector);
  expect(target).not.toBeNull();
  expect(target).toHaveAttribute('tabindex', '-1');
  // Focusing the streamed server node needs no client-side attribute injection.
  target?.focus();
  expect(document.activeElement).toBe(target);
  expect(target?.tabIndex).toBe(-1);
}

describe('authenticated page focus markup', () => {
  it('makes shared learner and staff headings focusable in server output without adding tab stops', () => {
    assertServerFocusTarget(renderToStaticMarkup(<PageHeader title="Course overview" />), 'h1');
    assertServerFocusTarget(renderToStaticMarkup(<StaffPageHeader title="Grading" />), 'h1');
  });

  it('marks a page boundary heading but leaves ordinary section headings unchanged', () => {
    assertServerFocusTarget(renderToStaticMarkup(<BenchState kind="fault" title="Unavailable" titleAs="h1" />), 'h1');
    document.body.innerHTML = renderToStaticMarkup(<BenchState kind="empty" title="No records" titleAs="h2" />);
    expect(document.querySelector('h2')).not.toHaveAttribute('tabindex');
  });

  it('renders a declared profile settings hash target while keeping unrelated card headings unchanged', () => {
    assertServerFocusTarget(renderToStaticMarkup(<Card title="Public profile settings" titleId="profile-settings-heading" focusableTitle>Settings</Card>), '#profile-settings-heading');
    document.body.innerHTML = renderToStaticMarkup(<Card title="Details">Details</Card>);
    expect(document.querySelector('h2')).not.toHaveAttribute('tabindex');
  });
});
