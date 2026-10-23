import { renderCertificatePdf } from '../../../src/features/certificates/CertificateDocument';

void (async () => {
  const pdf = await renderCertificatePdf({
    learnerName: 'Recovery Sample',
    courseTitle: 'AI Foundations',
    locale: 'en',
    issuedAt: '2026-09-05T00:00:00.000Z',
    serial: 'VFA-2026-ABCDEFGH',
    verificationUrl: 'http://127.0.0.1:3000/verify/11111111-1111-4111-8111-111111111111',
  });
  console.log(JSON.stringify({
    bytes: pdf.byteLength,
    header: Buffer.from(pdf).subarray(0, 5).toString(),
    trailer: Buffer.from(pdf).subarray(-6).toString().trim(),
  }));
})();
