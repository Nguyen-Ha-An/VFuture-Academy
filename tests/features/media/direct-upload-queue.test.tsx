// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { useState } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubmissionFields } from '@/content-engine/render/questions/UploadAnswer';
import type { AssignmentPayload } from '@/content-engine/render/runtime';
import { createApiRuntime } from '@/features/runtime/api-runtime';

const runtimes:ReturnType<typeof createApiRuntime>[]=[];
afterEach(()=>{cleanup();for(const runtime of runtimes.splice(0))runtime.dispose();vi.unstubAllGlobals();});
function setup() {
  vi.stubGlobal('crypto',webcrypto);
  const events:string[]=[];
  const requests=new Map<string,{name:string;size:number;mime:string}>();
  let active:string|null=null, completeFirst:(()=>void)|undefined;
  const reply=(data:unknown,status=200)=>new Response(JSON.stringify(status===200?{data}:{error:data}),{status});
  const fetch=vi.fn(async(url:string,init:RequestInit)=>{
    if(url.endsWith('/reserve')) {
      const body=JSON.parse(String(init.body));events.push(`reserve:${body.name}`);
      if(active) return reply({code:'UPLOAD_ACTIVE',message:'another upload active'},409);
      active=body.uploadId;requests.set(active!,body);
      return reply({uploadId:active,uploadUrl:`https://storage.test/${active}`,method:'PUT'});
    }
    const id=url.split('/')[4], metadata=requests.get(id)!;
    if(url.endsWith('/finalize')) {expect(active).toBe(id);active=null;events.push(`finalize:${metadata.name}`);return reply({assetId:`asset_${id}`,...metadata});}
    if(init.method==='DELETE'){expect(active).toBe(id);active=null;events.push(`cancel:${metadata.name}`);return reply({cancelled:true});}
    throw new Error(`Unexpected URL ${url}`);
  });
  class Xhr {
    status=200;withCredentials=false;listeners=new Map<string,()=>void>();progress?: (event:ProgressEvent)=>void;
    upload={addEventListener:(_name:string,listener:(event:ProgressEvent)=>void)=>{this.progress=listener;}};
    open=vi.fn();setRequestHeader=vi.fn();addEventListener=(name:string,fn:()=>void)=>this.listeners.set(name,fn);
    send=(file:File)=>{
      events.push(`put:${file.name}`);this.progress?.({loaded:2,total:4,lengthComputable:true} as ProgressEvent);
      if(!completeFirst)completeFirst=()=>this.listeners.get('load')?.();else queueMicrotask(()=>this.listeners.get('load')?.());
    };
    abort=()=>this.listeners.get('abort')?.();
  }
  vi.stubGlobal('XMLHttpRequest',Xhr);
  const runtime=createApiRuntime({courseId:'course',itemId:'item',locale:'en',initialState:{},fetchImpl:fetch as unknown as typeof globalThis.fetch});runtimes.push(runtime);
  function Harness(){const [value,setValue]=useState<AssignmentPayload>({});return <SubmissionFields accepts={['file']} value={value} onChange={setValue} runtime={runtime} assignmentTarget={{blockId:'inline-work'}} maxFiles={3}/>;}
  render(<Harness/>);
  return {events,finish:()=>completeFirst?.(),fetch};
}
const selected=()=>['one.txt','two.txt','three.txt'].map(name=>new File(['work'],name,{type:'text/plain'}));
describe('assignment multi-file direct upload queue',()=>{
  it('serializes all three selected files through actual runtime/client admission and reports each progress',async()=>{
    const {events,finish}=setup();const user=userEvent.setup();
    await user.upload(screen.getByLabelText('Upload files'),selected());
    await waitFor(()=>expect(screen.getByRole('progressbar',{name:'Upload progress for one.txt'})).toHaveAttribute('aria-valuenow','50'));
    expect(events).toEqual(['reserve:one.txt','put:one.txt']);
    expect(screen.getByRole('progressbar',{name:'Upload progress for two.txt'})).toHaveAttribute('aria-valuenow','0');
    await act(async()=>finish());
    await waitFor(()=>expect(screen.getAllByRole('button',{name:'remove'})).toHaveLength(3));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(events).toEqual(['reserve:one.txt','put:one.txt','finalize:one.txt','reserve:two.txt','put:two.txt','finalize:two.txt','reserve:three.txt','put:three.txt','finalize:three.txt']);
  });
  it('cancels a waiting file immediately without reserving it or bypassing the active predecessor',async()=>{
    const {events,finish}=setup();const user=userEvent.setup();
    await user.upload(screen.getByLabelText('Upload files'),selected());
    await waitFor(()=>expect(events).toContain('put:one.txt'));
    await user.click(screen.getByRole('button',{name:'Cancel two.txt'}));
    expect(await screen.findByText('Upload cancelled for two.txt')).toBeInTheDocument();
    expect(events).toEqual(['reserve:one.txt','put:one.txt']);
    await act(async()=>finish());
    await waitFor(()=>expect(screen.getAllByRole('button',{name:'remove'})).toHaveLength(2));
    expect(events).toEqual(['reserve:one.txt','put:one.txt','finalize:one.txt','reserve:three.txt','put:three.txt','finalize:three.txt']);
  });
  it('cancels the active transfer before admitting the next selected file',async()=>{
    const {events}=setup();const user=userEvent.setup();
    await user.upload(screen.getByLabelText('Upload files'),selected().slice(0,2));
    await waitFor(()=>expect(events).toContain('put:one.txt'));
    await user.click(screen.getByRole('button',{name:'Cancel one.txt'}));
    await waitFor(()=>expect(screen.getAllByRole('button',{name:'remove'})).toHaveLength(1));
    expect(events).toEqual(['reserve:one.txt','put:one.txt','cancel:one.txt','reserve:two.txt','put:two.txt','finalize:two.txt']);
  });
});
