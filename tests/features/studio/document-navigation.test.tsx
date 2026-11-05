// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import messages from '@/messages/en.json';
import { requestNavigation } from '@/lib/navigation-guard';
import { useUnsavedChanges } from '@/features/studio/ui/useUnsavedChanges';
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
function Editor({showTrigger=true}:{showTrigger?:boolean}) { const { dialog } = useUnsavedChanges(true, async () => false); return <main tabIndex={-1}><h1 tabIndex={-1}>Editor page</h1>{showTrigger&&<button>Editor</button>}<h2 tabIndex={-1}>Navigation destination</h2>{dialog}</main>; }
afterEach(() => { cleanup();vi.restoreAllMocks(); });
function geometry(element:HTMLElement){const rect=new DOMRect(0,0,120,40);vi.spyOn(element,'getClientRects').mockReturnValue(Object.assign([rect],{item:(index:number)=>index===0?rect:null}));}
it('restores the real requesting control when a controlled no-Trigger guard is cancelled', async()=>{
 render(<NextIntlClientProvider locale="en" messages={messages}><Editor /></NextIntlClientProvider>);
 const trigger=screen.getByRole('button',{name:'Editor'});geometry(trigger);trigger.focus();
 let decision!:Promise<boolean>;act(()=>{decision=requestNavigation();});
 fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:messages.studioWorkspace.stay}));
 await expect(decision).resolves.toBe(false);await waitFor(()=>expect(trigger).toHaveFocus());
});
it('uses the declared page heading when the requesting control was removed', async()=>{
 const view=render(<NextIntlClientProvider locale="en" messages={messages}><Editor /></NextIntlClientProvider>);
 const trigger=screen.getByRole('button',{name:'Editor'});geometry(trigger);const heading=screen.getByRole('heading',{name:'Editor page'});geometry(heading);trigger.focus();
 let decision!:Promise<boolean>;act(()=>{decision=requestNavigation();});await screen.findByRole('dialog');
 view.rerender(<NextIntlClientProvider locale="en" messages={messages}><Editor showTrigger={false} /></NextIntlClientProvider>);
 fireEvent.click(screen.getByRole('button',{name:messages.studioWorkspace.stay}));await expect(decision).resolves.toBe(false);await waitFor(()=>expect(heading).toHaveFocus());
});
it('restores before approval resolves so an allowed navigation can own the final focus', async()=>{
 render(<NextIntlClientProvider locale="en" messages={messages}><Editor /></NextIntlClientProvider>);
 const trigger=screen.getByRole('button',{name:'Editor'});geometry(trigger);trigger.focus();const destination=screen.getByRole('heading',{name:'Navigation destination'});
 let navigation!:Promise<void>;act(()=>{navigation=requestNavigation().then(allowed=>{if(allowed)destination.focus();});});
 fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:messages.studioWorkspace.discard}));await navigation;await waitFor(()=>expect(destination).toHaveFocus());
});
it('resolves document approval after the dialog closes and revokes the unload exemption when the operation aborts', async () => {
  render(<NextIntlClientProvider locale="en" messages={messages}><Editor /></NextIntlClientProvider>);
  const operation = new AbortController();
  let decision!: Promise<boolean>;
  act(() => { decision = requestNavigation({ kind: 'document', signal: operation.signal }); });
  expect(await screen.findByRole('dialog')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: messages.studioWorkspace.discard }));
  await act(async () => { expect(await decision).toBe(true); });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const approved = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(approved);
  expect(approved.defaultPrevented).toBe(false);
  operation.abort();
  const protectedAgain = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(protectedAgain);
  expect(protectedAgain.defaultPrevented).toBe(true);
});
