import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { compileCourse, InMemoryResolver, parseWorkspace, type CourseWorkspace } from '@/content-engine';
import { assertE2EResetTarget } from './reset';

const BRANCH_ID = 'vinsmc';

export type CertificateReceiptCounts = {
  completions: number;
  certificates: number;
  xp: number;
  evidence: number;
};

export type DisposableProfileCertificateFixture = {
  courseId: string;
  courseTitle: string;
  versionId: string;
  lessonId: string;
  skillId: string;
  canonicalOrigin: string;
  learner: { id: string; email: string; password: string; displayName: string; handle: string };
  receiptCounts(): Promise<CertificateReceiptCounts>;
  certificate(): Promise<{
    id: string;
    serial: string;
    verificationCode: string;
    pdfAssetId: string;
  } | null>;
};

type CreatedState = { learner: boolean; course: boolean; skill: boolean; learnerId?: string };

export function disposableProfileCertificateWorkspace(
  courseId: string,
  lessonId: string,
  skillId: string,
  suffix: string,
): CourseWorkspace {
  return {
    manifest: {
      schemaVersion: 1,
      kind: 'course',
      id: courseId,
      slug: courseId,
      title: { vi: `Chứng nhận phục hồi ${suffix}`, en: `Recovery certificate ${suffix}` },
      summary: 'Disposable certificate issuance and public verification acceptance.',
      languages: ['en', 'vi'],
      defaultLanguage: 'en',
      level: 'foundation',
      difficulty: 'beginner',
      pathway: 'core-future-skills',
      learningOutcomes: ['Complete one viewed lesson and receive one durable certificate.'],
      access: { scope: 'global' },
      enrollment: 'open',
      skills: [{ id: skillId, name: { vi: 'Bằng chứng phục hồi', en: 'Recovery evidence' } }],
      completion: { rules: [{ type: 'all_items' }], certificate: true },
      modules: [{ id: 'completion', title: 'Completion', items: [{ type: 'lesson', id: lessonId, required: true }] }],
    },
    items: {
      [lessonId]: {
        schemaVersion: 1,
        kind: 'lesson',
        id: lessonId,
        title: { vi: 'Hoàn thành chứng nhận', en: 'Complete certificate' },
        objectives: ['Record a durable viewed completion.'],
        estimatedMinutes: 1,
        completion: { mode: 'view' },
        blocks: [{ type: 'paragraph', content: [{ text: 'Opening this lesson records the only required completion.' }] }],
      },
    },
  } as CourseWorkspace;
}

async function compilePublication(courseId: string, lessonId: string, skillId: string, suffix: string) {
  const source = disposableProfileCertificateWorkspace(courseId, lessonId, skillId, suffix);
  const compilation = await compileCourse(source, new InMemoryResolver({}), { publish: true, locales: ['en', 'vi'] });
  if (!compilation.ok || !compilation.compiled) throw new Error('Disposable certificate fixture did not compile.');
  const parsed = parseWorkspace(source).parsed;
  if (!parsed) throw new Error('Disposable certificate fixture source did not parse.');
  return {
    manifest: parsed.manifest,
    compiled: {
      ...compilation.compiled,
      items: Object.fromEntries(Object.entries(compilation.compiled.items).map(([itemId, item]) => [itemId, {
        ...item,
        source: parsed.items[itemId],
      }])),
    },
    report: compilation.report,
  };
}

async function findUserByEmail(admin: SupabaseClient, email: string) {
  for (let page = 1; ; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 1_000 });
    if (result.error) throw new Error('Certificate fixture could not inspect Auth users.');
    const found = result.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (result.data.users.length < 1_000) return null;
  }
}

function oneRow<T extends Record<string, unknown>>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? data[0] ?? null : data;
}

async function exactCount(
  admin: SupabaseClient,
  table: string,
  filters: ReadonlyArray<readonly [string, string]>,
): Promise<number> {
  let query = admin.from(table).select('*', { count: 'exact', head: true });
  for (const [column, value] of filters) query = query.eq(column, value);
  const result = await query;
  if (result.error || result.count === null) throw new Error(`Certificate fixture could not count ${table}.`);
  return result.count;
}

