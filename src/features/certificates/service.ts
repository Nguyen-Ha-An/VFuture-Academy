import 'server-only';

import { randomBytes, randomUUID } from 'node:crypto';
import { resolveL10nString, type L10nString, type Locale } from '@/content-engine';
import { ApiError } from '@/lib/api';
import { mediaAssetId } from '@/features/media/upload';
import type { CertificatePdfInput } from './CertificateDocument';

const CERTIFICATES_BUCKET = 'certificates';
const SERIAL_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SERIAL_PART_PATTERN = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_SEGMENT_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const MAX_SERIAL_ATTEMPTS = 8;
const MAX_PDF_TEXT_LENGTH = 120;
const SIGNED_URL_TTL_SECONDS = 10 * 60;
const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';

type QueryResult = { data: unknown; error: unknown | null };

export interface CertificateQuery extends PromiseLike<QueryResult> {
  select(columns: string): this;
  insert(value: unknown): this;
  delete(): this;
  eq(column: string, value: unknown): this;
  maybeSingle(): Promise<QueryResult>;
  single(): Promise<QueryResult>;
}

type CertificateStorage = {
  upload(path: string, body: Uint8Array, options: { contentType: string; upsert: false; cacheControl: string }): PromiseLike<{ error: unknown | null }>;
  remove(paths: string[]): PromiseLike<{ error: unknown | null }>;
  createSignedUrl(path: string, expiresIn: number): PromiseLike<{
    data: { signedUrl?: unknown } | null;
    error: unknown | null;
  }>;
};

export interface CertificateDatabase {
  from(table: string): CertificateQuery;
  storage: { from(bucket: string): CertificateStorage };
}

type Dependencies = {
  database: CertificateDatabase;
  appUrl: string;
  renderPdf: (input: CertificatePdfInput) => Promise<Uint8Array>;
  now?: () => Date;
  randomSerialPart?: () => string;
  randomUuid?: () => string;
  randomStorageSegment?: () => string;
  createAssetId?: () => string;
};

export type CertificateRecord = {
  id: string;
  userId: string;
  courseId: string;
  courseVersionId: string;
  serial: string;
  verificationCode: string;
  issuedAt: string;
  pdfAssetId: string | null;
};

export type CertificateVerification = {
  learnerDisplayName: string;
  courseTitle: string;
  issuedAt: string;
  serial: string;
  pdfUrl: string | null;
};

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

function databaseFailure(message: string): never {
  throw new ApiError(500, 'CERTIFICATE_DATABASE_ERROR', message);
}

function errorCode(value: unknown): string | null {
  return typeof value === 'object' && value !== null && 'code' in value
    && typeof (value as { code?: unknown }).code === 'string'
    ? (value as { code: string }).code
    : null;
}

function parsedCertificate(value: unknown): CertificateRecord | null {
  const row = record(value);
  if (
    !row
    || typeof row.id !== 'string'
    || typeof row.user_id !== 'string'
    || typeof row.course_id !== 'string'
    || typeof row.course_version_id !== 'string'
    || typeof row.serial !== 'string'
    || typeof row.verification_code !== 'string'
    || typeof row.issued_at !== 'string'
  ) return null;
  return {
    id: row.id,
    userId: row.user_id,
    courseId: row.course_id,
    courseVersionId: row.course_version_id,
    serial: row.serial,
    verificationCode: row.verification_code,
    issuedAt: row.issued_at,
    pdfAssetId: typeof row.pdf_asset_id === 'string' ? row.pdf_asset_id : null,
  };
}

export async function listCertificateRecords(
  database: Pick<CertificateDatabase, 'from'>,
  userId: string,
): Promise<CertificateRecord[]> {
  const result = await database.from('certificates')
    .select('id,user_id,course_id,course_version_id,serial,verification_code,issued_at,pdf_asset_id')
    .eq('user_id', userId);
  if (result.error) databaseFailure('Certificates could not be loaded');
  return records(result.data).flatMap((row) => {
    const certificate = parsedCertificate(row);
    return certificate ? [certificate] : [];
  });
}

function defaultSerialPart(): string {
  const bytes = randomBytes(8);
  return [...bytes].map((byte) => SERIAL_ALPHABET[byte % SERIAL_ALPHABET.length]).join('');
}

function defaultStorageSegment(): string {
  return randomBytes(24).toString('hex');
}

function boundedText(value: unknown, fallback = ''): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return (normalized || fallback.trim()).slice(0, MAX_PDF_TEXT_LENGTH);
}

function certificateYear(at: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    timeZone: VIETNAM_TIME_ZONE,
  }).format(at);
}

function localizedTitle(metaValue: unknown, locale: Locale, defaultLocale: Locale): string {
  const title = record(record(metaValue)?.title);
  if (!title) return '';
  return resolveL10nString(title as L10nString, locale, defaultLocale);
}

