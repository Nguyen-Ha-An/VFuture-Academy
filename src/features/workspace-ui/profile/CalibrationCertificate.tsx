import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { ictDate } from '@/features/workspace-ui/format';
import { Kicker, Meta } from '@/features/workspace-ui/ui/primitives';
import { CopyVerifyLink } from './CopyVerifyLink';

export type CalibrationCertificateData = {
  id: string;
  serial: string;
  courseTitle: string;
  holder: string;
  issuedAt: string;
  /** Route path, e.g. `/verify/K7Q2-9XMA`. */
  verifyPath: string;
  /** Absolute verify URL when the canonical origin is known, otherwise the path. */
  verifyUrl: string;
  pdfAvailable: boolean;
  /** Authored course code or pathway label. Omitted when the course data does not carry one. */
  part?: string | null;
  /** Issuing branch. Omitted when unknown; the issuer then reads "VFuture Labs" alone. */
  branch?: string | null;
  result?: { score: number; threshold: number } | null;
  /** Server-generated QR SVG markup for the verify URL (see certificate-qr.ts). */
  qrSvg?: string | null;
};

function displayUrl(url: string) {
  return url.replace(/^https?:\/\//, '');
}

/** Spec 4.6: a certificate reads like a calibration record, not a celebration. */
export function CalibrationCertificate({ certificate }: { certificate: CalibrationCertificateData }) {
  const t = useTranslations('bench.profile.certificates');
  const legacy = useTranslations('learner.profile');
  const headingId = `certificate-${certificate.id}`;

  return <article className="vf-cert" aria-labelledby={headingId}>
    <div className="vf-cert-main">
      <div className="vf-cert-top"><Kicker as="span">{t('kicker')}</Kicker><Meta as="span">{certificate.serial}</Meta></div>
      <h3 id={headingId} className="vf-cert-title">{certificate.courseTitle}</h3>
      <dl className="vf-cert-fields">
        <div><dt>{t('holder')}</dt><dd>{certificate.holder}</dd></div>
        {certificate.part ? <div><dt>{t('part')}</dt><dd className="vf-mono">{certificate.part}</dd></div> : null}
        <div><dt>{t('issuedBy')}</dt><dd>{certificate.branch ? `${t('issuer')} · ${certificate.branch}` : t('issuer')}</dd></div>
        <div><dt>{t('issued')}</dt><dd className="vf-mono"><time dateTime={certificate.issuedAt}>{ictDate(new Date(certificate.issuedAt))}</time></dd></div>
        {certificate.result ? <div><dt>{t('result')}</dt><dd><span className="vf-mono">{certificate.result.score}/100</span> · ≥ {certificate.result.threshold}</dd></div> : null}
        <div className="vf-cert-verify"><dt>{t('verifyUrl')}</dt><dd className="vf-mono">{displayUrl(certificate.verifyUrl)}</dd></div>
      </dl>
      <div className="vf-cert-actions">
        {certificate.pdfAvailable ? <a className="vf-btn vf-btn-primary" href={`/api/v1/me/certificates/${encodeURIComponent(certificate.id)}/download`}>{legacy('viewPdf')}</a> : null}
        <CopyVerifyLink url={certificate.verifyUrl} />
        <Link className="vf-btn vf-btn-ghost" href={certificate.verifyPath} aria-label={legacy('verify', { serial: certificate.serial })}>{t('verify')} <span aria-hidden="true">→</span></Link>
      </div>
    </div>
    <div className="vf-cert-side">
      {certificate.qrSvg
        // The markup is produced server-side by the qrcode package from our own verify URL.
        ? <div className="vf-qr" role="img" aria-label={t('qr', { serial: certificate.serial })} dangerouslySetInnerHTML={{ __html: certificate.qrSvg }} />
        : null}
      <span className="vf-stamp"><span aria-hidden="true">■</span> {t('inSpec')}</span>
      <Meta as="span">{t('publicNote')}</Meta>
    </div>
  </article>;
}
