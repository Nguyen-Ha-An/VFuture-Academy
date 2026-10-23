// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import vi_ from '@/messages/vi.json';
import { benchMessages, withBenchMessages } from '@/messages/bench';
import { uiV2Enabled } from '@/features/workspace/presentation';
import { coursePartLabel, countdown, formatDelta, ictDate, ictTime, lastVietnamDays, paceBand, prerequisiteLabel, prerequisiteLabels, rankDelta, unmetPrerequisiteLabels } from '@/features/workspace-ui/format';
import { parseWorkspaceTheme, workspaceThemeAttribute } from '@/features/workspace-ui/theme';
import { EmptyBench, ToleranceBar } from '@/features/workspace-ui/ui/primitives';
import { TraceRail } from '@/features/workspace-ui/ui/TraceRail';
import { ThemeSwitcher } from '@/features/workspace-ui/ui/ThemeSwitcher';
import { WorkspaceSurface } from '@/features/workspace-ui/ui/WorkspaceSurface';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);
const messages = withBenchMessages(en, 'en');

function keysOf(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keysOf(child, prefix ? `${prefix}.${key}` : key));
}

describe('Calibration Bench rollout', () => {
  it('always renders the staff workspaces and keeps auth opt-in', () => {
    expect(uiV2Enabled('studio', { STAFF_UI_V2_WORKSPACES: 'studio' })).toBe(true);
    expect(uiV2Enabled('admin', {})).toBe(true);
    expect(uiV2Enabled('grading', {})).toBe(true);
    expect(uiV2Enabled('auth', {})).toBe(false);
    expect(uiV2Enabled('studio', { UI_V2_SURFACES: '' })).toBe(true);
    expect(uiV2Enabled('admin', { UI_V2_SURFACES: 'learner' })).toBe(true);
    expect(uiV2Enabled('auth', { UI_V2_SURFACES: 'learner, auth' })).toBe(true);
    expect(uiV2Enabled('admin', { UI_V2_SURFACES: 'all' })).toBe(true);
  });
  it('keeps bench catalogs in step between Vietnamese and English', () => {
    expect(keysOf(benchMessages('vi')).sort()).toEqual(keysOf(benchMessages('en')).sort());
    expect(keysOf(withBenchMessages(vi_, 'vi')).length).toBeGreaterThan(keysOf(vi_).length);
  });
});

