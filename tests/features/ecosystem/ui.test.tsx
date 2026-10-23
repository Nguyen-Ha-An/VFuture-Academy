// @vitest-environment jsdom
import { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

const mocks = vi.hoisted(() => ({ track: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));

vi.mock('@/features/content-review/ContentWorkflowPanel', () => ({ ContentWorkflowPanel: ({onLockChange,beforeSubmit}: {onLockChange:(locked:boolean)=>void;beforeSubmit:()=>Promise<boolean>}) => {
  useEffect(() => onLockChange(false), [onLockChange]);
  return <button type="button" onClick={() => void beforeSubmit()}>Submit for review</button>;
} }));
vi.mock('@/lib/analytics-client', () => ({ track: mocks.track }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }) }));

import { OpportunityEditor, isoToUtcDateTimeInput, utcDateTimeInputToIso } from '@/features/opportunities/ui/OpportunityEditor';
import { OpportunityAction, OpportunityViewTracker } from '@/features/opportunities/ui/OpportunityActions';
import { ResourceEditor } from '@/features/resources/ui/ResourceEditor';

const rich = (text: string) => ({ blocks: [{ type: 'paragraph' as const, content: [{ text }] }] });
const resource = {
  schemaVersion: 1 as const,
  kind: 'resource' as const,
  id: 'prompting-guide',
  languages: ['vi', 'en'] as Array<'vi' | 'en'>,
  defaultLanguage: 'en' as const,
  title: { vi: 'Huong dan', en: 'Guide' },
  summary: { vi: 'Tom tat', en: 'Summary' },
  resourceType: 'guide' as const,
  body: { vi: rich('Noi dung'), en: rich('Preview body') },
};
const opportunity = {
  id: 'ai-internship',
  title: { vi: 'Thuc tap AI', en: 'AI internship' },
  organization: 'VFuture',
  type: 'external_program' as const,
  description: { vi: rich('Mo ta'), en: rich('Description') },
  eligibility: {},
  recommendedSkills: ['ai'],
  recommendedCourses: ['ai-foundations'],
  requiredCourses: [],
  applicationUrl: 'https://example.com/apply',
  internalApplication: false,
  openAt: null,
  closeAt: null,
  startAt: null,
  endAt: null,
  location: null,
  online: true,
  branchScope: { scope: 'global' as const },
  featured: true,
};

function Provider({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider locale="en" messages={staffUiTestMessages(en, 'en')}>{children}</NextIntlClientProvider>;
}

describe('resource editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body ?? '{}')) as { document?: typeof resource };
      const document = input.document ?? resource;
      const data = String(url).endsWith('/validate')
        ? { document }
        : { id: document.id, document, status: 'draft', ownerId: 'editor-1', publishedAt: null, updatedAt: '2026-09-05T00:00:00.000Z' };
      return new Response(JSON.stringify({ data }), { status: 200 });
    }));
  });
  afterEach(cleanup);

  it('previews the same validated resource JSON and saves through the Studio route', async () => {
    const user = userEvent.setup();
    render(<Provider><ResourceEditor initialDocument={resource} canPublish /></Provider>);

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Preview body')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', {name:'Resource JSON'}), {target:{value:JSON.stringify({...resource,title:{vi:'Huong dan',en:'Revised guide'}})}});
    await user.click(screen.getByRole('button', { name: 'Save now' }));

    expect(fetch).toHaveBeenCalledWith('/api/v1/studio/resources/prompting-guide', expect.objectContaining({ method: 'PUT' }));
    expect(screen.getByRole('textbox', { name: 'Resource JSON' })).toBeInTheDocument();
  });

  it('writes labelled branch-scope controls into the saved resource document', async () => {
    const user = userEvent.setup();
    render(<Provider><ResourceEditor initialDocument={resource} canPublish /></Provider>);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Branch scope' }), 'branches');
    fireEvent.change(screen.getByRole('textbox', { name: 'Branch IDs (comma-separated)' }), {
      target: { value: 'branch-one, branch-two' },
    });
    await user.click(screen.getByRole('button', { name: 'Save now' }));

    const request = vi.mocked(fetch).mock.calls.at(-1)?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      document: { branchScope: { scope: 'branches', branchIds: ['branch-one', 'branch-two'] } },
    });
  });
});

