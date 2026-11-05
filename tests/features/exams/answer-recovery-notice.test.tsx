// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { ExamAnswerRecoveryNotice } from '@/features/exams/ui/ExamAnswerRecoveryNotice';
import en from '@/messages/en.json';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('own-answer recovery download', () => {
  it('exports only the attempt identity and own responses, with an explicit verification label', async () => {
    const previousCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const previousRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    let captured: Blob | undefined;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: (blob: Blob) => { captured = blob; return 'blob:own-answer-copy'; } });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      const copy = { attemptId: 'own-attempt', attemptNo: 1, answers: { essay: 'My unsaved response' }, verified: true, answerKey: 'Must not be exported', accessToken: 'Must not be exported' };
      const view = render(<NextIntlClientProvider locale="en" messages={en}><ExamAnswerRecoveryNotice recoveries={[copy]} /></NextIntlClientProvider>);
      await userEvent.click(screen.getByRole('button', { name: 'Download local answers — attempt 1' }));
      if (!captured) throw new Error('The download must contain a local answer Blob.');
      const blob = captured;
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      });
      expect(JSON.parse(text)).toEqual({ attemptId: 'own-attempt', attemptNo: 1, verification: 'confirmed-unaccepted', answers: { essay: 'My unsaved response' } });
      expect(text).not.toContain('Must not be exported');
      view.unmount();
    } finally {
      if (previousCreate) Object.defineProperty(URL, 'createObjectURL', previousCreate); else Reflect.deleteProperty(URL, 'createObjectURL');
      if (previousRevoke) Object.defineProperty(URL, 'revokeObjectURL', previousRevoke); else Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('labels an unverified candidate honestly and warns when durable recovery was unavailable', () => {
    render(<NextIntlClientProvider locale="en" messages={en}><ExamAnswerRecoveryNotice recoveries={[{ attemptId: 'own-attempt', attemptNo: 1, answers: { essay: 'Local response' }, verified: false, storageUnavailable: true }]} /></NextIntlClientProvider>);
    expect(screen.getByRole('alert')).toHaveTextContent('acceptance has not yet been verified');
    expect(screen.queryByText(/are not included in the result/)).not.toBeInTheDocument();
    expect(screen.getByText(/could not store the latest recovery copy/)).toBeInTheDocument();
  });
});
