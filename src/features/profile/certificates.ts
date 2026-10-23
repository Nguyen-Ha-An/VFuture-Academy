import 'server-only';

import type { L10nString } from '@/content-engine';
import { listCertificateRecords, type CertificateDatabase as CompletionCertificateDatabase } from '@/features/certificates/service';

type QueryResult = { data: unknown; error: unknown | null };

export interface CertificateQuery extends PromiseLike<QueryResult> {
  select(columns: string): CertificateQuery;
  eq(column: string, value: unknown): CertificateQuery;
  in(column: string, values: unknown[]): CertificateQuery;
  order(column: string, options?: unknown): CertificateQuery;
}

export interface CertificateDatabase {
  from(table: string): CertificateQuery;
}

export type PublicCertificate = {
  courseId: string;
  title: L10nString;
  issuedAt: string;
  verificationCode: string;
  href: string;
};

export type PublicCertificateReader = (
  userId: string,
  client: CertificateDatabase,
) => Promise<PublicCertificate[]>;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((entry) => {
    const row = record(entry);
    return row ? [row] : [];
  }) : [];
}

function titleFromManifest(value: unknown): L10nString {
  const manifest = record(value);
  const title = manifest?.title;
  if (typeof title === 'string') return title;
  const localized = record(title);
  if (localized && (typeof localized.vi === 'string' || typeof localized.en === 'string')) {
    return localized as L10nString;
  }
  return '';
}

export const readPublicCertificates: PublicCertificateReader = async (userId, client) => {
  const certificates = await listCertificateRecords(
    client as unknown as Pick<CompletionCertificateDatabase, 'from'>,
    userId,
  );
  const versionIds = [...new Set(certificates.flatMap((certificate) => (
    certificate.courseVersionId ? [certificate.courseVersionId] : []
  )))];
  const versionsResult = versionIds.length
    ? await client.from('course_versions').select('id,course_id,manifest').in('id', versionIds)
    : { data: [], error: null };
  if (versionsResult.error) throw new Error('Unable to load certificate courses');
  const manifests = new Map(records(versionsResult.data).flatMap((version) => (
    typeof version.id === 'string' ? [[version.id, version.manifest] as const] : []
  )));
  const courseIds = [...new Set(certificates.map(({ courseId }) => courseId))];
  const courseResult = courseIds.length ? await client.from('courses').select('id,current_version_id,status').in('id', courseIds).eq('status', 'published') : { data: [], error: null };
  if (courseResult.error) throw new Error('Unable to load public certificate courses');
  const currentVersions = new Map(records(courseResult.data).flatMap((course) => typeof course.id === 'string' && typeof course.current_version_id === 'string' ? [[course.id, course.current_version_id] as const] : []));
  const outlineResult = currentVersions.size ? await client.from('course_version_outline').select('version_id,access').in('version_id', [...currentVersions.values()]) : { data: [], error: null };
  if (outlineResult.error) throw new Error('Unable to load public certificate visibility');
  const publicVersions = new Set(records(outlineResult.data).flatMap((outline) => typeof outline.version_id === 'string' && record(outline.access)?.scope === 'global' ? [outline.version_id] : []));

  return certificates.flatMap((certificate): PublicCertificate[] => {
    const currentVersion = currentVersions.get(certificate.courseId);
    if (!currentVersion || !publicVersions.has(currentVersion)) return [];
    return [{
      courseId: certificate.courseId,
      title: titleFromManifest(manifests.get(certificate.courseVersionId)),
      issuedAt: certificate.issuedAt,
      verificationCode: certificate.verificationCode,
      href: `/verify/${encodeURIComponent(certificate.verificationCode)}`,
    }];
  });
};