async function existingForCourse(database: CertificateDatabase, userId: string, courseId: string) {
  const result = await database.from('certificates')
    .select('id,user_id,course_id,course_version_id,serial,verification_code,issued_at,pdf_asset_id')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .maybeSingle();
  if (result.error) databaseFailure('Certificate could not be loaded');
  return parsedCertificate(result.data);
}

async function removeArtifact(database: CertificateDatabase, assetId: string, path: string) {
  await Promise.allSettled([
    database.storage.from(CERTIFICATES_BUCKET).remove([path]),
    database.from('media_assets').delete().eq('id', assetId),
  ]);
}

async function signedArtifactUrl(
  database: CertificateDatabase,
  ownerId: string,
  assetId: string | null,
): Promise<string | null> {
  if (!assetId) return null;
  const assetResult = await database.from('media_assets')
    .select('owner_id,bucket,path')
    .eq('id', assetId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (assetResult.error) databaseFailure('Certificate PDF could not be loaded');
  const asset = record(assetResult.data);
  if (
    !asset
    || asset.owner_id !== ownerId
    || asset.bucket !== CERTIFICATES_BUCKET
    || typeof asset.path !== 'string'
  ) return null;
  const signedResult = await database.storage.from(CERTIFICATES_BUCKET)
    .createSignedUrl(asset.path, SIGNED_URL_TTL_SECONDS);
  if (signedResult.error || typeof signedResult.data?.signedUrl !== 'string') {
    throw new ApiError(500, 'CERTIFICATE_STORAGE_ERROR', 'Certificate PDF could not be signed');
  }
  return signedResult.data.signedUrl;
}

export function createCertificateService(dependencies: Dependencies) {
  const {
    database,
    appUrl,
    renderPdf,
    now = () => new Date(),
    randomSerialPart = defaultSerialPart,
    randomUuid = randomUUID,
    randomStorageSegment = defaultStorageSegment,
    createAssetId = mediaAssetId,
  } = dependencies;

  async function issue(userId: string, courseId: string, versionId: string): Promise<CertificateRecord> {
    const existing = await existingForCourse(database, userId, courseId);
    if (existing) return existing;

    const [profileResult, outlineResult] = await Promise.all([
      database.from('profiles').select('display_name,handle,locale').eq('id', userId).maybeSingle(),
      database.from('course_version_outline')
        .select('meta,default_language')
        .eq('version_id', versionId)
        .eq('course_id', courseId)
        .maybeSingle(),
    ]);
    if (profileResult.error || outlineResult.error) databaseFailure('Certificate details could not be loaded');
    const profile = record(profileResult.data);
    const outline = record(outlineResult.data);
    if (!profile || !outline) databaseFailure('Certificate details could not be loaded');
    const locale: Locale = profile.locale === 'en' ? 'en' : 'vi';
    const defaultLocale: Locale = outline.default_language === 'en' ? 'en' : 'vi';
    const learnerName = boundedText(profile.display_name, boundedText(profile.handle, 'Learner'));
    const courseTitle = boundedText(localizedTitle(outline.meta, locale, defaultLocale));
    if (!courseTitle) databaseFailure('Certificate course title could not be loaded');

    for (let attempt = 0; attempt < MAX_SERIAL_ATTEMPTS; attempt += 1) {
      const serialPart = randomSerialPart();
      if (!SERIAL_PART_PATTERN.test(serialPart)) throw new Error('Certificate serial generator returned invalid base32');
      const issuedOn = now();
      const issuedAt = issuedOn.toISOString();
      const serial = `VFA-${certificateYear(issuedOn)}-${serialPart}`;
      const collisionResult = await database.from('certificates').select('id').eq('serial', serial).maybeSingle();
      if (collisionResult.error) databaseFailure('Certificate serial could not be checked');
      if (collisionResult.data) continue;

      const verificationCode = randomUuid();
      const certificateId = randomUuid();
      const assetId = createAssetId();
      const verificationUrl = new URL(`/verify/${verificationCode}`, appUrl).toString();
      const pdf = await renderPdf({
        learnerName,
        courseTitle,
        locale,
        issuedAt,
        serial,
        verificationUrl,
      });
      const storageSegment = randomStorageSegment();
      if (!STORAGE_SEGMENT_PATTERN.test(storageSegment)) {
        throw new Error('Certificate storage segment generator returned an invalid value');
      }
      const path = `${storageSegment}/${certificateId}.pdf`;
      const uploadResult = await database.storage.from(CERTIFICATES_BUCKET).upload(path, pdf, {
        contentType: 'application/pdf',
        upsert: false,
        cacheControl: '31536000',
      });
      if (uploadResult.error) throw new ApiError(500, 'CERTIFICATE_STORAGE_ERROR', 'Certificate PDF could not be uploaded');

      const assetResult = await database.from('media_assets').insert({
        id: assetId,
        owner_id: userId,
        bucket: CERTIFICATES_BUCKET,
        path,
        purpose: 'content',
        mime: 'application/pdf',
        size_bytes: pdf.byteLength,
        width: null,
        height: null,
      }).select('id').single();
      if (assetResult.error) {
        await removeArtifact(database, assetId, path);
        databaseFailure('Certificate PDF record could not be saved');
      }

      const certificateResult = await database.from('certificates').insert({
        id: certificateId,
        user_id: userId,
        course_id: courseId,
        course_version_id: versionId,
        serial,
        issued_at: issuedAt,
        pdf_asset_id: assetId,
        verification_code: verificationCode,
      }).select('id,user_id,course_id,course_version_id,serial,verification_code,issued_at,pdf_asset_id').single();
      if (!certificateResult.error) {
        const certificate = parsedCertificate(certificateResult.data);
        if (certificate) return certificate;
        await removeArtifact(database, assetId, path);
        databaseFailure('Certificate could not be saved');
      }

      await removeArtifact(database, assetId, path);
      if (errorCode(certificateResult.error) !== '23505') databaseFailure('Certificate could not be saved');
      const concurrentlyIssued = await existingForCourse(database, userId, courseId);
      if (concurrentlyIssued) return concurrentlyIssued;
      // Otherwise the serial raced; retry with a fresh PDF and serial.
    }
    throw new ApiError(503, 'CERTIFICATE_SERIAL_EXHAUSTED', 'A unique certificate serial could not be allocated');
  }

  async function verify(code: string): Promise<CertificateVerification | null> {
    if (!UUID_PATTERN.test(code)) return null;
    const certificateResult = await database.from('certificates')
      .select('user_id,course_id,course_version_id,serial,issued_at,pdf_asset_id')
      .eq('verification_code', code)
      .maybeSingle();
    if (certificateResult.error) databaseFailure('Certificate could not be verified');
    const certificate = record(certificateResult.data);
    if (
      !certificate
      || typeof certificate.user_id !== 'string'
      || typeof certificate.course_id !== 'string'
      || typeof certificate.course_version_id !== 'string'
      || typeof certificate.serial !== 'string'
      || typeof certificate.issued_at !== 'string'
    ) return null;
    const [profileResult, outlineResult, pdfUrl] = await Promise.all([
      database.from('profiles').select('display_name,handle,locale').eq('id', certificate.user_id).maybeSingle(),
      database.from('course_version_outline')
        .select('meta,default_language')
        .eq('version_id', certificate.course_version_id)
        .eq('course_id', certificate.course_id)
        .maybeSingle(),
      signedArtifactUrl(
        database,
        certificate.user_id,
        typeof certificate.pdf_asset_id === 'string' ? certificate.pdf_asset_id : null,
      ),
    ]);
    if (profileResult.error || outlineResult.error) databaseFailure('Certificate could not be verified');
    const profile = record(profileResult.data);
    const outline = record(outlineResult.data);
    if (!profile || !outline) return null;
    const locale: Locale = profile.locale === 'en' ? 'en' : 'vi';
    const defaultLocale: Locale = outline.default_language === 'en' ? 'en' : 'vi';
    const learnerDisplayName = boundedText(profile.display_name, boundedText(profile.handle, 'Learner'));
    const courseTitle = boundedText(localizedTitle(outline.meta, locale, defaultLocale));
    if (!courseTitle) return null;
    return {
      learnerDisplayName,
      courseTitle,
      issuedAt: certificate.issued_at,
      serial: certificate.serial,
      pdfUrl,
    };
  }

  async function downloadForUser(userId: string, certificateId: string): Promise<string | null> {
    const certificateResult = await database.from('certificates')
      .select('id,user_id,course_id,course_version_id,serial,verification_code,issued_at,pdf_asset_id')
      .eq('id', certificateId)
      .eq('user_id', userId)
      .maybeSingle();
    if (certificateResult.error) databaseFailure('Certificate could not be loaded');
    const certificate = parsedCertificate(certificateResult.data);
    if (!certificate || certificate.userId !== userId) return null;
    return signedArtifactUrl(database, userId, certificate.pdfAssetId);
  }

  async function listForUser(userId: string) {
    return listCertificateRecords(database, userId);
  }

  return { issue, verify, downloadForUser, listForUser };
}

async function productionService() {
  const [{ env }, { supabaseService }, { renderCertificatePdf }] = await Promise.all([
    import('@/lib/env'),
    import('@/lib/supabase/server'),
    import('./CertificateDocument'),
  ]);
  return createCertificateService({
    database: supabaseService() as unknown as CertificateDatabase,
    appUrl: env.NEXT_PUBLIC_APP_URL,
    renderPdf: renderCertificatePdf,
  });
}

export async function issue(userId: string, courseId: string, versionId: string) {
  return (await productionService()).issue(userId, courseId, versionId);
}

export async function verify(code: string) {
  return (await productionService()).verify(code);
}

export async function listCertificates(userId: string) {
  return (await productionService()).listForUser(userId);
}

export async function downloadCertificate(userId: string, certificateId: string) {
  return (await productionService()).downloadForUser(userId, certificateId);
}