describe('opportunity editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async()=>new Response(JSON.stringify({ data: { id: 'ai-internship', status: 'draft', updated_at:'2026-09-05T02:00:00.000Z' } }), { status: 200 })));
  });
  afterEach(cleanup);

  it('imports validated JSON into labelled react-hook-form fields and saves it', async () => {
    const user = userEvent.setup();
    render(<Provider><OpportunityEditor initialValue={opportunity} canPublish /></Provider>);

    fireEvent.change(screen.getByRole('textbox', { name: 'Opportunity JSON' }), {
      target: { value: JSON.stringify({ ...opportunity, organization: 'Future Lab' }) },
    });
    await user.click(screen.getByRole('button', { name: 'Import JSON' }));
    expect(screen.getByLabelText('Organization')).toHaveValue('Future Lab');
    await user.click(screen.getByRole('button', { name: 'Save now' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/v1/studio/opportunities/ai-internship', expect.objectContaining({ method: 'PUT' })));
  });

  it('creates a new opportunity through the create-only collection and adopts its canonical route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { id: 'ai-internship', status: 'draft', updated_at: '2026-09-05T01:00:00.000Z' },
    }), { status: 201 })));
    const user = userEvent.setup();
    render(<Provider><OpportunityEditor initialValue={opportunity} canPublish isNew /></Provider>);

    await user.click(screen.getByRole('button', { name: 'Save now' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/v1/studio/opportunities', expect.objectContaining({ method: 'POST' })));
    expect(mocks.replace).toHaveBeenCalledWith('/studio/opportunities/ai-internship');
  });

  it('round-trips offset timestamps through explicit UTC controls and preserves empty values', async () => {
    const user = userEvent.setup();
    render(<Provider><OpportunityEditor
      initialValue={{ ...opportunity, openAt: '2026-09-03T07:30:15.250+07:00' }}
      canPublish
    /></Provider>);

    expect(screen.getByText('All date and time fields use UTC.')).toBeInTheDocument();
    expect(screen.getByLabelText('Opens at')).toHaveValue('2026-09-03T00:30:15.250');
    expect(screen.getByLabelText('Closes at')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Opens at'), { target: { value: '2026-09-04T12:45:30.125' } });
    await user.click(screen.getByRole('button', { name: 'Save now' }));

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
    expect(body.document.openAt).toBe('2026-09-04T12:45:30.125Z');
    expect(body.document.closeAt).toBeNull();
  });

  it('saves edits of published content as a separate draft with a CAS timestamp', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { id: 'ai-internship', status: 'published', updated_at: '2026-09-05T02:00:00.000Z' },
    }), { status: 200 })));
    const user = userEvent.setup();
    render(<Provider><OpportunityEditor
      initialValue={opportunity}
      canPublish
      initialStatus="published"
      initialUpdatedAt="2026-09-05T01:00:00.000Z"
    /></Provider>);

    await user.clear(screen.getByLabelText('Organization'));
    await user.type(screen.getByLabelText('Organization'), 'Current form organization');
    expect(screen.getByRole('button', { name: 'Save now' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save now' }));

    const [url, request] = vi.mocked(fetch).mock.calls.at(-1)!;
    expect(url).toBe('/api/v1/studio/opportunities/ai-internship');
    expect(request?.method).toBe('PUT');
    expect(JSON.parse(String(request?.body))).toMatchObject({
      document: { id: 'ai-internship', organization: 'Current form organization' },
      expectedUpdatedAt: '2026-09-05T01:00:00.000Z',
    });
  });

  it('preserves the current form when a save CAS conflict requires comparison', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'OPPORTUNITY_DRAFT_CONFLICT', message: 'stale' },
    }), { status: 409 })));
    const user = userEvent.setup();
    render(<Provider><OpportunityEditor
      initialValue={opportunity}
      canPublish
      initialStatus="draft"
      initialUpdatedAt="2026-09-05T01:00:00.000Z"
    /></Provider>);
    await user.clear(screen.getByLabelText('Organization'));
    await user.type(screen.getByLabelText('Organization'), 'Unsaved local organization');

    await user.click(screen.getByRole('button', { name: 'Save now' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('stale');
    expect(screen.getByLabelText('Organization')).toHaveValue('Unsaved local organization');
  });

  it('preserves unapplied JSON typed while a form save is in flight', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const user = userEvent.setup();
    render(<Provider><OpportunityEditor initialValue={opportunity} canPublish initialUpdatedAt="2026-09-05T01:00:00.000Z" /></Provider>);
    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: 'Saved form organization' } });
    await user.click(screen.getByRole('button', { name: 'Save now' }));
    const code = screen.getByRole('textbox', {name:'Opportunity JSON'});
    fireEvent.change(code, {target:{value:'{"organization":'}});
    finish(new Response(JSON.stringify({data:{id:'ai-internship',status:'draft',updated_at:'2026-09-05T02:00:00.000Z'}})));
    await waitFor(() => expect(screen.getByRole('button', {name:'Save now'})).toBeDisabled());
    expect(code).toHaveValue('{"organization":');
    expect(screen.getByText(/This JSON has not been applied/)).toBeInTheDocument();
  });

  it('converts ISO offsets and nulls without the browser timezone', () => {
    expect(isoToUtcDateTimeInput('2026-09-03T07:30:15.250+07:00')).toBe('2026-09-03T00:30:15.250');
    expect(utcDateTimeInputToIso('2026-09-03T00:30:15.250')).toBe('2026-09-03T00:30:15.250Z');
    expect(isoToUtcDateTimeInput(null)).toBe('');
    expect(utcDateTimeInputToIso('')).toBeNull();
  });
});

