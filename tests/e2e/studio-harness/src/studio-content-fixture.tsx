import { useLayoutEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { BankListView } from '@/features/studio/ui/content/BankListView';
import { BankQuestionEditor, type BankQuestionDetail } from '@/features/studio/ui/BankQuestionEditor';
import { ContentListView } from '@/features/studio/ui/content/ContentListView';
import { ResourceEditor } from '@/features/resources/ui/ResourceEditor';
import { OpportunityEditor } from '@/features/opportunities/ui/OpportunityEditor';
import { StudioProjectForm } from '@/features/projects/ui/StudioProjectForm';
import { ContentInventory, ReviewQueue, type ContentRow, type ReviewRow } from '@/features/admin/components/ContentReviewWorkspace';
import { EditorPageHeader } from '@/features/studio/ui/content/EditorPageHeader';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
import { StatusBadge } from '@/features/staff-ui/components/StatusBadge';
import { McpSetupView } from '@/features/studio/ui/McpSetupView';
import { ConsentPanel } from '@/features/oauth-consent/ConsentPanel';
import { NotebookWorkspace } from '@/features/notebooks/ui/NotebookWorkspace';
import { compileBankQuestion } from '@/content-engine/compile';
import { FIXTURES } from '@/content-engine/fixtures';
import { QuestionSchema } from '@/content-engine/schema/questions';
import { ResourceDocumentSchema } from '@/content-engine/schema/bundle';
import { OpportunityFormSchema } from '@/features/opportunities/schema';
import type { ProjectDetail } from '@/features/projects/service';
import { AuditFixture } from '../../admin-harness/src/admin-pages-fixture';
import data from './studio-content-data.json';

// Actual client components receive plain, local fixture data as their server pages do.
// No real service, identity, authorization, publication or hosted state is represented.
const resource = ResourceDocumentSchema.parse(data.resource);
const opportunity = OpportunityFormSchema.parse(data.opportunity);
const newResource = ResourceDocumentSchema.parse({ ...resource, id: 'new-resource', languages: ['vi', 'en'], defaultLanguage: 'vi', title: { vi: 'Tài nguyên mới', en: 'New resource' }, summary: { vi: 'Mô tả ngắn.', en: 'Short summary.' }, tags: [], skills: [], pathways: [], body: { vi: { blocks: [{ type: 'paragraph', content: [{ text: 'Bắt đầu viết nội dung.' }] }] }, en: { blocks: [{ type: 'paragraph', content: [{ text: 'Start writing the content.' }] }] } } });
const newOpportunity = OpportunityFormSchema.parse({ ...opportunity, id: 'new-opportunity', title: { vi: 'Cơ hội mới', en: 'New opportunity' }, organization: 'VFuture', type: 'event', description: { vi: { blocks: [{ type: 'paragraph', content: [{ text: 'Mô tả cơ hội.' }] }] }, en: { blocks: [{ type: 'paragraph', content: [{ text: 'Describe the opportunity.' }] }] } }, eligibility: {}, recommendedSkills: [], recommendedCourses: [], openAt: null, closeAt: null, location: null, online: false });
const project: ProjectDetail = { ...data.project, status: 'active', branchScope: { scope: 'global' }, members: [
  { userId: '00000000-0000-4000-8000-000000000101', role: 'owner', displayName: 'Nguyễn An', handle: 'nguyen-an' },
  { userId: '00000000-0000-4000-8000-000000000102', role: 'member', displayName: 'Linh Trần', handle: 'linh-tran' },
], viewerRole: null };
const bank = data.bank as BankQuestionDetail;
const revision = '2026-11-01T00:00:00.000Z';
const scope = { kind: 'central' as const };
const contentRows: ContentRow[] = [
  { content_type: 'course', content_id: 'minimal', title: { en: 'Minimal course', vi: 'Khóa học tối giản' }, status: 'draft', studio_href: '/studio/courses/minimal' },
  { content_type: 'resource', content_id: resource.id, title: resource.title, status: 'draft', studio_href: `/studio/resources/${resource.id}` },
  { content_type: 'opportunity', content_id: opportunity.id, title: opportunity.title, status: 'published', studio_href: `/studio/opportunities/${opportunity.id}` },
  { content_type: 'project', content_id: project.id, title: project.title, status: 'draft', studio_href: `/studio/projects/${project.id}` },
].map(row => ({ ...row, audience: { scope: 'global' }, ownership_kind: 'central' as const, owner_branch_id: null, updated_at: revision, revision_key: revision, review_status: null }));
const reviews: ReviewRow[] = contentRows.slice(0, 2).map((row, index) => ({ id: `fixture-review-${index + 1}`, content_type: row.content_type, content_id: row.content_id, status: 'pending', owner_branch_id: null, submitted_at: revision, decision_note: null, self_review: false, revision_key: revision, checksum: `fixture-checksum-${index + 1}`, dependencies: [], submitted_by: 'fixture-author' }));
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }

