// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('next-intl',()=>({useLocale:()=> 'en'}));
import { AuthPopupCompletion } from '@/components/AuthPopupCompletion';
import { completeAuthPopup } from '@/lib/identity/popup-completion';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('keeps a missing-opener completion visible unless the matching parent acknowledges it',()=>{
 const channels:Array<{onmessage:((event:MessageEvent)=>void)|null;postMessage:ReturnType<typeof vi.fn>;close:ReturnType<typeof vi.fn>}>=[];
 vi.stubGlobal('opener',null);vi.spyOn(window,'close').mockImplementation(()=>{});
 vi.stubGlobal('BroadcastChannel',class {onmessage:((event:MessageEvent)=>void)|null=null;postMessage=vi.fn();close=vi.fn();constructor(){channels.push(this);}});
 completeAuthPopup('a'.repeat(48),'success');
 const channel=channels[0];
 expect(window.close).not.toHaveBeenCalled();expect(channel?.postMessage).toHaveBeenCalledWith({type:'academy-auth-popup',attempt:'a'.repeat(48),status:'success'});
 channel?.onmessage?.(new MessageEvent('message',{origin:window.location.origin,data:{type:'academy-auth-popup-ack',attempt:'b'.repeat(48)}}));expect(window.close).not.toHaveBeenCalled();
 channel?.onmessage?.(new MessageEvent('message',{origin:window.location.origin,data:{type:'academy-auth-popup-ack',attempt:'a'.repeat(48)}}));expect(window.close).toHaveBeenCalledOnce();
});

it('reinstalls the completion listener across React StrictMode effect cleanup',async()=>{
 const React=await import('react');const {render,cleanup}=await import('@testing-library/react/pure');
 const channels:Array<{onmessage:((event:MessageEvent)=>void)|null;postMessage:ReturnType<typeof vi.fn>;close:ReturnType<typeof vi.fn>}>=[];
 vi.stubGlobal('opener',null);vi.spyOn(window,'close').mockImplementation(()=>{});
 vi.stubGlobal('BroadcastChannel',class {onmessage:((event:MessageEvent)=>void)|null=null;postMessage=vi.fn();close=vi.fn();constructor(){channels.push(this);}});
 render(React.createElement(React.StrictMode,null,React.createElement(AuthPopupCompletion,{attempt:'b'.repeat(48),status:'success'})));
 expect(channels).toHaveLength(2);
 channels[1].onmessage?.(new MessageEvent('message',{origin:window.location.origin,data:{type:'academy-auth-popup-ack',attempt:'b'.repeat(48)}}));
 expect(window.close).toHaveBeenCalledOnce();cleanup();
});
