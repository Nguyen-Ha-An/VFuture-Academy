import { describe, expect, it } from 'vitest';
import { streamExamJson } from '@/features/exams/http';

describe('finite exam JSON response',()=>{
  it('streams a response larger than 4.5 MB with the normal envelope and exact UTF-8',async()=>{
    const value={text:'界'.repeat(1_600_000),boundary:'a'.repeat(65_520)+'🙂Tiếng Việt🧪'.repeat(20),when:new Date('2026-11-05T00:00:00Z'),items:[null,false,0,'']};
    const response=streamExamJson(value);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const reader=response.body!.getReader();const chunks:Uint8Array[]=[];
    for(;;){const item=await reader.read();if(item.done)break;chunks.push(item.value);}
    expect(chunks.length).toBeGreaterThan(1);
    const decoded=new TextDecoder().decode(Buffer.concat(chunks));
    expect(JSON.parse(decoded)).toEqual({data:{...value,when:value.when.toISOString()}});
  });
  it('rejects unserializable data before constructing a successful response',()=>{
    expect(()=>streamExamJson({invalid:BigInt(1)})).toThrow();
  });
});
