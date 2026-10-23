// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import viMessages from '@/messages/vi.json';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { BankImportDialog } from '@/features/studio/ui/BankImportDialog';

const bundle = { schemaVersion: 1, kind: 'question_bundle', id: 'import', questions: [] };

describe('BankImportDialog', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('shows server validation paths and messages without discarding the submitted bundle', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        message: 'Question bundle validation failed',
        issues: [
          { path: ['questions', 0, 'correctAnswer'], message: 'Expected an option id' },
          { path: ['questions', 1, 'id'], message: 'Question id is duplicated' },
        ],
      },
    }), { status: 400 })));
    render(<NextIntlClientProvider locale="en" messages={en}><BankImportDialog /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Import bundle' }));
    const editor = screen.getByLabelText('Question bundle JSON');
    fireEvent.change(editor, { target: { value: JSON.stringify(bundle) } });

    fireEvent.click(screen.getByRole('button', { name: 'Import questions' }));

    expect(await screen.findByText('questions.0.correctAnswer — Expected an option id')).toBeInTheDocument();
    expect(screen.getByText('questions.1.id — Question id is duplicated')).toBeInTheDocument();
    expect(editor).toHaveValue(JSON.stringify(bundle));
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('keeps the dialog open until an import request finishes', async () => {
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));
    render(<NextIntlClientProvider locale="en" messages={en}><BankImportDialog /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Import bundle' }));
    fireEvent.change(screen.getByLabelText('Question bundle JSON'), { target: { value: JSON.stringify(bundle) } });
    fireEvent.click(screen.getByRole('button', { name: 'Import questions' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.getByRole('dialog', { name: 'Import question bundle' })).toBeInTheDocument();
    resolveFetch(new Response(JSON.stringify({ data: { id: 'import' } }), { status: 200 }));
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(screen.getByRole('status')).toHaveTextContent('Question bundle imported.');
  });

  it('keeps its status region mounted while the import result arrives', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'import' } }), { status: 200 })));
    render(<NextIntlClientProvider locale="en" messages={en}><BankImportDialog /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Import bundle' }));
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();

    fireEvent.change(screen.getByLabelText('Question bundle JSON'), { target: { value: JSON.stringify(bundle) } });
    fireEvent.click(screen.getByRole('button', { name: 'Import questions' }));

    await vi.waitFor(() => expect(status).toHaveTextContent('Question bundle imported.'));
    expect(screen.getByRole('status')).toBe(status);
  });
});

describe('BankImportDialog raw input strictness', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  const submit = (text: string) => {
    render(<NextIntlClientProvider locale="en" messages={en}><BankImportDialog /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Import bundle' }));
    fireEvent.change(screen.getByLabelText('Question bundle JSON'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Import questions' }));
  };

  it('rejects a duplicate key before it can be serialized away', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    submit('{"schemaVersion":1,"kind":"question_bundle","id":"a","id":"b","questions":[]}');

    await screen.findByText(/"id" is declared/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('shows strict JSON diagnostics in Vietnamese for the Vietnamese locale', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    render(<NextIntlClientProvider locale="vi" messages={viMessages}><BankImportDialog /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Nhập gói câu hỏi' }));
    fireEvent.change(screen.getByLabelText('JSON gói câu hỏi'), { target: { value: '{"id":"a","id":"b"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Nhập câu hỏi' }));

    expect(await screen.findByText(/khai báo|trùng lặp/i)).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects an overflowing number instead of sending Infinity', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    submit('{"schemaVersion":1,"kind":"question_bundle","id":"a","points":1e999,"questions":[]}');

    await screen.findByText(/out of range|cannot be represented|1e999/i, { selector: 'li' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends the author exact bytes so the server validates what was written', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'import' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const text = '{"schemaVersion":1,   "kind":"question_bundle","id":"import","questions":[]}';
    submit(text);

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(text);
  });
});
