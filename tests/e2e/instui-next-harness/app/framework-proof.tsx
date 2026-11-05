'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { Outline } from '@/features/studio/ui/Outline';
import { StudioResponsiveTable } from '@/features/studio/ui/StudioResponsiveTable';
import { COURSE_REF, emptySummary, type DocumentRef } from '@/content-engine/diagnostics';
import { AppShell } from '@/components/AppShell';
import { StaffWorkspaceShell } from '@/features/staff-ui/ui/StaffWorkspaceShell';
import { CanvasCourseLayout, CanvasButton, CanvasDataTable, CanvasFormFieldGroup, CanvasProgressBar, CanvasSelect, CanvasTable, CanvasTabs } from '@/features/canvas/ui';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { withStaffUiMessages } from '@/messages/staff-ui';
import { withBenchMessages } from '@/messages/bench';
import en from '@/messages/en.json';
import vi from '@/messages/vi.json';
import '@/app/globals.css';

function NativeComposition({ children, locale }: { children: ReactNode; locale: 'en' | 'vi' }) {
  const nativeId = useId();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const [tab, setTab] = useState(0);
  const [selection, setSelection] = useState<DocumentRef>(COURSE_REF);
  const [selectedItem, setSelectedItem] = useState('None');
  return <section className="min-w-0 space-y-6 p-4" data-testid="native-composition" data-native-root-id={nativeId} data-client-native-id={hydrated ? nativeId : undefined} data-framework-hydrated={hydrated}>
    <h1 className="text-2xl font-semibold">{locale === 'vi' ? 'Kiểm chứng thành phần khóa học' : 'Course framework proof'}</h1>
    {children}
    <CanvasProgressBar screenReaderLabel="Course progress" valueNow={2} valueMax={5} />
    <CanvasTabs screenReaderLabel="Course sections" onRequestTabChange={(_event, data) => setTab(data.index)}>
      <CanvasTabs.Panel renderTitle="Modules" isSelected={tab === 0}><div className="space-y-3"><h2>Learning modules</h2><div className="h-64"><Outline manifest={{ id: 'proof-course', modules: [{ id: 'module', title: 'Module one', items: [{ id: 'introduction', type: 'lesson', title: 'Introduction' }, { id: 'practice', type: 'assignment', title: 'Practice' }] }] }} items={{ introduction: {}, practice: {} }} report={{ ok: true, errors: [], warnings: [], summary: emptySummary() }} selectedRef={selection} onSelect={ref => { setSelection(ref); setSelectedItem(ref.kind === 'item' ? ref.id : 'Course settings'); }} readOnly onManifestChange={() => { throw new Error('Read-only proof outline mutated.'); }} /></div><output aria-label="Selected module item">{selectedItem}</output></div></CanvasTabs.Panel>
      <CanvasTabs.Panel renderTitle="Results" isSelected={tab === 1}><div><h2>Recorded results</h2><p>Scores are local test data.</p></div></CanvasTabs.Panel>
    </CanvasTabs>
    <StudioResponsiveTable caption="Course records">
      <CanvasTable.Head><CanvasTable.Row><CanvasTable.ColHeader id="proof-title">Item</CanvasTable.ColHeader><CanvasTable.ColHeader id="proof-status">Status</CanvasTable.ColHeader><CanvasTable.ColHeader id="proof-score" textAlign="end">Score</CanvasTable.ColHeader></CanvasTable.Row></CanvasTable.Head>
      <CanvasTable.Body><CanvasTable.Row><CanvasTable.Cell>Introduction</CanvasTable.Cell><CanvasTable.Cell>Completed</CanvasTable.Cell><CanvasTable.Cell textAlign="end">8 / 10</CanvasTable.Cell></CanvasTable.Row><CanvasTable.Row><CanvasTable.Cell>Practice</CanvasTable.Cell><CanvasTable.Cell>Submitted</CanvasTable.Cell><CanvasTable.Cell textAlign="end">Pending</CanvasTable.Cell></CanvasTable.Row></CanvasTable.Body>
    </StudioResponsiveTable>
    <CanvasDataTable caption="Staff records" rows={[{ id: 'staff-record', title: 'Staff record from server', state: 'Waiting for review' }]} rowKey={row => row.id} columns={[
      { key: 'title', label: 'Record', render: row => row.title },
      { key: 'state', label: 'Review state', render: row => row.state },
    ]} />
    <PortalOwnershipProof />
  </section>;
}

function PortalOwnershipProof() {
  const [value, setValue] = useState('standard');
  const content = useRef<HTMLDivElement>(null);
  return <Sheet><SheetTrigger asChild><CanvasButton variant="outline">Open course settings</CanvasButton></SheetTrigger>
    <SheetContent ref={content} className="w-[min(92vw,30rem)] sm:max-w-md">
      <SheetHeader><SheetTitle>Course settings</SheetTitle><SheetDescription>Local portal and focus regression proof.</SheetDescription></SheetHeader>
      <div data-testid="settings-scroll" className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <p style={{ paddingBottom: '45rem' }}>Scroll to the field below. No backend is called.</p>
        <CanvasFormFieldGroup description="Submission settings" layout="stacked">
          <CanvasSelect label="Deadline policy" value={value} options={[{value:'standard',label:'Standard'},{value:'extended',label:'Extended'}]} onChange={setValue} mountNode={() => content.current} optionsMaxHeight="12rem" />
        </CanvasFormFieldGroup>
        <p className="pt-80">End of settings.</p>
      </div>
      <output aria-label="Selected deadline policy">{value}</output>
    </SheetContent>
  </Sheet>;
}

export function FrameworkProof({ children, locale = 'en', theme = 'light' }: { children: ReactNode; locale?: 'en' | 'vi'; theme?: 'light' | 'dark' }) {
  const frameworkId = useId();
  const [clientFrameworkId, setClientFrameworkId] = useState<string | null>(null);
  useEffect(() => { setClientFrameworkId(frameworkId); }, [frameworkId]);
  const pathname = usePathname();
  const staff = pathname.startsWith('/studio');
  const messages = withBenchMessages(withStaffUiMessages(locale === 'vi' ? vi : en, locale), locale);
  const content = <NativeComposition locale={locale}>{children}</NativeComposition>;
  return <div lang={locale} data-framework-root-id={frameworkId} data-client-framework-id={clientFrameworkId ?? undefined}><NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Ho_Chi_Minh">{staff ? <StaffWorkspaceShell workspace="studio" chrome={{ theme, sidebarOpen: true, identity: { name: 'Local test educator', email: null, avatarUrl: null, initials: 'LT' } }} permissions={['course.read', 'course.edit', 'content.read', 'content.review']} activeScope={{ kind: 'central' }} scopeOptions={[{ scope: { kind: 'central' }, label: 'Central', permissions: ['course.read', 'course.edit', 'content.read', 'content.review'] }]} entries={{ studio: '/studio', grading: '/grading', admin: '/admin' }}>{content}</StaffWorkspaceShell> : <AppShell theme={theme} userName="Local test learner" initials="LL" studioDestination="/studio" gradingDestination="/grading" adminDestination="/admin"><CanvasCourseLayout navigationLabel="Course navigation" navigation={<nav aria-label="Course destinations"><a href="#overview">Overview</a><a href="#modules">Modules</a><a href="#grades">Grades</a></nav>}>{content}</CanvasCourseLayout></AppShell>}</NextIntlClientProvider></div>;
}
