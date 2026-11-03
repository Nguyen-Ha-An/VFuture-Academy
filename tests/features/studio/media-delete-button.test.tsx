// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaDeleteButton } from '@/features/media/MediaDeleteButton';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function view(onDeleted=vi.fn()) {
  render(<NextIntlClientProvider locale="en" messages={{}}><MediaDeleteButton assetId="asset_ONE" filename="guide.pdf" onDeleted={onDeleted}/></NextIntlClientProvider>);
  return onDeleted;
}
describe('media deletion confirmation', () => {
  it('requires confirmation and removes the row only after successful deletion', async () => {
    let finish!: (value:Response)=>void;
    const fetcher=vi.fn(() => new Promise<Response>(resolve => { finish=resolve; }));
    vi.stubGlobal('fetch',fetcher);
    const done=view();
    fireEvent.click(screen.getByRole('button',{name:'Delete file'}));
    expect(screen.getByRole('dialog',{name:'Delete guide.pdf?'})).toBeVisible();
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Delete permanently'}));
    expect(done).not.toHaveBeenCalled();
    finish(new Response(JSON.stringify({data:{id:'asset_ONE',deleted:true}})));
    await waitFor(()=>expect(done).toHaveBeenCalledOnce());
  });
  it('cancels without deleting and keeps a failed deletion available for retry', async () => {
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code:'MEDIA_IN_USE',message:'This file is retained by published content'}}),{status:409}));
    vi.stubGlobal('fetch',fetcher);
    const done=view();
    fireEvent.click(screen.getByRole('button',{name:'Delete file'}));
    fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Delete file'}));
    fireEvent.click(screen.getByRole('button',{name:'Delete permanently'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('published content');
    expect(done).not.toHaveBeenCalled();
    expect(screen.getByRole('button',{name:'Delete permanently'})).toBeEnabled();
  });
});
