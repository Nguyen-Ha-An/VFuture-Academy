import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { FIXTURES } from '../../../src/content-engine/fixtures';
import { inlineWorkspace, parseWorkspace } from '../../../src/content-engine/validate';
import { assertE2EResetTarget } from './reset';

type Fixture = {
  courseId: string;
  inlineCourse: unknown;
  originalLessonSource: string;
};

async function findUserByEmail(admin: SupabaseClient, email: string) {
  for (let page = 1; ; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 1_000 });
    if (result.error) throw new Error('Studio import fixture could not inspect Auth users.');
    const found = result.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found || result.data.users.length < 1_000) return found ?? null;
  }
}

function markerMatches(value: unknown, namespace: string, courseId: string, ownerId: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const marker = value as Record<string, unknown>;
  return marker.recovery_fixture === true
    && marker.recovery_namespace === namespace
    && marker.recovery_course_id === courseId
    && marker.recovery_owner_id === ownerId;
}

export async function withDisposableStudioImport(run: (fixture: Fixture) => Promise<void>) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.SEED_ADMIN_EMAIL?.trim();
  if (!url || !key || !email) throw new Error('Studio import acceptance requires staging cleanup credentials and seeded admin email.');
  assertE2EResetTarget(url, process.env);

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const owner = await findUserByEmail(admin, email);
  if (!owner) throw new Error('Seeded Studio import owner was not found.');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const namespace = `main-studio:${suffix}`;
  const courseId = `main-studio-${suffix}`;
  const parsed = parseWorkspace(FIXTURES['ai-foundations']).parsed;
  if (!parsed) throw new Error('AI Foundations source fixture could not be parsed.');
  const manifest = { ...parsed.manifest, id: courseId, slug: courseId };
  const inlineCourse = inlineWorkspace({ ...parsed, manifest });
  const originalLessonSource = JSON.stringify(parsed.items['what-is-ai'], null, 2);
  const marker = {
    recovery_fixture: true,
    recovery_namespace: namespace,
    recovery_course_id: courseId,
    recovery_owner_id: owner.id,
  };
  let markerVerified = false;
  let primary: unknown;

  try {
    const existing = await admin.from('courses').select('id').eq('id', courseId).maybeSingle();
    if (existing.error || existing.data) throw new Error('Disposable Studio import namespace is not empty.');
    const created = await admin.rpc('studio_create_course', {
      p_course_id: courseId,
      p_actor_id: owner.id,
      p_manifest: manifest,
    });
    const [createdCourse, createdDraft] = await Promise.all([
      admin.from('courses').select('id,slug,owner_id').eq('id', courseId).maybeSingle(),
      admin.from('course_drafts').select('id,course_id,updated_at,updated_by').eq('course_id', courseId).maybeSingle(),
    ]);
    if (created.error || createdCourse.error || createdCourse.data?.id !== courseId
      || createdCourse.data.slug !== courseId || createdCourse.data.owner_id !== owner.id
      || createdDraft.error || typeof createdDraft.data?.id !== 'string'
      || createdDraft.data.course_id !== courseId || createdDraft.data.updated_by !== owner.id
      || typeof createdDraft.data.updated_at !== 'string') throw new Error('Disposable Studio import course creation failed.');
    const marked = await admin.from('course_drafts').update({ checklist: marker })
      .eq('id', createdDraft.data.id).eq('course_id', courseId)
      .eq('updated_at', createdDraft.data.updated_at)
      .select('id,course_id,checklist,updated_by').maybeSingle();
    const markerReadback = await admin.from('course_drafts')
      .select('id,course_id,checklist,updated_by').eq('id', createdDraft.data.id).eq('course_id', courseId).maybeSingle();
    if (marked.error || marked.data?.id !== createdDraft.data.id || markerReadback.error
      || markerReadback.data?.id !== createdDraft.data.id || markerReadback.data.course_id !== courseId
      || markerReadback.data.updated_by !== owner.id
      || !markerMatches(markerReadback.data.checklist, namespace, courseId, owner.id)) {
      throw new Error('Disposable Studio import ownership marker failed.');
    }
    markerVerified = true;
    await run({ courseId, inlineCourse, originalLessonSource });
  } catch (error) {
    primary = error;
  }

  const cleanupErrors: unknown[] = [];
  if (markerVerified) try {
    const [course, draft] = await Promise.all([
      admin.from('courses').select('id,slug,owner_id,current_version_id').eq('id', courseId).maybeSingle(),
      admin.from('course_drafts').select('id,course_id,checklist,updated_by').eq('course_id', courseId).maybeSingle(),
    ]);
    if (course.error || !course.data || course.data.id !== courseId || course.data.slug !== courseId
      || course.data.owner_id !== owner.id || draft.error || !draft.data || draft.data.course_id !== courseId
      || draft.data.updated_by !== owner.id || !markerMatches(draft.data.checklist, namespace, courseId, owner.id)) {
      throw new Error('Disposable Studio import cleanup ownership verification failed.');
    }
    if (typeof course.data.current_version_id === 'string') {
      const detached = await admin.from('courses').update({ current_version_id: null })
        .eq('id', courseId).eq('slug', courseId).eq('owner_id', owner.id)
        .eq('current_version_id', course.data.current_version_id).select('id').maybeSingle();
      if (detached.error || detached.data?.id !== courseId) throw new Error('Disposable Studio import version detach failed.');
    }
    const removed = await admin.from('courses').delete()
      .eq('id', courseId).eq('slug', courseId).eq('owner_id', owner.id).select('id').maybeSingle();
    if (removed.error || removed.data?.id !== courseId) throw new Error('Disposable Studio import course cleanup failed.');
    const publishEvents = await admin.from('publish_events').delete().eq('course_id', courseId);
    if (publishEvents.error) throw new Error('Disposable Studio import publication cleanup failed.');
    const audits = await admin.from('audit_log').delete().eq('target_type', 'course').eq('target_id', courseId);
    if (audits.error) throw new Error('Disposable Studio import audit cleanup failed.');
    const [absentCourse, absentEvents, absentAudits] = await Promise.all([
      admin.from('courses').select('id').eq('id', courseId).maybeSingle(),
      admin.from('publish_events').select('id', { count: 'exact', head: true }).eq('course_id', courseId),
      admin.from('audit_log').select('id', { count: 'exact', head: true }).eq('target_type', 'course').eq('target_id', courseId),
    ]);
    if (absentCourse.error || absentCourse.data || absentEvents.error || absentEvents.count !== 0
      || absentAudits.error || absentAudits.count !== 0) throw new Error('Disposable Studio import cleanup readback failed.');
  } catch (error) { cleanupErrors.push(error); }

  if (cleanupErrors.length) throw new AggregateError(primary ? [primary, ...cleanupErrors] : cleanupErrors, 'Studio import journey cleanup failed.');
  if (primary) throw primary;
}
