import { ReportFixture } from './report-fixture';
import { GradingFixture } from './grading-fixture';
import { lazy, Suspense, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import enBase from '../../../../src/messages/en.json';
import viBase from '../../../../src/messages/vi.json';
import { withStaffUiMessages } from '../../../../src/messages/staff-ui';
import { withBenchMessages } from '../../../../src/messages/bench';
import { AppShell } from '../../../../src/components/AppShell';
import { StudioShell } from '../../../../src/components/StudioShell';
import { GradingShell } from '../../../../src/components/GradingShell';
import type { AdminScope, AdminScopeOption } from '../../../../src/lib/admin-scope';
import type { StaffWorkspace } from '../../../../src/lib/workspaces';
import type { Permission } from '../../../../src/lib/permissions';
import { Workspace, type WorkspaceDraft } from '../../../../src/features/studio/ui/Workspace';
import { emptySummary } from '../../../../src/content-engine/diagnostics';
import { CourseDocumentSchema } from '../../../../src/content-engine/schema/course';
import minimalManifest from '../../../../src/content-engine/fixtures/minimal/course.json';
import minimalLesson from '../../../../src/content-engine/fixtures/minimal/items/intro.json';
import '../../../../src/app/fonts.css';
import '../../../../src/app/globals.css';

const en = withStaffUiMessages(enBase, 'en');
const vi = withStaffUiMessages(viBase, 'vi');

function draft(): WorkspaceDraft {
  const manifest = CourseDocumentSchema.parse(structuredClone(minimalManifest));
  manifest.languages = ['vi', 'en'];
  manifest.defaultLanguage = 'vi';
  manifest.title = { vi: 'Khóa học tối giản', en: 'Minimal course' };
  manifest.summary = { vi: 'Khóa học nhỏ nhất hợp lệ.', en: 'Smallest valid course.' };
  manifest.learningOutcomes = [{ vi: 'Mở một bài học.', en: 'Open a lesson.' }];
  if (new URLSearchParams(location.search).get('large') === '1') {
    const item = manifest.modules[0]!.items[0]!;
    manifest.modules = Array.from({ length: 60 }, (_, index) => ({
      id: `module-${index}`,
      title: `${index} ${'x'.repeat(1_900)}`,
      items: [{ ...item }],
    })) as typeof manifest.modules;
  }
  const items: Record<string, unknown> = { intro: structuredClone(minimalLesson) };
  // `?itemnamedmanifest=1` adds an item whose id is literally `manifest`, which is
  // the case that used to collide with the course manifest's own source key.
  if (new URLSearchParams(location.search).get('itemnamedmanifest') === '1') {
    manifest.modules[0]!.items.push({ type: 'lesson', id: 'manifest', title: { vi: 'Bài tên manifest', en: 'Item named manifest' } } as never);
    items.manifest = { ...structuredClone(minimalLesson), id: 'manifest', title: { vi: 'Bài tên manifest', en: 'Item named manifest' } };
  }
  return { id: 'draft-minimal', courseId: 'minimal', manifest, items, baseVersionId: null, checklist: {}, updatedAt: '2026-09-06T00:00:00.000Z' };
}

/** Permissions of an operator who both grades and reads reports, so the whole sidebar renders. */
const GRADING_PERMISSIONS: Permission[] = ['submission.grade', 'exam.release', 'report.branch.read'];
/** Every workspace enterable, so the switcher renders all three entries. */
const WORKSPACE_ENTRIES = { studio: '/studio', grading: '/grading', admin: '/admin' } as const;
/** `?uiv2=1` renders the Catmin StaffWorkspaceShell (UI_V2_SURFACES) in place of the legacy shells. */
// The harness Link is a plain anchor, so every click is a full page load that drops the query
// string. The flag is remembered for the tab (sessionStorage) so queue → workbench stays Catmin.
const STAFF_UI = (() => {
  const flag = new URLSearchParams(location.search).get('uiv2');
  try {
    if (flag !== null) sessionStorage.setItem('harness-uiv2', flag);
    return (flag ?? sessionStorage.getItem('harness-uiv2')) === '1';
  } catch {
    return flag === '1';
  }
})();
// Loaded only under `?uiv2=1`, so legacy runs load exactly the modules they did before.
const staffFixture = () => import('./staff-shell-fixture');
const StaffHarnessShell = lazy(() => staffFixture().then(module => ({ default: module.StaffHarnessShell })));
const CoursesFixture = lazy(() => staffFixture().then(module => ({ default: module.CoursesFixture })));
// The Catmin page views (PR 3-10) with fixture data, loaded only on their own routes.
const pagesFixture = () => import('./staff-pages-fixture');
const StudioHomeFixture = lazy(() => pagesFixture().then(module => ({ default: module.StudioHomeFixture })));
const CoursesListFixture = lazy(() => pagesFixture().then(module => ({ default: module.CoursesListFixture })));
const MediaFixture = lazy(() => pagesFixture().then(module => ({ default: module.MediaFixture })));
const GradingHomeFixture = lazy(() => pagesFixture().then(module => ({ default: module.GradingHomeFixture })));
const GradingQueueFixture = lazy(() => pagesFixture().then(module => ({ default: module.GradingQueueFixture })));
const QueuedWorkbenchFixture = lazy(() => pagesFixture().then(module => ({ default: module.QueuedWorkbenchFixture })));
/** Harness clock zone; matches the product's report zone so relative and absolute times read the same everywhere. */
const TIME_ZONE = 'Asia/Ho_Chi_Minh';
/** A reviewer-author who reaches every Studio page view (home, courses, library, media, reviews). */
const STUDIO_PAGE_PERMISSIONS: Permission[] = ['content.read', 'content.create', 'content.review', 'content.publish', 'course.read', 'course.create', 'course.edit', 'media.upload', 'resource.edit'];

type ShellProps = { workspace: StaffWorkspace; redesigned: boolean; permissions: Permission[]; activeScope: AdminScope; scopeOptions: AdminScopeOption[]; children: React.ReactNode };

/** The legacy shell for the workspace, or StaffWorkspaceShell under `?uiv2=1`, with the same entries, permissions and scopes. */
function Shell({ workspace, redesigned, permissions, activeScope, scopeOptions, children }: ShellProps) {
  if (STAFF_UI) return <Suspense fallback={null}><StaffHarnessShell workspace={workspace} permissions={permissions} activeScope={activeScope} scopeOptions={scopeOptions} entries={WORKSPACE_ENTRIES}>{children}</StaffHarnessShell></Suspense>;
  const Legacy = workspace === 'grading' ? GradingShell : StudioShell;
  return <Legacy redesigned={redesigned} permissions={permissions} userName="Browser test" activeScope={activeScope} scopeOptions={scopeOptions} entries={WORKSPACE_ENTRIES}>{children}</Legacy>;
}

function App() {
  const initialDraft = useMemo(draft, []);
  const params = new URLSearchParams(location.search);
  const locale = params.get('lang') === 'en' ? 'en' : 'vi';
  const fixtureLocale = ((location.pathname.startsWith('/grading/') && location.pathname !== '/grading/reports') || location.pathname.startsWith('/studio/grading/')) ? 'en' : locale;
  useEffect(() => { document.documentElement.lang = fixtureLocale; }, [fixtureLocale]);
  const readOnly = params.get('readonly') === '1';
  // Reports and grading live in the assessment workspace, so the fixture must mount the real
  // GradingShell — the shell whose sidebar the screenshots exercise. StudioShell stays for
  // authoring only; mounting it here rendered an empty sidebar, because none of its authoring
  // navigation matches a grading permission.
  const gradingScope = { activeScope: { kind: 'branch', branchId: 'school' } as AdminScope, scopeOptions: [{ scope: { kind: 'branch', branchId: 'school' }, label: 'VFuture school', permissions: GRADING_PERMISSIONS }] as AdminScopeOption[] };
  const page = (pageLocale: 'vi' | 'en', workspace: StaffWorkspace, permissions: Permission[], scope: Pick<ShellProps, 'activeScope' | 'scopeOptions'>, content: React.ReactNode) => <NextIntlClientProvider locale={pageLocale} messages={pageLocale === 'en' ? en : vi} timeZone={TIME_ZONE}><Shell workspace={workspace} redesigned={params.has('redesigned')} permissions={permissions} {...scope}><Suspense fallback={null}>{content}</Suspense></Shell></NextIntlClientProvider>;
  const studioScope = { activeScope: { kind: 'central' } as AdminScope, scopeOptions: [{ scope: { kind: 'central' }, label: 'Central', permissions: STUDIO_PAGE_PERMISSIONS }] as AdminScopeOption[] };
  // Grading defaults to English like the workbench fixtures below; `?lang=vi|en` switches.
  const gradingLocale = params.get('lang') === 'vi' ? 'vi' : params.get('lang') === 'en' ? 'en' : null;
  if (location.pathname === '/grading') return page(gradingLocale ?? 'vi', 'grading', GRADING_PERMISSIONS, gradingScope, <GradingHomeFixture />);
  if (location.pathname === '/grading/queue') return page(gradingLocale ?? 'en', 'grading', GRADING_PERMISSIONS, gradingScope, <GradingQueueFixture />);
  if (/^\/grading\/assignments\/sub-\d+$/.test(location.pathname)) return page(gradingLocale ?? 'en', 'grading', GRADING_PERMISSIONS, gradingScope, <QueuedWorkbenchFixture id={location.pathname.split('/').at(-1)!} />);
  if (location.pathname === '/studio') return page(locale, 'studio', STUDIO_PAGE_PERMISSIONS, studioScope, <StudioHomeFixture />);
  if (location.pathname === '/studio/media') return page(locale, 'studio', STUDIO_PAGE_PERMISSIONS, studioScope, <MediaFixture />);
  // `?fixture=diacritics` keeps the plain list page whose 12px Vietnamese eyebrow the shell's clipping check reads.
  if (location.pathname === '/studio/courses' && params.get('fixture') !== 'diacritics') return page(locale, 'studio', STUDIO_PAGE_PERMISSIONS, studioScope, <CoursesListFixture />);
  if(location.pathname==='/studio/analytics'||location.pathname==='/grading/reports'){const reportLocale=params.get('lang')==='en'?'en':'vi';return <NextIntlClientProvider locale={reportLocale} messages={reportLocale==='en'?en:vi} timeZone={TIME_ZONE}><Shell workspace="grading" redesigned={params.has('redesigned')} permissions={GRADING_PERMISSIONS} activeScope={{kind:'branch',branchId:'school'}} scopeOptions={[{scope:{kind:'branch',branchId:'school'},label:'Trường VFuture',permissions:GRADING_PERMISSIONS}]}><ReportFixture/></Shell></NextIntlClientProvider>;}
  if(location.pathname.startsWith('/studio/grading/')||location.pathname.startsWith('/grading/'))return <NextIntlClientProvider locale="en" messages={en} timeZone={TIME_ZONE}><Shell workspace="grading" redesigned={params.has('redesigned')} permissions={GRADING_PERMISSIONS} activeScope={{kind:'branch',branchId:'school'}} scopeOptions={[{scope:{kind:'branch',branchId:'school'},label:'VFuture school',permissions:GRADING_PERMISSIONS}]}><GradingFixture kind={location.pathname.includes('/exams/')?'exams':'assignments'}/></Shell></NextIntlClientProvider>;
  if (location.pathname.startsWith('/app')) return <NextIntlClientProvider locale={locale} messages={withBenchMessages(locale === 'en' ? en : vi, locale)} timeZone={TIME_ZONE}><AppShell studioDestination="/studio" gradingDestination="/grading" adminDestination="/admin" userName="Nguyễn An" initials="NA"><h1>Học tập</h1><p>Account menu browser fixture</p></AppShell></NextIntlClientProvider>;
  return <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : vi} timeZone={TIME_ZONE}>
    <Shell workspace="studio" redesigned={params.has('redesigned')} permissions={['course.read', 'course.edit']} activeScope={{kind:'central'}} scopeOptions={[{scope:{kind:'central'},label:'Central',permissions:['course.read','course.edit']}]}>
      {location.pathname === '/studio/courses' ? <Suspense fallback={null}><CoursesFixture /></Suspense> : <Workspace initialDraft={initialDraft} initialReport={{ ok: true, errors: [], warnings: [], summary: emptySummary() }} readOnly={readOnly} accountId={params.get('account') ?? 'browser-author'} scopeKey={params.get('scope') ?? 'central'} />}
    </Shell>
  </NextIntlClientProvider>;
}

createRoot(document.getElementById('root')!).render(<App />);
