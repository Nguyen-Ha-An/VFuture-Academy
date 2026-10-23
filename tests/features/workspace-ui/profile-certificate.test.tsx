// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import { withBenchMessages } from '@/messages/bench';
import { CalibrationCertificate, type CalibrationCertificateData } from '@/features/workspace-ui/profile/CalibrationCertificate';
import { certificateQrSvg, certificateVerifyUrl } from '@/features/workspace-ui/profile/certificate-qr';

const messages = withBenchMessages(en, 'en');
const certificate: CalibrationCertificateData = {
  id: 'cert-1',
  serial: 'VF-CERT-2026-004817',
  courseTitle: 'Python for data engineers',
  holder: 'Trần Minh Khoa',
  issuedAt: '2026-08-14T03:00:00.000Z',
  verifyPath: '/verify/K7Q2-9XMA',
  verifyUrl: 'https://vfuture.example/verify/K7Q2-9XMA',
  pdfAvailable: true,
  qrSvg: '<svg viewBox="0 0 25 25"><path d="M0 0h1v1H0z"/></svg>',
};

function renderCertificate(value: CalibrationCertificateData = certificate) {
  return render(<NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Ho_Chi_Minh"><CalibrationCertificate certificate={value} /></NextIntlClientProvider>);
}

const writeText = vi.fn();
beforeEach(() => {
  writeText.mockReset();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('CalibrationCertificate', () => {
  it('renders the record fields, the verify contract and the existing PDF download', () => {
    renderCertificate();
    expect(screen.getByRole('article', { name: 'Python for data engineers' })).toBeVisible();
    expect(screen.getByText('Certificate of completion · calibrated')).toBeVisible();
    expect(screen.getByText('VF-CERT-2026-004817')).toBeVisible();
    expect(screen.getByText('Trần Minh Khoa')).toBeVisible();
    expect(screen.getByText('14.08.2026')).toBeVisible();
    expect(screen.getByText('VFuture Labs')).toBeVisible();
    expect(screen.getByText('vfuture.example/verify/K7Q2-9XMA')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Verify certificate VF-CERT-2026-004817' })).toHaveAttribute('href', '/verify/K7Q2-9XMA');
    expect(screen.getByRole('link', { name: 'View certificate PDF' })).toHaveAttribute('href', '/api/v1/me/certificates/cert-1/download');
    expect(screen.getByRole('img', { name: 'Verification QR code for certificate VF-CERT-2026-004817' })).toBeVisible();
    expect(screen.getByText('In spec')).toBeVisible();
    // No invented data: part and result only render when the data model provides them.
    expect(screen.queryByText('Part')).not.toBeInTheDocument();
    expect(screen.queryByText('Result')).not.toBeInTheDocument();
  });

  it('omits the PDF link and QR when they are unavailable', () => {
    renderCertificate({ ...certificate, pdfAvailable: false, qrSvg: null });
    expect(screen.queryByRole('link', { name: 'View certificate PDF' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('copies the verify link, reads "Copied" for 2s and announces it politely', async () => {
    vi.useFakeTimers();
    writeText.mockResolvedValue(undefined);
    const { container } = renderCertificate();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy verify link' })); });
    expect(writeText).toHaveBeenCalledWith('https://vfuture.example/verify/K7Q2-9XMA');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('Verify link copied');
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByRole('button', { name: 'Copy verify link' })).toBeVisible();
  });

  it('shows a fault hint when the clipboard rejects', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    renderCertificate();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy verify link' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Copy failed');
    expect(screen.getByRole('button', { name: 'Copy verify link' })).toBeVisible();
  });
});

describe('certificate QR helpers', () => {
  it('builds an absolute verify URL only when the origin is known', () => {
    expect(certificateVerifyUrl('/verify/ABC', 'https://app.example')).toBe('https://app.example/verify/ABC');
    expect(certificateVerifyUrl('/verify/ABC', '')).toBe('/verify/ABC');
  });

  it('generates a real QR SVG server-side and skips relative paths', async () => {
    await expect(certificateQrSvg('/verify/ABC')).resolves.toBeNull();
    const svg = await certificateQrSvg('https://app.example/verify/ABC');
    expect(svg).toMatch(/^<svg[^>]*viewBox="0 0 \d+ \d+"/);
    expect(svg).toContain('<path');
  });
});
