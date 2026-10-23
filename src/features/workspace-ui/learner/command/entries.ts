import { routes } from '@/lib/routes';

/**
 * The learner command menu's destinations. The hrefs are the ones the bench nav (AppShell) and the
 * account menu (LearnerAccountActions) link to, so the palette never offers a route the shell lacks;
 * tests/features/workspace-ui/learner-command.test.tsx keeps the three lists equal. Pure, so the
 * trigger chunk can import it without cmdk.
 */

export type LearnerCommandGroup = 'goTo' | 'explore' | 'account' | 'workspaces';

export type LearnerCommandEntry = {
  /** Unique cmdk value; never matched against the query. */
  id: string;
  group: LearnerCommandGroup;
  href: string;
  label: string;
  /** The other locale's label plus synonyms, searched after the label. */
  keywords: string;
  /** Section code (A1–A3) shown beside Go to entries. */
  code?: string;
  /** The `g` then digit shortcut from BenchBar, for Go to entries. */
  shortcutKey?: string;
};

export type LearnerCommandDestinations = {
  studio?: string | null;
  grading?: string | null;
  admin?: string | null;
};

/** Translators the entries read: `learner.focus`, `common`, `bench.learner.command` and its keywords. */
export type LearnerCommandTranslators = {
  focus: (key: string) => string;
  common: (key: string) => string;
  command: (key: string) => string;
  keywords: (key: string) => string;
};

export function learnerCommandEntries({ focus, common, command, keywords }: LearnerCommandTranslators, destinations: LearnerCommandDestinations = {}): LearnerCommandEntry[] {
  const entry = (group: LearnerCommandGroup, key: string, href: string, label: string, extra: Partial<LearnerCommandEntry> = {}): LearnerCommandEntry =>
    ({ id: `${group}:${key}`, group, href, label, keywords: keywords(key), ...extra });
  const profile = routes.learner.profile();
  const workspaces = [
    { key: 'studio', href: destinations.studio, label: common('openStudio') },
    { key: 'grading', href: destinations.grading, label: common('openGrading') },
    { key: 'admin', href: destinations.admin, label: common('openAdmin') },
  ].flatMap(item => item.href ? [entry('workspaces', item.key, item.href, item.label)] : []);
  return [
    // Same order, codes and digits as AppShell's bench nav and useSectionShortcuts.
    entry('goTo', 'learning', routes.learner.dashboard(), focus('learning'), { code: 'A1', shortcutKey: '1' }),
    entry('goTo', 'courses', routes.learner.courses(), focus('courses'), { code: 'A2', shortcutKey: '2' }),
    entry('goTo', 'explore', routes.learner.explore(), focus('explore'), { code: 'A3', shortcutKey: '3' }),
    entry('explore', 'resources', routes.learner.resources(), focus('resources')),
    entry('explore', 'opportunities', routes.learner.opportunities(), focus('opportunities')),
    entry('explore', 'projects', routes.learner.projects(), focus('projects')),
    // The Projects page's primary action, so a proposal is one jump away.
    entry('explore', 'propose', routes.learner.newProject(), command('propose')),
    entry('account', 'profile', profile, focus('profile')),
    entry('account', 'certificates', `${profile}#certificates-heading`, focus('certificates')),
    entry('account', 'xp', `${profile}#xp-heading`, 'XP'),
    entry('account', 'leaderboard', routes.learner.leaderboard(), focus('leaderboard')),
    ...workspaces,
  ];
}