function FixtureApi({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const original = window.fetch;
    let pending = false;
    let sequence = 0;
    let savedResource = { id: resource.id, document: resource, status: 'draft', ownerId: 'fixture-author', publishedAt: null, updatedAt: revision };
    let savedOpportunity: Record<string, unknown> = { ...opportunity, updated_at: revision, status: 'draft' };
    let savedProject: Record<string, unknown> = { ...project };
    let savedBank = structuredClone(bank);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.origin);
      if (!url.pathname.startsWith('/api/v1/studio/')) return original(input, init);
      const path = url.pathname;
      const state = new URLSearchParams(location.search).get('fixture');
      if (state === 'error') return response({ error: { code: 'FIXTURE_UNAVAILABLE', message: 'Local fixture: service unavailable.' } }, 503);
      const method = init?.method ?? 'GET';
      let body: Record<string, unknown> = {};
      if (typeof init?.body === 'string') { try { body = JSON.parse(init.body); } catch { return response({ error: { message: 'Invalid JSON' } }, 400); } }
      const nextRevision = () => new Date(Date.parse(revision) + (++sequence * 1_000)).toISOString();
      if (path.endsWith('/workflow')) {
        const match = path.match(/content\/([^/]+)\/([^/]+)\/workflow$/);
        const type = match?.[1] ?? 'resource'; const id = match?.[2] ?? resource.id;
        const currentRevision = type === 'bank_question' ? savedBank.latestVersion.id : type === 'resource' ? savedResource.updatedAt : type === 'opportunity' ? savedOpportunity.updated_at : type === 'project' ? savedProject.updatedAt : revision;
        const locked = pending || state === 'pending';
        return response({ data: { content: { contentType: type, contentId: id, revisionKey: currentRevision, status: state === 'published' ? 'published' : 'draft', publishedRevisionKey: state === 'published' ? currentRevision : null }, activeReview: locked ? { id: 'fixture-review-1', status: 'pending', revisionKey: currentRevision, note: null } : null, publication: state === 'published' ? { revisionKey: currentRevision } : null, actions: { requestReview: !locked && state !== 'published', withdrawReview: locked, approveAndPublish: false, mutate: !locked } } });
      }
      if (path.endsWith('/reviews') && method === 'POST') { pending = true; return response({ data: { id: 'fixture-review-1', status: 'pending' } }); }
      if (path.endsWith('/withdraw')) { pending = false; return response({ data: { status: 'withdrawn' } }); }
      if (path.endsWith('/approve-and-publish')) return response({ data: { status: 'published' } });
      if (path.endsWith('/decision')) return response({ data: { status: 'changes_requested' } });
      if (/\/reviews\/[^/]+$/.test(path)) {
        const row = reviews.find(row => path.endsWith(`/${row.id}`)) ?? reviews[0];
        const source = row.content_type === 'resource' ? { document: resource } : FIXTURES.minimal;
        return response({ data: { review: row, snapshot: { revision_key: revision, ownership_kind: 'central', owner_branch_id: null, audience: { scope: 'global' }, dependencies: [] }, reviewed_source: source, published_snapshot: null } });
      }
      if (path.includes('/bank/validate')) { const parsed = QuestionSchema.safeParse(body); return parsed.success ? response({ data: { ok: true } }) : response({ error: { message: 'Question schema validation failed.', issues: parsed.error.issues } }, 422); }
      if (path.includes('/bank/')) {
        if (method === 'PUT') { const question = QuestionSchema.parse(body); const compiled = await compileBankQuestion(question, ['vi', 'en'], 'vi'); savedBank = { ...savedBank, latestVersion: { ...savedBank.latestVersion, id: `fixture-bank-v${++sequence}`, version: sequence + 1, payload: question, renders: compiled.renders, grading: compiled.grading } }; return response({ data: { versionId: savedBank.latestVersion.id } }); }
        return response({ data: savedBank });
      }
      if (path.includes('/resources')) {
        if (method !== 'GET') { const document = ResourceDocumentSchema.parse(body.document); savedResource = { ...savedResource, id: document.id, document, updatedAt: nextRevision() }; }
        return response({ data: savedResource });
      }
      if (path.includes('/opportunities')) {
        if (method !== 'GET') savedOpportunity = { ...OpportunityFormSchema.parse(body.document), updated_at: nextRevision(), status: 'draft' };
        return response({ data: savedOpportunity });
      }
      if (path.includes('/projects')) {
        if (method !== 'GET') savedProject = { ...project, ...body, updatedAt: nextRevision() };
        return response({ data: savedProject });
      }
      if (path.includes('/notebooks/session')) return response({ data: { userId: 'fixture-author', courseId: 'minimal', courseVersionId: null, itemId: 'hello', blockId: null, config: null, template: null, datasets: [], draft: null, studioRevision: revision, assignment: null } });
      return response({ error: { code: 'FIXTURE_NOT_IMPLEMENTED', message: `Local fixture does not implement ${path}.` } }, 501);
    };
    setReady(true);
    return () => { window.fetch = original; };
  }, []);
  return ready ? children : <p role="status">Loading local fixture…</p>;
}

