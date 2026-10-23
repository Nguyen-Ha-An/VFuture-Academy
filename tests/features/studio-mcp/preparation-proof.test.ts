import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  assertPreparationProofConfigured,
  createPreparationProof,
  PreparationProofError,
  verifyPreparationProof,
  type PreparationProofFields,
} from '@/features/studio-mcp/validation/preparation-proof';

const SECRET = 'ab'.repeat(32);
const NOW = Date.parse('2026-09-26T08:00:00.000Z');
const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;
const fields: PreparationProofFields = {
  userId: 'user-a',
  clientId: 'client-a',
  courseId: 'course-a',
  itemId: 'lesson-a',
  baseItemHash: `sha256:${'a'.repeat(64)}`,
  proposedItemHash: `sha256:${'b'.repeat(64)}`,
  importText: '{\n  "title": "Café"\n}',
};
const options = { secretHex: SECRET, now: () => NOW };

afterEach(() => vi.unstubAllEnvs());

describe('preparationProof', () => {
  it('issues a compact v1 HMAC token that verifies for the same exact fields', () => {
    const proof = createPreparationProof(fields, options);
    const expiresAt = NOW + WEEK_MS;
    const digest = createHash('sha256').update(fields.importText, 'utf8').digest('hex');
    const payload = JSON.stringify([
      'v1', expiresAt, fields.userId, fields.clientId, fields.courseId, fields.itemId,
      fields.baseItemHash, fields.proposedItemHash, digest,
    ]);
    const mac = createHmac('sha256', Buffer.from(SECRET, 'hex')).update(payload, 'utf8').digest('hex');

    expect(proof).toBe(`v1.${expiresAt}.${mac}`);
    expect(proof).not.toContain('Café');
    expect(verifyPreparationProof(proof, fields, options)).toBeUndefined();
  });

  it.each(Object.keys(fields) as (keyof PreparationProofFields)[])(
    'rejects changed %s even when the token remains well formed',
    (key) => {
      const proof = createPreparationProof(fields, options);
      const changed = { ...fields, [key]: `${fields[key]}!` };
      expect(() => verifyPreparationProof(proof, changed, options))
        .toThrowError(expect.objectContaining({ code: 'PREPARATION_PROOF_INVALID' }));
    },
  );

  it('binds the exact UTF-8 import text including whitespace and Unicode composition', () => {
    const proof = createPreparationProof(fields, options);
    expect(() => verifyPreparationProof(proof, {
      ...fields, importText: fields.importText.replace('Café', 'Cafe\u0301'),
    }, options)).toThrowError(expect.objectContaining({ code: 'PREPARATION_PROOF_INVALID' }));
    expect(() => verifyPreparationProof(proof, {
      ...fields, importText: `${fields.importText}\n`,
    }, options)).toThrowError(expect.objectContaining({ code: 'PREPARATION_PROOF_INVALID' }));
  });

  it('expires exactly seven days after preparation', () => {
    const proof = createPreparationProof(fields, options);
    expect(() => verifyPreparationProof(proof, fields, { ...options, now: () => NOW + WEEK_MS - 1 })).not.toThrow();
    expect(() => verifyPreparationProof(proof, fields, { ...options, now: () => NOW + WEEK_MS }))
      .toThrowError(expect.objectContaining({ code: 'PREPARATION_PROOF_EXPIRED' }));
  });

  it.each([
    '', 'v2.1790409600000.' + '0'.repeat(64),
    'v1.01790409600000.' + '0'.repeat(64),
    'v1.1790409600000.' + 'A'.repeat(64),
    'v1.1790409600000.' + '0'.repeat(63),
    'v1.1790409600000.' + '0'.repeat(64) + '.extra',
  ])('rejects malformed token %s', (proof) => {
    expect(() => verifyPreparationProof(proof, fields, options))
      .toThrowError(expect.objectContaining({ code: 'PREPARATION_PROOF_INVALID' }));
  });

  it('rejects altered expiry and MAC', () => {
    const proof = createPreparationProof(fields, options);
    const [version, expiry, mac] = proof.split('.');
    expect(() => verifyPreparationProof(`${version}.${Number(expiry) + 1}.${mac}`, fields, options))
      .toThrowError(expect.objectContaining({ code: 'PREPARATION_PROOF_INVALID' }));
    expect(() => verifyPreparationProof(`${version}.${expiry}.${mac.slice(0, -1)}${mac.at(-1) === 'a' ? 'b' : 'a'}`, fields, options))
      .toThrowError(expect.objectContaining({ code: 'PREPARATION_PROOF_INVALID' }));
  });

  it('rejects an otherwise valid token with a trailing newline', () => {
    const proof = createPreparationProof(fields, options);
    expect(() => verifyPreparationProof(`${proof}\n`, fields, options))
      .toThrowError(expect.objectContaining({ code: 'PREPARATION_PROOF_INVALID' }));
  });

  it('fails closed without a configured production secret', () => {
    vi.stubEnv('STUDIO_MCP_PREPARATION_PROOF_SECRET', undefined);
    expect(() => assertPreparationProofConfigured())
      .toThrowError(expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }));
    expect(() => createPreparationProof(fields, { now: () => NOW }))
      .toThrowError(expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }));
    expect(() => verifyPreparationProof('malformed', fields, { now: () => NOW }))
      .toThrowError(expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }));
  });

  it.each([
    'ab'.repeat(31),
    'ab'.repeat(32) + 'g0',
    'ab'.repeat(32) + 'a',
    'ab'.repeat(32) + '\n',
  ])('rejects a weak or malformed hex secret', (secretHex) => {
    expect(() => createPreparationProof(fields, { now: () => NOW, secretHex }))
      .toThrowError(expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }));
  });

  it('reads the production secret lazily from the dedicated environment variable', () => {
    vi.stubEnv('STUDIO_MCP_PREPARATION_PROOF_SECRET', SECRET);
    expect(() => assertPreparationProofConfigured()).not.toThrow();
    const proof = createPreparationProof(fields, { now: () => NOW });
    expect(() => verifyPreparationProof(proof, fields, { now: () => NOW })).not.toThrow();
    vi.stubEnv('STUDIO_MCP_PREPARATION_PROOF_SECRET', 'cd'.repeat(32));
    expect(() => verifyPreparationProof(proof, fields, { now: () => NOW }))
      .toThrowError(expect.objectContaining({ code: 'PREPARATION_PROOF_INVALID' }));
  });

  it('uses a fixed error class and code without leaking proof material', () => {
    const proof = createPreparationProof(fields, options);
    try {
      verifyPreparationProof(proof, { ...fields, userId: 'different' }, options);
      throw new Error('Expected verification to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(PreparationProofError);
      expect(error).toMatchObject({ code: 'PREPARATION_PROOF_INVALID' });
      expect(String(error)).not.toContain(proof);
      expect(String(error)).not.toContain(fields.importText);
    }
  });
});
