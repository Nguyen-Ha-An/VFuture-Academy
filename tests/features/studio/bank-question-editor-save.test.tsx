// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/en.json';
import viMessages from '@/messages/vi.json';
import { itemRef } from '@/content-engine/diagnostics';
import { parseJsonDocument } from '@/content-engine/validate/parse';
import { requestNavigation } from '@/lib/navigation-guard';
import { BankQuestionEditor } from '@/features/studio/ui/BankQuestionEditor';

vi.mock('@uiw/react-codemirror', () => ({ default: (props: { value: string; editable: boolean; onChange: (value: string) => void }) => <textarea aria-label="Question JSON editor" disabled={!props.editable} value={props.value} onChange={(event) => props.onChange(event.target.value)} /> }));
const detail = { id: 'bank-question', status: 'draft', currentVersionId: null, languages: ['en'] as Array<'en' | 'vi'>, latestVersion: { id: 'version-1', version: 1, payload: { id: 'bank-question', type: 'true_false', content: { blocks: [] }, correctAnswer: true }, renders: {}, grading: null } };
// Existing contracts exercise the explicit JSON mode.
beforeEach(() => { window.localStorage.setItem('academy.canvas.editor-mode', 'json'); });
afterEach(() => vi.unstubAllGlobals());
const bankRouter = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => bankRouter }));
afterEach(cleanup);

describe('BankQuestionEditor workflow integration', () => {
  it('defaults to visual bank fields and carries edits into the existing JSON source', async () => {
    window.localStorage.removeItem('academy.canvas.editor-mode');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { content: { contentType: 'bank_question', contentId: detail.id, revisionKey: 'v1', status: 'draft', publishedRevisionKey: null }, activeReview: null, publication: null, actions: { requestReview: true, withdrawReview: false, approveAndPublish: false, mutate: true } } }))));
    render(<NextIntlClientProvider locale="en" messages={messages}><BankQuestionEditor initialDetail={detail} /></NextIntlClientProvider>);
    expect(screen.getByRole('tab', { name: 'Visual' })).toHaveAttribute('aria-selected', 'true');
    const answer = screen.getByRole('checkbox', { name: 'Answer key' });
    await waitFor(() => expect(answer).toBeEnabled());
    fireEvent.click(answer);
    fireEvent.click(screen.getByRole('tab', { name: 'JSON' }));
    const source = (screen.getByRole('textbox', { name: 'Question JSON editor' }) as HTMLTextAreaElement).value;
    expect(JSON.parse(source)).toEqual({ ...detail.latestVersion.payload, correctAnswer: false });
  });
  it('keeps invalid bank edits when a scope transition is cancelled', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ data: { content: { contentType: 'bank_question', contentId: detail.id, revisionKey: 'v1', status: 'draft', publishedRevisionKey: null }, activeReview: null, publication: null, actions: { requestReview: true, withdrawReview: false, approveAndPublish: false, mutate: true } } })));
    vi.stubGlobal('fetch', request);
    render(<NextIntlClientProvider locale="en" messages={messages}><BankQuestionEditor initialDetail={detail} /></NextIntlClientProvider>);
    const editor = screen.getByRole('textbox', { name: 'Question JSON editor' });
    await waitFor(() => expect(editor).toBeEnabled());
    fireEvent.change(editor, {target:{value:'{"invalid'}});
    let transition!: Promise<boolean>;
    act(() => { transition = requestNavigation(); });
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', {name:messages.studioWorkspace.stay}));
    await expect(transition).resolves.toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: 'Visual' }));
    expect(screen.getByText(/This document has invalid JSON/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'JSON' }));
    expect(screen.getByRole('textbox', { name: 'Question JSON editor' })).toHaveValue('{"invalid');
  });
  it('removes standalone publishing and enables the editor only after an editable workflow loads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { content: { contentType: 'bank_question', contentId: 'bank-question', revisionKey: 'v1', status: 'draft', publishedRevisionKey: null }, activeReview: null, publication: null, actions: { requestReview: true, withdrawReview: false, approveAndPublish: false, mutate: true } } }))));
    render(<NextIntlClientProvider locale="en" messages={messages}><BankQuestionEditor initialDetail={detail} /></NextIntlClientProvider>);
    expect(screen.getByRole('textbox', { name: 'Question JSON editor' })).toBeDisabled();
    expect(await screen.findByRole('button', { name: 'Submit for review' })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Question JSON editor' })).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
  });

  it('shows strict JSON diagnostics in the interface language', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { content: { contentType: 'bank_question', contentId: detail.id, revisionKey: 'v1', status: 'draft', publishedRevisionKey: null }, activeReview: null, publication: null, actions: { requestReview: true, withdrawReview: false, approveAndPublish: false, mutate: true } } }))));
    render(<NextIntlClientProvider locale="vi" messages={viMessages}><BankQuestionEditor initialDetail={detail} /></NextIntlClientProvider>);
    const editor = screen.getByRole('textbox', { name: 'Question JSON editor' });
    await waitFor(() => expect(editor).toBeEnabled());
    const invalid = '{"id":"a","id":"b"}';
    const expected = parseJsonDocument(invalid, itemRef(detail.id)).errors[0]!.message;
    fireEvent.change(editor, { target: { value: invalid } });
    expect(await screen.findByText(expected.vi)).toBeInTheDocument();
    expect(screen.queryByText(expected.en)).not.toBeInTheDocument();
  });
});
