// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';

vi.mock('@/content-engine/render', () => ({
  createPreviewRuntime: vi.fn(() => ({})),
  QuestionRenderer: () => null,
  registerAll: vi.fn(),
}));

import { BankQuestionEditor } from '@/features/studio/ui/BankQuestionEditor';
import { StaffTitleContext } from '@/features/workspace/ui/StaffTitleContext';

const bankRouter = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => bankRouter }));
afterEach(cleanup);

describe('BankQuestionEditor accessibility', () => {
  it('gives the CodeMirror textbox an accessible name and tolerates missing grading data', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <BankQuestionEditor
          initialDetail={{
            id: 'bank-question',
            status: 'draft',
            currentVersionId: null,
            languages: ['en'],
            latestVersion: { id: 'version-1', version: 1, payload: { id: 'bank-question' }, renders: {}, grading: null },
          }}
          canPublish={false}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('textbox', { name: 'Question JSON editor' })).toBeInTheDocument();
  });

  it('registers a localized question title rather than its opaque ID', () => {
    const register = vi.fn(() => () => {});
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <StaffTitleContext.Provider value={register}>
          <BankQuestionEditor
            initialDetail={{
              id: 'opaque-question-id', status: 'draft', currentVersionId: null, languages: ['en'],
              latestVersion: { id: 'version-1', version: 1, payload: { id: 'opaque-question-id', title: { vi: 'Câu hỏi mẫu', en: 'Sample question' } }, renders: {}, grading: null },
            }}
            canPublish={false}
          />
        </StaffTitleContext.Provider>
      </NextIntlClientProvider>,
    );

    expect(register).toHaveBeenCalledWith('Sample question');
    expect(register).not.toHaveBeenCalledWith('opaque-question-id');
  });
});