function FixtureContent({ path }: { path: string }) {
  const locale = useLocale() === 'vi' ? 'vi' : 'en';
  const t = useTranslations('cmsAdmin');
  const bankT = useTranslations('studio.bank.detail');
  const resourcesT = useTranslations('studio.resources');
  const opportunitiesT = useTranslations('studio.opportunities');
  const projectsT = useTranslations('studio.projects');
  const params = new URLSearchParams(location.search);
  const empty = params.get('fixture') === 'empty';
  const title = (value: unknown): string => typeof value === 'string' ? value : String((value as Record<string, unknown> | null)?.[locale] ?? (value as Record<string, unknown> | null)?.vi ?? (value as Record<string, unknown> | null)?.en ?? '');
  const isNew = path.endsWith('/new');
  if (path === '/studio/bank') return <BankListView questions={empty ? [] : [{ id: bank.id, type: 'single_choice', tags: ['authoring', 'orientation'], difficulty: 'easy', status: 'draft', usages: [{ versionId: 'fixture-course-v1', itemId: 'intro', courseId: 'minimal' }] }]} filters={{}} />;
  if (path.startsWith('/studio/bank/')) return <div className="mx-auto flex w-full max-w-7xl flex-col gap-6"><Link href="/studio/bank" className="text-sm text-muted-foreground">← {bankT('back')}</Link><StaffPageHeader eyebrow={bankT('eyebrow')} title={bankT('titleFallback')} actions={<StatusBadge kind="content" value="draft" />} /><BankQuestionEditor initialDetail={bank} recoveryKey="harness:studio:bank" /></div>;
  if (path === '/studio/library') return <ContentInventory rows={empty ? [] : contentRows} scope={scope} actorId="fixture-reviewer" branches={[]} creatableTypes={['course', 'resource', 'opportunity', 'project']} requestableKeys={contentRows.map(row => `${row.content_type}:${row.content_id}`)} title={t('title')} description={t('description')} />;
  if (['/studio/resources', '/studio/opportunities', '/studio/projects'].includes(path)) {
    const kind = path.includes('resources') ? 'resource' : path.includes('opportunities') ? 'opportunity' : 'project';
    const source = kind === 'resource' ? resource : kind === 'opportunity' ? opportunity : project;
    return <ContentListView kind={kind} rows={empty ? [] : [{ id: source.id, title: title(source.title), status: kind === 'project' ? 'active' : 'draft', type: kind === 'resource' ? resource.resourceType : kind === 'opportunity' ? opportunity.type : null, secondary: kind === 'opportunity' ? opportunity.organization : null, updatedAt: revision, approved: false }]} />;
  }
  if (path.startsWith('/studio/resources/')) { const document = isNew ? newResource : resource; return <div className="mx-auto flex w-full max-w-7xl flex-col gap-6"><EditorPageHeader backHref="/studio/resources" backLabel={resourcesT('back')} title={title(document.title) || resourcesT('untitled')} status={{ kind: 'content', value: 'draft', label: resourcesT('statuses.draft') }} /><ResourceEditor initialDocument={document} initialRecord={isNew ? undefined : { id: resource.id, document: resource, status: 'draft', ownerId: 'fixture-author', publishedAt: null, updatedAt: revision }} isNew={isNew} canPublish recoveryKey="harness:studio:resource" /></div>; }
  if (path.startsWith('/studio/opportunities/')) { const value = isNew ? newOpportunity : opportunity; return <div className="mx-auto flex w-full max-w-7xl flex-col gap-6"><EditorPageHeader backHref="/studio/opportunities" backLabel={opportunitiesT('back')} title={title(value.title)} status={{ kind: 'content', value: 'draft', label: opportunitiesT('statuses.draft') }} /><OpportunityEditor initialValue={value} initialUpdatedAt={isNew ? null : revision} isNew={isNew} canPublish recoveryKey="harness:studio:opportunity" /></div>; }
  if (path.startsWith('/studio/projects/')) return <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">{isNew ? <><Link href="/studio/projects" className="text-sm text-muted-foreground">{projectsT('detail.back')}</Link><StaffPageHeader title={projectsT('createTitle')} description={projectsT('createDescription')} /></> : <EditorPageHeader backHref="/studio/projects" backLabel={projectsT('detail.back')} eyebrow={projectsT('detail.eyebrow')} title={title(project.title)} status={{ kind: 'project', value: project.status }} />}<StudioProjectForm mode={isNew ? 'create' : 'edit'} initial={isNew ? undefined : project} recoveryKey="harness:studio:project" /></div>;
  if (path === '/studio/reviews' || path.startsWith('/studio/reviews/')) {
    const selected = path.startsWith('/studio/reviews/') ? reviews.find(row => row.id === path.split('/').at(-1)) : null;
    const initialReview = selected ? { review: selected, snapshot: { revision_key: revision, ownership_kind: 'central', owner_branch_id: null, audience: { scope: 'global' }, dependencies: [] }, reviewed_source: selected.content_type === 'resource' ? { document: resource } : FIXTURES.minimal, published_snapshot: null } : undefined;
    const rows = params.get('fixture') === 'long' ? Array.from({ length: 24 }, (_,index) => ({ ...reviews[index % reviews.length], id: index < 2 ? reviews[index].id : `long-${index}` })) : reviews;
    return <section className="space-y-6">{!initialReview && <StaffPageHeader title={t('reviewsTitle')} description={t('reviewsDescription')} />}<ReviewQueue rows={empty ? [] : rows} canReview canPublish scope={scope} actorId="fixture-reviewer" branches={[]} titles={Object.fromEntries(contentRows.map(row => [`${row.content_type}:${row.content_id}`, row.title]))} submitters={{ 'fixture-author': 'Nguyễn An' }} initialReview={initialReview} returnHref={params.get('returnTo') ?? undefined} /></section>;
  }
  if (path === '/studio/mcp') { const state = params.get('fixture'); return <McpSetupView state={state === 'restricted' || state === 'unavailable' ? { kind: state } : { kind: state === 'disabled' ? 'disabled' : 'enabled', endpoint: `${location.origin}/api/mcp/studio`, provider: 'azure' }} />; }
  if (path === '/studio/connect/authorize') return <ConsentPanel state={{ kind: 'microsoft' }} />;
  if (/^\/studio\/courses\/[^/]+\/notebooks\/[^/]+$/.test(path)) return <NotebookWorkspace locator={{ courseId: 'minimal', itemId: 'hello', blockId: params.get('blockId') }} studio runtimeUrl={null} />;
  if (path === '/admin/audit') return <AuditFixture />;
  return <p role="status" data-fixture-unavailable>Fixture unavailable for {path}. This is not the course Workspace.</p>;
}

export function StudioContentFixture({ path }: { path: string }) {
  return <div data-studio-content-fixture={path}><FixtureApi><FixtureContent path={path} /></FixtureApi></div>;
}
