import { inflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { renderCertificatePdf } from '@/features/certificates/CertificateDocument';

function unicodeMaps(pdf: Uint8Array): string[] {
  const source = Buffer.from(pdf).toString('latin1');
  return [...source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].flatMap((match) => {
    try {
      const decoded = inflateSync(Buffer.from(match[1]!, 'latin1')).toString('utf8');
      return decoded.includes('begincmap') ? [decoded.toUpperCase()] : [];
    } catch { return []; }
  });
}

const name = 'Đặng Nguyễn Thị Ánh';
const vietnameseTitle = 'Nền tảng Trí tuệ nhân tạo';
const url = 'https://academy.example/verify/11111111-1111-4111-8111-111111111111';

describe('certificate PDF text and verification', () => {
  it.each(['en', 'vi'] as const)('keeps maximum-length names and course titles on one page in %s', async (locale) => {
    const pdf = await renderCertificatePdf({
      learnerName: 'Nguyễn Thị Ánh Đặng '.repeat(8).slice(0, 120),
      courseTitle: 'Nền tảng Trí tuệ nhân tạo và Phát triển bền vững '.repeat(4).slice(0, 120),
      locale, issuedAt: '2026-09-05T00:00:00Z', serial: 'VFA-2026-ABCDEFGH', verificationUrl: url,
    });
    expect(Buffer.from(pdf).toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
  });

  it.each(['en', 'vi'] as const)('embeds Vietnamese glyph mappings and a clickable verification link in %s', async (locale) => {
    const pdf = await renderCertificatePdf({
      learnerName: name, courseTitle: vietnameseTitle, locale,
      issuedAt: '2026-09-05T00:00:00Z', serial: 'VFA-2026-ABCDEFGH', verificationUrl: url,
    });
    const maps = unicodeMaps(pdf).join('\n');
    for (const character of new Set([...name, ...vietnameseTitle].filter(value => value.codePointAt(0)! > 127))) {
      const hex = character.codePointAt(0)!.toString(16).padStart(4, '0').toUpperCase();
      expect(maps, `Missing Unicode mapping for ${character}`).toContain(`<${hex}>`);
    }
    const source = Buffer.from(pdf).toString('latin1');
    expect(source).toContain('/FontFile2');
    expect(source.match(/\/Type \/Page\b/g)).toHaveLength(1);
    expect(source).toContain(`/URI (${url})`);
  });
});