async function createFixture(): Promise<{ fixture: DisposableProfileCertificateFixture; cleanup(): Promise<void> }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!supabaseUrl || !serviceRoleKey || !adminEmail || !appUrl) {
    throw new Error('Certificate acceptance requires Supabase cleanup credentials, the seeded admin email, and the canonical app URL.');
  }
  assertE2EResetTarget(supabaseUrl, process.env);
  const canonicalOrigin = new URL(appUrl).origin;
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const courseId = `recovery-cert-${suffix}`;
  const lessonId = `certificate-${suffix}`;
  const skillId = `certificate-skill-${suffix}`;
  const email = `${courseId}@vfuture.example`;
  const password = `${randomUUID()}${randomUUID()}`;
  if (process.env.GITHUB_ACTIONS === 'true') process.stdout.write(`::add-mask::${password}\n`);
  const displayName = `Nguyễn Ánh ${suffix}`;
  const handle = `rcert_${suffix}`;
  const marker = `recovery-certificate:${suffix}`;
  const state: CreatedState = { learner: false, course: false, skill: false };
  let adminUser: NonNullable<Awaited<ReturnType<typeof findUserByEmail>>>;

  const cleanup = async () => {
    const failures: Error[] = [];
    if (state.learner && state.learnerId) {
      try {
        const current = await admin.auth.admin.getUserById(state.learnerId);
        const user = current.data.user;
        if (current.error || !user || user.email !== email
          || user.app_metadata?.recovery_fixture !== true
          || user.app_metadata?.recovery_namespace !== marker) {
          throw new Error('Certificate learner cleanup ownership verification failed.');
        }
        const certificates = await admin.from('certificates').select('id,pdf_asset_id').eq('user_id', state.learnerId).eq('course_id', courseId);
        if (certificates.error) throw new Error('Certificate cleanup could not load owned certificates.');
        const assetIds = (certificates.data ?? []).flatMap((row) => typeof row.pdf_asset_id === 'string' ? [row.pdf_asset_id] : []);
        if (assetIds.length) {
          const assets = await admin.from('media_assets').select('id,owner_id,bucket,path').in('id', assetIds);
          if (assets.error || assets.data?.length !== assetIds.length) throw new Error('Certificate cleanup could not verify artifacts.');
          const paths = assets.data.map((asset) => {
            if (asset.owner_id !== state.learnerId || asset.bucket !== 'certificates' || typeof asset.path !== 'string') {
              throw new Error('Certificate cleanup artifact ownership verification failed.');
            }
            return asset.path;
          });
          const storage = await admin.storage.from('certificates').remove(paths);
          if (storage.error) throw new Error('Certificate storage cleanup failed.');
        }
        const certificateRows = await admin.from('certificates').delete().eq('user_id', state.learnerId).eq('course_id', courseId);
        if (certificateRows.error) throw new Error('Certificate row cleanup failed.');
        if (assetIds.length) {
          const media = await admin.from('media_assets').delete().in('id', assetIds).eq('owner_id', state.learnerId).eq('bucket', 'certificates');
          if (media.error) throw new Error('Certificate media cleanup failed.');
        }
        const removed = await admin.auth.admin.deleteUser(state.learnerId);
        if (removed.error) throw new Error('Certificate learner cleanup failed.');
        const profileAudit = await admin.from('audit_log').delete().eq('target_type', 'profile').eq('target_id', state.learnerId);
        if (profileAudit.error) throw new Error('Certificate profile audit cleanup failed.');
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error('Certificate learner cleanup failed.'));
      }
    }
    if (state.course) {
      try {
        const current = await admin.from('courses').select('id,slug,owner_id').eq('id', courseId).maybeSingle();
        if (current.error || !current.data || current.data.slug !== courseId || current.data.owner_id !== adminUser.id) {
          throw new Error('Certificate course cleanup ownership verification failed.');
        }
        const detached = await admin.from('courses').update({ current_version_id: null }).eq('id', courseId).eq('owner_id', adminUser.id).select('id').single();
        if (detached.error || detached.data?.id !== courseId) throw new Error('Certificate course cleanup precondition failed.');
        const removed = await admin.from('courses').delete().eq('id', courseId).eq('owner_id', adminUser.id).select('id').single();
        if (removed.error || removed.data?.id !== courseId) throw new Error('Certificate course cleanup failed.');
        const publishEvents = await admin.from('publish_events').delete().eq('course_id', courseId);
        if (publishEvents.error) throw new Error('Certificate publish-event cleanup failed.');
        const courseAudit = await admin.from('audit_log').delete().eq('target_type', 'course').eq('target_id', courseId);
        if (courseAudit.error) throw new Error('Certificate course audit cleanup failed.');
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error('Certificate course cleanup failed.'));
      }
    }
    if (state.skill) {
      try {
        const removed = await admin.from('skills').delete().eq('id', skillId).select('id').single();
        if (removed.error || removed.data?.id !== skillId) throw new Error('Certificate skill cleanup failed.');
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error('Certificate skill cleanup failed.'));
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Disposable certificate fixture cleanup failed.');
  };

  try {
    const [resolvedAdmin, branch, existingCourse, existingLearner, existingSkill] = await Promise.all([
      findUserByEmail(admin, adminEmail),
      admin.from('branches').select('id').eq('id', BRANCH_ID).maybeSingle(),
      admin.from('courses').select('id').eq('id', courseId).maybeSingle(),
      findUserByEmail(admin, email),
      admin.from('skills').select('id').eq('id', skillId).maybeSingle(),
    ]);
    if (!resolvedAdmin) throw new Error('Seeded admin fixture does not exist.');
    adminUser = resolvedAdmin;
    if (branch.error || branch.data?.id !== BRANCH_ID) throw new Error('Certificate fixture branch does not exist.');
    if (existingCourse.error || existingCourse.data || existingLearner || existingSkill.error || existingSkill.data) {
      throw new Error('Disposable certificate namespace is not empty.');
    }

    const createdLearner = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: displayName },
      app_metadata: { recovery_fixture: true, recovery_namespace: marker },
    });
    if (createdLearner.error || !createdLearner.data.user) throw new Error('Disposable certificate learner creation failed.');
    state.learner = true;
    state.learnerId = createdLearner.data.user.id;
    const profile = await admin.from('profiles').update({
      branch_id: BRANCH_ID,
      locale: 'en',
      display_name: displayName,
      handle,
      profile_public: false,
    }).eq('id', state.learnerId).select('id,branch_id,handle,profile_public').single();
    if (profile.error || profile.data?.id !== state.learnerId || profile.data.profile_public !== false) {
      throw new Error('Disposable certificate learner profile setup failed.');
    }

    const insertedSkill = await admin.from('skills').insert({
      id: skillId,
      name: { vi: 'Bằng chứng phục hồi', en: 'Recovery evidence' },
      category: 'core-skills',
      updated_at: new Date().toISOString(),
    }).select('id').single();
    if (insertedSkill.error || insertedSkill.data?.id !== skillId) throw new Error('Disposable certificate skill creation failed.');
    state.skill = true;
    const insertedCourse = await admin.from('courses').insert({
      id: courseId,
      slug: courseId,
      owner_id: adminUser.id,
      status: 'draft',
    }).select('id,slug,owner_id').single();
    if (insertedCourse.error || insertedCourse.data?.id !== courseId || insertedCourse.data.owner_id !== adminUser.id) {
      throw new Error('Disposable certificate course creation failed.');
    }
    state.course = true;
    const publication = await compilePublication(courseId, lessonId, skillId, suffix);
    const published = await admin.rpc('studio_publish_version', {
      course_id: courseId,
      manifest: publication.manifest,
      compiled: publication.compiled,
      checklist: {},
      report: { summary: publication.report.summary },
      actor_id: adminUser.id,
      notes: 'Recovery 13 certificate fixture',
      audit_row: {
        actor_id: adminUser.id,
        action: 'course.publish',
        target_type: 'course',
        target_id: courseId,
        before: null,
        after: { checksum: publication.compiled.checksum },
      },
    });
    const versionId = oneRow(published.data as Record<string, unknown> | Record<string, unknown>[] | null)?.id;
    if (published.error || typeof versionId !== 'string') throw new Error('Disposable certificate course publication failed.');

    const fixture: DisposableProfileCertificateFixture = {
      courseId,
      courseTitle: `Recovery certificate ${suffix}`,
      versionId,
      lessonId,
      skillId,
      canonicalOrigin,
      learner: { id: state.learnerId, email, password, displayName, handle },
      async receiptCounts() {
        const filters = [['user_id', state.learnerId!], ['course_id', courseId]] as const;
        const [completions, certificates, xp, evidence] = await Promise.all([
          exactCount(admin, 'course_completions', filters),
          exactCount(admin, 'certificates', filters),
          exactCount(admin, 'xp_events', [['user_id', state.learnerId!], ['kind', 'course_completed'], ['ref_type', 'course'], ['ref_id', courseId]]),
          exactCount(admin, 'skill_evidence', [['user_id', state.learnerId!], ['evidence_type', 'course_completion'], ['ref_type', 'course'], ['ref_id', courseId]]),
        ]);
        return { completions, certificates, xp, evidence };
      },
      async certificate() {
        const result = await admin.from('certificates')
          .select('id,serial,verification_code,pdf_asset_id')
          .eq('user_id', state.learnerId!)
          .eq('course_id', courseId)
          .maybeSingle();
        if (result.error) throw new Error('Disposable certificate could not be loaded.');
        const row = result.data;
        return row && typeof row.id === 'string' && typeof row.serial === 'string'
          && typeof row.verification_code === 'string' && typeof row.pdf_asset_id === 'string'
          ? { id: row.id, serial: row.serial, verificationCode: row.verification_code, pdfAssetId: row.pdf_asset_id }
          : null;
      },
    };
    return { fixture, cleanup };
  } catch (error) {
    try { await cleanup(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Certificate fixture setup and cleanup both failed.');
    }
    throw error;
  }
}

export async function withDisposableProfileCertificateFixture(
  run: (fixture: DisposableProfileCertificateFixture) => Promise<void>,
): Promise<void> {
  const created = await createFixture();
  let primaryError: unknown;
  try { await run(created.fixture); } catch (error) { primaryError = error; }
  try { await created.cleanup(); } catch (cleanupError) {
    if (primaryError) throw new AggregateError([primaryError, cleanupError], 'Certificate journey and verified cleanup both failed.');
    throw cleanupError;
  }
  if (primaryError) throw primaryError;
}