describe('bench formatting', () => {
  it('never renders a delta without a baseline as infinity', () => {
    expect(formatDelta(120, 0)).toEqual({ text: 'new', tone: 'new' });
    expect(formatDelta(0, null)).toEqual({ text: '·', tone: 'flat' });
    expect(formatDelta(118, 100, { percent: true })).toEqual({ text: '▲ 18%', tone: 'up' });
    expect(formatDelta(19, 23)).toEqual({ text: '▼ 4', tone: 'down' });
  });
  it('reads rank change as places gained, with new entrants marked', () => {
    expect(rankDelta(3, 7)).toEqual({ text: '▲ 4', tone: 'up' });
    expect(rankDelta(9, 5)).toEqual({ text: '▼ 4', tone: 'down' });
    expect(rankDelta(2, 2)).toEqual({ text: '·', tone: 'flat' });
    expect(rankDelta(1, null)).toEqual({ text: 'new', tone: 'new' });
  });
  it('labels prerequisites by code or title and flags only unfinished ones', () => {
    const catalog = [
      { id: 'c', title: 'C programming', code: 'VF-C-101', enrollment: { status: 'completed' } },
      { id: 'mcu', title: 'Microcontrollers', enrollment: null },
      { id: 'emb', title: 'Embedded', prerequisites: ['c', 'mcu', 'gone'], enrollment: null },
    ];
    expect(prerequisiteLabels(catalog[2], catalog)).toEqual(['VF-C-101', 'Microcontrollers', 'gone']);
    expect(unmetPrerequisiteLabels(catalog[2], catalog)).toEqual(['Microcontrollers', 'gone']);
    expect(unmetPrerequisiteLabels({}, catalog)).toEqual([]);
    const byId = new Map(catalog.map(entry => [entry.id, entry]));
    expect(['c', 'mcu', 'gone'].map(id => prerequisiteLabel(id, byId))).toEqual(['VF-C-101', 'Microcontrollers', 'gone']);
  });
  it('uses the authored course code, else the pathway label', () => {
    expect(coursePartLabel({ code: 'VF-EMB-201', pathway: 'core-future-skills' })).toBe('VF-EMB-201');
    expect(coursePartLabel({ pathway: 'ai-emerging-technology' })).toBe('AI');
    expect(coursePartLabel({ pathway: 'unknown' })).toBe('CF');
  });
  it('only draws a pace band for real schedules', () => {
    expect(paceBand(null, '2026-10-01')).toBeNull();
    expect(paceBand('2026-09-01T00:00:00Z', '2026-09-11T00:00:00Z', new Date('2026-09-06T00:00:00Z'))).toEqual([40, 60]);
  });
  it('counts down in bench notation and returns 14 Vietnam days', () => {
    expect(countdown('2026-09-26T08:00:00Z', new Date('2026-09-23T18:00:00Z'))).toBe('T−2d 14h');
    expect(countdown('2026-09-01T00:00:00Z', new Date('2026-09-23T00:00:00Z'))).toBeNull();
    const days = lastVietnamDays(14, new Date('2026-09-23T18:00:00Z'));
    expect(days).toHaveLength(14);
    expect(days[13]).toBe('2026-09-24');
  });
  it('renders a dash for missing or invalid instants instead of throwing', () => {
    expect(ictDate(null)).toBe('—');
    expect(ictDate('not a date')).toBe('—');
    expect(ictTime(undefined as unknown as null)).not.toBe('—');
    expect(ictDate('2026-09-24T14:14:00Z')).toBe('24.09.2026');
  });
  it('treats unknown theme cookies as system', () => {
    expect(parseWorkspaceTheme('neon')).toBe('system');
    expect(workspaceThemeAttribute('system')).toBeUndefined();
    expect(workspaceThemeAttribute('light')).toBe('light');
  });
});

describe('bench components', () => {
  it('exposes tolerance readings as labelled images', () => {
    render(<ToleranceBar value={64} band={[60, 80]} label="64 percent complete, target 60 to 80" />);
    expect(screen.getByRole('img', { name: '64 percent complete, target 60 to 80' })).toBeInTheDocument();
  });
  it('announces empty benches as status', () => {
    render(<EmptyBench title="No certificates on this bench." />);
    expect(screen.getByRole('status')).toHaveTextContent('No certificates on this bench.');
  });
  it('pins a keyboard-reachable readout on the trace rail', () => {
    const days = Array.from({ length: 14 }, (_, index) => ({ date: `d${index}`, value: index % 3, readout: `${index} min` }));
    render(<NextIntlClientProvider locale="en" messages={messages}><TraceRail days={days} events={[{ dayIndex: 13, label: 'Lab 3 · +140 XP' }]} /></NextIntlClientProvider>);
    const rail = screen.getByRole('group', { name: 'Trace · 14d' });
    fireEvent.keyDown(rail, { key: 'ArrowLeft' });
    expect(rail).toHaveTextContent('Today · Lab 3 · +140 XP');
    fireEvent.keyDown(rail, { key: 'ArrowLeft' });
    expect(rail).toHaveTextContent('T−1d · 12 min');
  });
  it('shows the empty trace label for new learners', () => {
    const days = Array.from({ length: 14 }, (_, index) => ({ date: `d${index}`, value: 0, readout: '0' }));
    render(<NextIntlClientProvider locale="en" messages={messages}><TraceRail days={days} /></NextIntlClientProvider>);
    expect(screen.getByText(messages.bench.shared.noReadings)).toBeInTheDocument();
    expect(screen.getByText(messages.bench.shared.traceSummaryEmpty)).toBeInTheDocument();
  });
  it('switches the live surface theme and writes the cookie', () => {
    render(<NextIntlClientProvider locale="en" messages={messages}><WorkspaceSurface theme="system"><ThemeSwitcher initial="system" /></WorkspaceSurface></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(document.querySelector('.vf-workspace')).toHaveAttribute('data-theme', 'light');
    expect(document.cookie).toContain('vf-theme=light');
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }));
    expect(document.querySelector('.vf-workspace')).not.toHaveAttribute('data-theme');
  });
});