describe('opportunity learner actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { interested: true } }), { status: 200 })));
  });
  afterEach(cleanup);

  it('tracks a view and an external application click with a safe new tab link', async () => {
    const user = userEvent.setup();
    render(<Provider><OpportunityViewTracker opportunityId="ai-internship" /><OpportunityAction opportunityId="ai-internship" applicationUrl="https://example.com/apply" internalApplication={false} initiallyInterested={false} /></Provider>);

    await waitFor(() => expect(mocks.track).toHaveBeenCalledWith('opportunity.viewed', { opportunityId: 'ai-internship' }));
    const link = screen.getByRole('link', { name: 'Apply now' });
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await user.click(link);
    expect(mocks.track).toHaveBeenCalledWith('opportunity.clicked', { opportunityId: 'ai-internship', application: 'external' });
  });

  it('sets internal interest and announces the updated state', async () => {
    const user = userEvent.setup();
    render(<Provider><OpportunityAction opportunityId="ai-internship" applicationUrl={null} internalApplication initiallyInterested={false} /></Provider>);

    await user.click(screen.getByRole('button', { name: "I'm interested" }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Interest saved'));
    expect(fetch).toHaveBeenCalledWith('/api/v1/opportunities/ai-internship/interest', expect.objectContaining({ method: 'PUT' }));
    expect(mocks.track).toHaveBeenCalledWith('opportunity.clicked', { opportunityId: 'ai-internship', application: 'internal' });
  });

  it('uses the durable returned interest state instead of the requested value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { interested: false } }), { status: 200 })));
    const user = userEvent.setup();
    render(<Provider><OpportunityAction opportunityId="ai-internship" applicationUrl={null} internalApplication initiallyInterested={false} /></Provider>);

    await user.click(screen.getByRole('button', { name: "I'm interested" }));

    expect(await screen.findByRole('status')).toHaveTextContent('Interest removed');
    expect(screen.getByRole('button', { name: "I'm interested" })).toHaveAttribute('aria-pressed', 'false');
  });

  it('guards duplicate interest writes synchronously', async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal('fetch', fetchMock);
    render(<Provider><OpportunityAction opportunityId="ai-internship" applicationUrl={null} internalApplication initiallyInterested={false} /></Provider>);

    const button = screen.getByRole('button', { name: "I'm interested" });
    button.click();
    button.click();
    expect(fetchMock).toHaveBeenCalledOnce();

    finish(new Response(JSON.stringify({ data: { interested: true } }), { status: 200 }));
    expect(await screen.findByRole('button', { name: 'Remove interest' })).toBeInTheDocument();
  });

  it('keeps state after a failed interest write and offers an explicit retry', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { interested: true } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<Provider><OpportunityAction opportunityId="ai-internship" applicationUrl={null} internalApplication initiallyInterested={false} /></Provider>);

    await user.click(screen.getByRole('button', { name: "I'm interested" }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Interest could not be updated.');
    expect(screen.getByRole('button', { name: "I'm interested" })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Retry interest update' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Interest saved');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('renders no external action for a non-HTTPS application URL', () => {
    render(<Provider><OpportunityAction opportunityId="unsafe" applicationUrl="javascript:alert(1)" internalApplication={false} initiallyInterested={false} /></Provider>);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('does not expose the external application action outside its window or eligibility', () => {
    const { rerender } = render(<Provider><OpportunityAction opportunityId="closed" applicationUrl="https://example.com/apply" internalApplication={false} initiallyInterested={false} availability="closed" /></Provider>);
    expect(screen.queryByRole('link', { name: 'Apply now' })).not.toBeInTheDocument();

    rerender(<Provider><OpportunityAction opportunityId="ineligible" applicationUrl="https://example.com/apply" internalApplication={false} initiallyInterested={false} availability="open" eligible={false} /></Provider>);
    expect(screen.queryByRole('link', { name: 'Apply now' })).not.toBeInTheDocument();
  });
});
