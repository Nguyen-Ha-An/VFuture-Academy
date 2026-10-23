// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { NotebookBridge } from '@/features/notebooks/bridge';

describe('notebook bridge boundary', () => {
  it('ignores a foreign origin, window and expired session', async () => {
    const frame = { postMessage: vi.fn() } as unknown as Window;
    const changed = vi.fn();
    const bridge = new NotebookBridge(frame, 'https://runtime.example', changed);
    const data = { channel:'vfuture:notebook:v1', version:1, session:bridge.session, type:'CHANGED', payload:{notebook:{cells:[]}} };
    window.dispatchEvent(new MessageEvent('message', {data, origin:'https://evil.example', source:frame}));
    window.dispatchEvent(new MessageEvent('message', {data, origin:'https://runtime.example', source:window}));
    window.dispatchEvent(new MessageEvent('message', {data:{...data,session:'old'}, origin:'https://runtime.example', source:frame}));
    expect(changed).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent('message', {data, origin:'https://runtime.example', source:frame}));
    expect(changed).toHaveBeenCalledWith({cells:[]});
    bridge.dispose();
    window.dispatchEvent(new MessageEvent('message', {data, origin:'https://runtime.example', source:frame}));
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it('sends only the exact runtime origin and correlates the response', async () => {
    const frame = {postMessage:vi.fn()} as unknown as Window;
    const bridge = new NotebookBridge(frame,'https://runtime.example',vi.fn());
    const promise = bridge.request('EXPORT');
    const [request, target] = vi.mocked(frame.postMessage).mock.calls[0];
    expect(target).toBe('https://runtime.example');
    window.dispatchEvent(new MessageEvent('message',{origin:target as string,source:frame,data:{...request,type:'RESPONSE',ok:true,result:{cells:[]}}}));
    await expect(promise).resolves.toEqual({cells:[]});
    bridge.dispose();
  });
  it('reads runtime event errors from the protocol payload', () => {
    const frame = {postMessage:vi.fn()} as unknown as Window;
    const runtimeError = vi.fn();
    const bridge = new NotebookBridge(frame,'https://runtime.example',vi.fn(),undefined,runtimeError);
    window.dispatchEvent(new MessageEvent('message', {origin:'https://runtime.example',source:frame,data:{
      channel:'vfuture:notebook:v1',version:1,session:bridge.session,type:'ERROR',payload:{code:'PAYLOAD_TOO_LARGE',message:'Snapshot is too large'},
    }}));
    expect(runtimeError).toHaveBeenCalledWith('Snapshot is too large','PAYLOAD_TOO_LARGE');
    bridge.dispose();
  });
  it('rejects outstanding operations when the workspace is closed', async () => {
    const bridge = new NotebookBridge({postMessage:vi.fn()} as unknown as Window,'https://runtime.example',vi.fn());
    const pending = bridge.request('EXPORT');
    bridge.dispose();
    expect(bridge.isClosed).toBe(true);
    await expect(pending).rejects.toThrow('closed');
  });
  it('exposes its lifecycle state for idempotent host reconnection', () => {
    const bridge=new NotebookBridge({postMessage:vi.fn()} as unknown as Window,'https://runtime.example',vi.fn());
    expect(bridge.isClosed).toBe(false);
    bridge.dispose();
    expect(bridge.isClosed).toBe(true);
  });
  it('always closes and rejects pending work when the frame disappears during disposal', async () => {
    const frame = {postMessage:vi.fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => { throw new Error('detached'); })} as unknown as Window;
    const bridge = new NotebookBridge(frame,'https://runtime.example',vi.fn());
    const pending = bridge.request('EXPORT');
    expect(() => bridge.dispose()).not.toThrow();
    await expect(pending).rejects.toThrow('closed');
    await expect(bridge.request('PING')).rejects.toThrow('closed');
  });
});
