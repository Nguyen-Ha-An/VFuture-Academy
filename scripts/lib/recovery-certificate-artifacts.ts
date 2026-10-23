import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveL10nString, type L10nString, type Locale } from '../../src/content-engine';
import { mediaAssetId } from '../../src/features/media/upload';
import type { CertificatePdfInput } from '../../src/features/certificates/CertificateDocument';

const REPAIR_VERSION = 'noto-v1';
const CERTIFICATES_BUCKET = 'certificates';
const MAX_PDF_TEXT_LENGTH = 120;

export type RecoveryCertificate = {
  id: string;
  userId: string;
  courseId: string;
  courseVersionId: string;
  serial: string;
  verificationCode: string;
  issuedAt: string;
  pdfAssetId: string | null;
};

export type RecoveryCertificateAsset = {
  id: string;
  ownerId: string;
  bucket: string;
  path: string;
  mime: string;
  size: number;
};

export type RecoveryCertificateStore = {
  authUser(userId: string): Promise<{ id: string; email: string | null; recoveryFixture: boolean } | null>;
  certificate(userId: string, courseId: string): Promise<RecoveryCertificate | null>;
  certificateDetails(certificate: RecoveryCertificate): Promise<Omit<CertificatePdfInput, 'issuedAt' | 'serial' | 'verificationUrl'>>;
  asset(assetId: string): Promise<RecoveryCertificateAsset | null>;
  download(path: string): Promise<Uint8Array>;
  upload(path: string, bytes: Uint8Array): Promise<void>;
  insertAsset(asset: RecoveryCertificateAsset): Promise<void>;
  swapCertificateAsset(certificateId: string, expectedAssetId: string | null, nextAssetId: string | null): Promise<boolean>;
  readCertificate(certificateId: string): Promise<RecoveryCertificate | null>;
  certificateReferenceCount(assetId: string): Promise<number>;
  deleteAsset(asset: RecoveryCertificateAsset): Promise<boolean>;
  removeStorage(path: string): Promise<void>;
};

export type RecoveryCertificateRepairResult = {
  status: 'unchanged' | 'repaired';
  certificateId: string;
  oldArtifactRemoved: boolean;
};

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function repairPath(certificateId: string, assetId: string, replacedAssetId: string | null, digest: string): string {
  return `seed-certificates/${REPAIR_VERSION}/${certificateId}/${assetId}/${encodeURIComponent(replacedAssetId ?? 'none')}/${digest}.pdf`;
}

