import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';
const LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const TOKEN = /^v1\.([1-9][0-9]{12})\.([0-9a-f]{64})$/;
const HEX_SECRET = /^(?:[0-9a-fA-F]{2}){32,}$/;

export type PreparationProofFields = {
  userId: string;
  clientId: string;
  courseId: string;
  itemId: string;
  baseItemHash: string;
  proposedItemHash: string;
  importText: string;
};

export type PreparationProofOptions = {
  /** Test-only clock injection; production uses Date.now. */
  now?: () => number;
  /** Test-only secret injection; production uses the dedicated server environment variable. */
  secretHex?: string;
};

export type PreparationProofErrorCode =
  | 'SERVICE_UNAVAILABLE'
  | 'PREPARATION_PROOF_INVALID'
  | 'PREPARATION_PROOF_EXPIRED';

const ERROR_MESSAGES: Record<PreparationProofErrorCode, string> = {
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
  PREPARATION_PROOF_INVALID: 'The preparation proof is invalid.',
  PREPARATION_PROOF_EXPIRED: 'The preparation proof has expired.',
};

export class PreparationProofError extends Error {
  constructor(readonly code: PreparationProofErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'PreparationProofError';
  }
}

function secretBytes(options: PreparationProofOptions): Buffer {
  const hex = options.secretHex ?? process.env.STUDIO_MCP_PREPARATION_PROOF_SECRET;
  if (typeof hex !== 'string' || !HEX_SECRET.test(hex)) {
    throw new PreparationProofError('SERVICE_UNAVAILABLE');
  }
  return Buffer.from(hex, 'hex');
}

/** Check the dedicated key on tool entry, before reading any draft. */
export function assertPreparationProofConfigured(options: PreparationProofOptions = {}): void {
  secretBytes(options);
}

function clockNow(options: PreparationProofOptions): number {
  const now = options.now?.() ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new PreparationProofError('SERVICE_UNAVAILABLE');
  }
  return now;
}

function signedPayload(expiresAt: number, fields: PreparationProofFields): string {
  const values = [
    fields.userId, fields.clientId, fields.courseId, fields.itemId,
    fields.baseItemHash, fields.proposedItemHash, fields.importText,
  ];
  if (values.some((value) => typeof value !== 'string')) {
    throw new PreparationProofError('PREPARATION_PROOF_INVALID');
  }
  const importTextSha256 = createHash('sha256').update(fields.importText, 'utf8').digest('hex');
  return JSON.stringify([
    VERSION, expiresAt, fields.userId, fields.clientId, fields.courseId, fields.itemId,
    fields.baseItemHash, fields.proposedItemHash, importTextSha256,
  ]);
}

function macFor(expiresAt: number, fields: PreparationProofFields, key: Buffer): Buffer {
  return createHmac('sha256', key).update(signedPayload(expiresAt, fields), 'utf8').digest();
}

/** Bind one prepared import to its authenticated caller and exact UTF-8 paste text. */
export function createPreparationProof(
  fields: PreparationProofFields,
  options: PreparationProofOptions = {},
): string {
  const key = secretBytes(options);
  const expiresAt = clockNow(options) + LIFETIME_MS;
  if (!Number.isSafeInteger(expiresAt) || !/^[1-9][0-9]{12}$/.test(String(expiresAt))) {
    throw new PreparationProofError('SERVICE_UNAVAILABLE');
  }
  return `${VERSION}.${expiresAt}.${macFor(expiresAt, fields, key).toString('hex')}`;
}

/** Verify the MAC before expiry so an unauthenticated token reveals no validity detail. */
export function verifyPreparationProof(
  proof: string,
  fields: PreparationProofFields,
  options: PreparationProofOptions = {},
): void {
  const key = secretBytes(options);
  const match = typeof proof === 'string' ? TOKEN.exec(proof) : null;
  if (!match) throw new PreparationProofError('PREPARATION_PROOF_INVALID');

  const expiresAt = Number(match[1]);
  const suppliedMac = Buffer.from(match[2], 'hex');
  const expectedMac = macFor(expiresAt, fields, key);
  if (!timingSafeEqual(suppliedMac, expectedMac)) {
    throw new PreparationProofError('PREPARATION_PROOF_INVALID');
  }
  if (clockNow(options) >= expiresAt) {
    throw new PreparationProofError('PREPARATION_PROOF_EXPIRED');
  }
}
