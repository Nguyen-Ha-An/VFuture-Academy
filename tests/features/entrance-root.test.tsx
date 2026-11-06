// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), actor: vi.fn(), entries: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock('@/lib/auth', () => ({ getSessionUser: mocks.user }));
vi.mock('@/lib/permissions', () => ({ getActor: mocks.actor }));
vi.mock('@/lib/workspace-admission', () => ({ workspaceEntries: mocks.entries }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/components/AuthForm', () => ({ AuthForm: () => null }));
vi.mock('@/features/workspace-ui/auth/EntranceShell', () => ({ EntranceShell: () => null }));
import AcademyHomePage from '@/app/(public)/page';

it('renders the entrance for anonymous visitors and sends returning staff to an accessible workspace', async () => {
  mocks.actor.mockResolvedValue(null);
  mocks.user.mockResolvedValue(null);
  expect(await AcademyHomePage({ searchParams: Promise.resolve({}) })).toBeTruthy();
  expect(mocks.actor).not.toHaveBeenCalled();
  mocks.user.mockResolvedValue({ id: 'staff' });
  mocks.actor.mockResolvedValue({ userId: 'staff' });
  mocks.entries.mockReturnValue({ studio: null, grading: '/grading', admin: null });
  await expect(AcademyHomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect:/grading');
  await expect(AcademyHomePage({ searchParams: Promise.resolve({ next: '/app/courses/course?item=1' }) })).rejects.toThrow('redirect:/app/courses/course?item=1');
  await expect(AcademyHomePage({ searchParams: Promise.resolve({ next: 'https://evil.invalid' }) })).rejects.toThrow('redirect:/app');
});
