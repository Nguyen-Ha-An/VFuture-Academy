import { withBenchMessages } from '../bench';
import admin from './admin.json';
import adminMembers from './admin-members.json';
import adminMcp from './admin-mcp.json';
import adminOrg from './admin-org.json';
import adminOverview from './admin-overview.json';
import grading from './grading.json';
import gradingHome from './grading-home.json';
import gradingWorkbench from './grading-workbench.json';
import insights from './insights.json';
import kit from './kit.json';
import shell from './shell.json';
import shellAccount from './shell-account.json';
import shellCommand from './shell-command.json';
import shellCore from './shell-core.json';
import shellSwitcher from './shell-switcher.json';
import studio from './studio.json';
import studioContent from './studio-content.json';
import studioCourses from './studio-courses.json';
import studioHome from './studio-home.json';
import studioMcp from './studio-mcp.json';

type Locale = 'vi' | 'en';
type Catalog = { vi: Record<string, unknown>; en: Record<string, unknown> };
type Tree = Record<string, unknown>;

/**
 * Staff workspace refresh strings live in per-area files (kit/insights/shell/admin/studio/grading),
 * merged under the `staffUi` namespace so each page PR owns its catalog without editing the main
 * locale files. An area may be split into part files (`<area>-<part>.json`) so parallel work never
 * shares a file; parts deep-merge into their area and must not redefine each other's keys.
 * Every file keeps identical vi and en key trees (tests/features/staff-ui/messages-parity.test.ts).
 */
export const staffUiCatalogs = {
  kit: [kit],
  insights: [insights],
  shell: [shell, shellCore, shellSwitcher, shellAccount, shellCommand],
  admin: [admin, adminOverview, adminMembers, adminMcp, adminOrg],
  studio: [studio, studioHome, studioCourses, studioContent, studioMcp],
  grading: [grading, gradingHome, gradingWorkbench],
} satisfies Record<string, Catalog[]>;

type Area = keyof typeof staffUiCatalogs;

/** Deep-merges message trees; a leaf defined twice is a catalog bug, so it throws instead of silently winning. */
export function mergeCatalogTrees(trees: Tree[], path = ''): Tree {
  const merged: Tree = {};
  for (const tree of trees) {
    for (const [key, value] of Object.entries(tree)) {
      const at = path ? `${path}.${key}` : key;
      const existing = merged[key];
      if (existing === undefined) merged[key] = value;
      else if (isTree(existing) && isTree(value)) merged[key] = mergeCatalogTrees([existing, value], at);
      else throw new Error(`staffUi message "${at}" is defined in more than one catalog file`);
    }
  }
  return merged;
}

function isTree(value: unknown): value is Tree {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function staffUiMessages(locale: Locale) {
  const areas = Object.keys(staffUiCatalogs) as Area[];
  return Object.fromEntries(areas.map((area) => [area, mergeCatalogTrees(staffUiCatalogs[area].map((catalog) => catalog[locale]))])) as Record<Area, Tree>;
}

export function withStaffUiMessages<T extends Record<string, unknown>>(messages: T, locale: Locale): T & { staffUi: ReturnType<typeof staffUiMessages> } {
  return { ...messages, staffUi: staffUiMessages(locale) };
}

/** Test helper: the same composition as src/i18n/request.ts, e.g. `staffUiTestMessages(en, 'en')` for NextIntlClientProvider. */
export function staffUiTestMessages<T extends Record<string, unknown>>(base: T, locale: Locale = 'en') {
  return withStaffUiMessages(withBenchMessages(base, locale), locale);
}