function artifactMarker(path: string, certificateId: string): { digest: string; replacedAssetId: string | null } | null {
  const escapedId = certificateId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^seed-certificates/${REPAIR_VERSION}/${escapedId}/[^/]+/([^/]+)/([a-f0-9]{64})\\.pdf$`).exec(path);
  if (!match) return null;
  let replaced: string;
  try { replaced = decodeURIComponent(match[1]!); } catch { return null; }
  return { digest: match[2]!, replacedAssetId: replaced === 'none' ? null : replaced };
}

function containsCurrentArtifactMarkers(bytes: Uint8Array, verificationUrl: string): boolean {
  const source = Buffer.from(bytes).toString('latin1');
  return source.includes('/FontFile2') && source.includes(`/URI (${verificationUrl})`);
}

function sameImmutableCertificate(left: RecoveryCertificate, right: RecoveryCertificate): boolean {
  return left.id === right.id
    && left.userId === right.userId
    && left.courseId === right.courseId
    && left.courseVersionId === right.courseVersionId
    && left.serial === right.serial
    && left.verificationCode === right.verificationCode
    && left.issuedAt === right.issuedAt;
}

function sameAsset(left: RecoveryCertificateAsset, right: RecoveryCertificateAsset): boolean {
  return left.id === right.id && left.ownerId === right.ownerId && left.bucket === right.bucket
    && left.path === right.path && left.mime === right.mime && left.size === right.size;
}

async function exactCurrentArtifact(
  store: RecoveryCertificateStore,
  certificate: RecoveryCertificate,
  verificationUrl: string,
): Promise<{ correct: boolean; replacedAssetId: string | null }> {
  if (!certificate.pdfAssetId) return { correct: false, replacedAssetId: null };
  const asset = await store.asset(certificate.pdfAssetId);
  if (!asset || asset.ownerId !== certificate.userId || asset.bucket !== CERTIFICATES_BUCKET
    || asset.mime !== 'application/pdf') return { correct: false, replacedAssetId: null };
  const marker = artifactMarker(asset.path, certificate.id);
  if (!marker) return { correct: false, replacedAssetId: null };
  const bytes = await store.download(asset.path);
  return {
    correct: bytes.byteLength === asset.size
      && sha256(bytes) === marker.digest
      && containsCurrentArtifactMarkers(bytes, verificationUrl),
    replacedAssetId: marker.replacedAssetId,
  };
}

async function cleanupUnreferencedArtifact(
  store: RecoveryCertificateStore,
  asset: RecoveryCertificateAsset,
): Promise<boolean> {
  if (asset.bucket !== CERTIFICATES_BUCKET) return false;
  if (await store.certificateReferenceCount(asset.id) !== 0) return false;
  await store.removeStorage(asset.path);
  return store.deleteAsset(asset);
}

export async function repairRecoveryCertificateArtifact(input: {
  store: RecoveryCertificateStore;
  expectedUserId: string;
  expectedUserEmail: string;
  courseId: 'ai-foundations';
  appUrl: string;
  renderPdf: (input: CertificatePdfInput) => Promise<Uint8Array>;
  createAssetId?: () => string;
}): Promise<RecoveryCertificateRepairResult> {
  const { store } = input;
  const identity = await store.authUser(input.expectedUserId);
  if (!identity || identity.id !== input.expectedUserId
    || identity.email?.toLowerCase() !== input.expectedUserEmail.toLowerCase()
    || identity.recoveryFixture !== true) {
    throw new Error('Seed certificate repair refused an unverified recovery Auth user.');
  }
  const certificate = await store.certificate(input.expectedUserId, input.courseId);
  if (!certificate || certificate.userId !== input.expectedUserId || certificate.courseId !== input.courseId) {
    throw new Error('Seed certificate repair could not resolve the exact completed learner certificate.');
  }
  const canonicalOrigin = new URL(input.appUrl).origin;
  const verificationUrl = new URL(`/verify/${certificate.verificationCode}`, canonicalOrigin).toString();
  const currentArtifact = await exactCurrentArtifact(store, certificate, verificationUrl);
  if (currentArtifact.correct) {
    let oldArtifactRemoved = false;
    if (currentArtifact.replacedAssetId && currentArtifact.replacedAssetId !== certificate.pdfAssetId) {
      const replaced = await store.asset(currentArtifact.replacedAssetId);
      if (replaced && replaced.ownerId === certificate.userId && replaced.bucket === CERTIFICATES_BUCKET) {
        oldArtifactRemoved = await cleanupUnreferencedArtifact(store, replaced);
      }
    }
    return { status: 'unchanged', certificateId: certificate.id, oldArtifactRemoved };
  }

  const oldAsset = certificate.pdfAssetId ? await store.asset(certificate.pdfAssetId) : null;
  if (certificate.pdfAssetId && (!oldAsset || oldAsset.id !== certificate.pdfAssetId
    || oldAsset.ownerId !== certificate.userId || oldAsset.bucket !== CERTIFICATES_BUCKET)) {
    throw new Error('Seed certificate repair refused an unverified existing artifact.');
  }
  const details = await store.certificateDetails(certificate);
  const bytes = await input.renderPdf({
    ...details,
    issuedAt: certificate.issuedAt,
    serial: certificate.serial,
    verificationUrl,
  });
  const digest = sha256(bytes);
  const assetId = (input.createAssetId ?? mediaAssetId)();
  const nextAsset: RecoveryCertificateAsset = {
    id: assetId,
    ownerId: certificate.userId,
    bucket: CERTIFICATES_BUCKET,
    path: repairPath(certificate.id, assetId, certificate.pdfAssetId, digest),
    mime: 'application/pdf',
    size: bytes.byteLength,
  };
  let uploaded = false;
  try {
    await store.upload(nextAsset.path, bytes);
    uploaded = true;
    await store.insertAsset(nextAsset);
    const swapped = await store.swapCertificateAsset(certificate.id, certificate.pdfAssetId, nextAsset.id);
    if (!swapped) throw new Error('Seed certificate repair lost the certificate compare-and-swap.');
    const readback = await store.readCertificate(certificate.id);
    if (!readback || !sameImmutableCertificate(certificate, readback) || readback.pdfAssetId !== nextAsset.id) {
      throw new Error('Seed certificate repair readback did not preserve certificate identity.');
    }
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    let durable: RecoveryCertificate | null | undefined;
    try {
      durable = await store.readCertificate(certificate.id);
      if (durable && !sameImmutableCertificate(certificate, durable)) {
        cleanupErrors.push(new Error('Seed certificate repair refused rollback after certificate identity changed.'));
        durable = undefined;
      }
    } catch (readError) {
      cleanupErrors.push(readError);
    }
    if (durable?.pdfAssetId === nextAsset.id) {
      try {
        await store.swapCertificateAsset(certificate.id, nextAsset.id, certificate.pdfAssetId);
      } catch (rollbackError) {
        cleanupErrors.push(rollbackError);
      }
      try {
        durable = await store.readCertificate(certificate.id);
        if (durable && !sameImmutableCertificate(certificate, durable)) {
          cleanupErrors.push(new Error('Seed certificate repair rollback readback changed certificate identity.'));
          durable = undefined;
        }
      } catch (readError) {
        cleanupErrors.push(readError);
        durable = undefined;
      }
    }

    let references: number | undefined;
    try {
      references = await store.certificateReferenceCount(nextAsset.id);
    } catch (referenceError) {
      cleanupErrors.push(referenceError);
    }
    if (uploaded && references === 0) {
      let metadata: RecoveryCertificateAsset | null | undefined;
      try {
        metadata = await store.asset(nextAsset.id);
        if (metadata && !sameAsset(metadata, nextAsset)) {
          cleanupErrors.push(new Error('Seed certificate repair refused cleanup of mismatched replacement metadata.'));
          metadata = undefined;
        }
      } catch (metadataError) {
        cleanupErrors.push(metadataError);
      }
      if (metadata !== undefined) {
        let storageRemoved = false;
        try {
          await store.removeStorage(nextAsset.path);
          storageRemoved = true;
        } catch (storageError) {
          cleanupErrors.push(storageError);
        }
        if (storageRemoved && metadata) {
          try {
            if (!await store.deleteAsset(metadata)) {
              cleanupErrors.push(new Error('Seed certificate repair could not delete replacement metadata.'));
            }
          } catch (metadataError) {
            cleanupErrors.push(metadataError);
          }
        }
      }
    }
    if (cleanupErrors.length) {
      throw new AggregateError([error, ...cleanupErrors], 'Seed certificate repair failed and cleanup was incomplete.');
    }
    throw error;
  }

  const oldArtifactRemoved = oldAsset
    ? await cleanupUnreferencedArtifact(store, oldAsset)
    : false;
  return { status: 'repaired', certificateId: certificate.id, oldArtifactRemoved };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parsedCertificate(value: unknown): RecoveryCertificate | null {
  const row = record(value);
  return row && typeof row.id === 'string' && typeof row.user_id === 'string'
    && typeof row.course_id === 'string' && typeof row.course_version_id === 'string'
    && typeof row.serial === 'string' && typeof row.verification_code === 'string'
    && typeof row.issued_at === 'string'
    ? {
      id: row.id,
      userId: row.user_id,
      courseId: row.course_id,
      courseVersionId: row.course_version_id,
      serial: row.serial,
      verificationCode: row.verification_code,
      issuedAt: row.issued_at,
      pdfAssetId: typeof row.pdf_asset_id === 'string' ? row.pdf_asset_id : null,
    }
    : null;
}

function bounded(value: unknown, fallback = ''): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return (normalized || fallback.trim()).slice(0, MAX_PDF_TEXT_LENGTH);
}

export function createSupabaseRecoveryCertificateStore(client: SupabaseClient): RecoveryCertificateStore {
  return {
    async authUser(userId) {
      const result = await client.auth.admin.getUserById(userId);
      if (result.error || !result.data.user) throw new Error('Seed certificate repair could not verify the Auth user.');
      return {
        id: result.data.user.id,
        email: result.data.user.email ?? null,
        recoveryFixture: result.data.user.app_metadata?.recovery_fixture === true,
      };
    },
    async certificate(userId, courseId) {
      const result = await client.from('certificates')
        .select('id,user_id,course_id,course_version_id,serial,verification_code,issued_at,pdf_asset_id')
        .eq('user_id', userId).eq('course_id', courseId).maybeSingle();
      if (result.error) throw new Error('Seed certificate repair could not load the certificate.');
      return parsedCertificate(result.data);
    },
    async certificateDetails(certificate) {
      const [profileResult, outlineResult] = await Promise.all([
        client.from('profiles').select('display_name,handle,locale').eq('id', certificate.userId).maybeSingle(),
        client.from('course_version_outline').select('meta,default_language')
          .eq('version_id', certificate.courseVersionId).eq('course_id', certificate.courseId).maybeSingle(),
      ]);
      const profile = record(profileResult.data);
      const outline = record(outlineResult.data);
      if (profileResult.error || outlineResult.error || !profile || !outline) {
        throw new Error('Seed certificate repair could not load certificate details.');
      }
      const locale: Locale = profile.locale === 'en' ? 'en' : 'vi';
      const defaultLocale: Locale = outline.default_language === 'en' ? 'en' : 'vi';
      const title = record(record(outline.meta)?.title);
      const courseTitle = title ? resolveL10nString(title as L10nString, locale, defaultLocale) : '';
      const learnerName = bounded(profile.display_name, bounded(profile.handle, 'Learner'));
      if (!courseTitle.trim()) throw new Error('Seed certificate repair could not resolve the course title.');
      return { learnerName, courseTitle: bounded(courseTitle), locale };
    },
    async asset(assetId) {
      const result = await client.from('media_assets').select('id,owner_id,bucket,path,mime,size_bytes').eq('id', assetId).maybeSingle();
      const row = record(result.data);
      if (result.error) throw new Error('Seed certificate repair could not load the artifact metadata.');
      return row && typeof row.id === 'string' && typeof row.owner_id === 'string'
        && typeof row.bucket === 'string' && typeof row.path === 'string'
        && typeof row.mime === 'string' && Number.isSafeInteger(Number(row.size_bytes))
        ? { id: row.id, ownerId: row.owner_id, bucket: row.bucket, path: row.path, mime: row.mime, size: Number(row.size_bytes) }
        : null;
    },
    async download(path) {
      const result = await client.storage.from(CERTIFICATES_BUCKET).download(path);
      if (result.error || !result.data) throw new Error('Seed certificate repair could not inspect the private artifact.');
      return new Uint8Array(await result.data.arrayBuffer());
    },
    async upload(path, bytes) {
      const result = await client.storage.from(CERTIFICATES_BUCKET).upload(path, bytes, {
        contentType: 'application/pdf', upsert: false, cacheControl: '31536000',
      });
      if (result.error) throw new Error('Seed certificate repair could not upload the replacement artifact.');
    },
    async insertAsset(asset) {
      const result = await client.from('media_assets').insert({
        id: asset.id, owner_id: asset.ownerId, bucket: asset.bucket, path: asset.path,
        mime: asset.mime, size_bytes: asset.size, width: null, height: null,
      }).select('id').single();
      if (result.error || result.data?.id !== asset.id) throw new Error('Seed certificate repair could not save replacement metadata.');
    },
    async swapCertificateAsset(certificateId, expectedAssetId, nextAssetId) {
      let query = client.from('certificates').update({ pdf_asset_id: nextAssetId }).eq('id', certificateId);
      query = expectedAssetId === null ? query.is('pdf_asset_id', null) : query.eq('pdf_asset_id', expectedAssetId);
      const result = await query.select('id,pdf_asset_id').maybeSingle();
      if (result.error) throw new Error('Seed certificate repair could not update the certificate artifact.');
      return result.data?.id === certificateId && result.data.pdf_asset_id === nextAssetId;
    },
    async readCertificate(certificateId) {
      const result = await client.from('certificates')
        .select('id,user_id,course_id,course_version_id,serial,verification_code,issued_at,pdf_asset_id')
        .eq('id', certificateId).maybeSingle();
      if (result.error) throw new Error('Seed certificate repair could not verify certificate readback.');
      return parsedCertificate(result.data);
    },
    async certificateReferenceCount(assetId) {
      const result = await client.from('certificates').select('id', { count: 'exact', head: true }).eq('pdf_asset_id', assetId);
      if (result.error || result.count === null) throw new Error('Seed certificate repair could not verify artifact references.');
      return result.count;
    },
    async deleteAsset(asset) {
      const result = await client.from('media_assets').delete()
        .eq('id', asset.id).eq('owner_id', asset.ownerId).eq('bucket', asset.bucket).eq('path', asset.path)
        .select('id').maybeSingle();
      if (result.error) throw new Error('Seed certificate repair could not delete artifact metadata.');
      return result.data?.id === asset.id;
    },
    async removeStorage(path) {
      const result = await client.storage.from(CERTIFICATES_BUCKET).remove([path]);
      if (result.error) throw new Error('Seed certificate repair could not remove the private artifact.');
    },
  };
}

export async function repairSeedCompletedLearnerCertificate(input: {
  client: SupabaseClient;
  userId: string;
  userEmail: string;
  appUrl: string;
}) {
  const { renderCertificatePdf } = await import('../../src/features/certificates/CertificateDocument');
  return repairRecoveryCertificateArtifact({
    store: createSupabaseRecoveryCertificateStore(input.client),
    expectedUserId: input.userId,
    expectedUserEmail: input.userEmail,
    courseId: 'ai-foundations',
    appUrl: input.appUrl,
    renderPdf: renderCertificatePdf,
  });
}
