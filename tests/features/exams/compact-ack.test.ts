import { describe, expect, it, vi } from 'vitest';
import { createHttpExamClient } from '@/features/exams/ui/client';
const attemptId='00000000-0000-4000-8000-000000000003';
const response=(data:unknown)=>new Response(JSON.stringify({data}),{status:200,headers:{'content-type':'application/json'}});
describe('compact exam save acknowledgement',()=>{
  it('explicitly negotiates and decodes only the saved batch',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(response({format:'compact-v1',answers:[{questionId:'s/q',answer:false}]}));
    const client=createHttpExamClient({courseId:'course-one',itemId:'exam-one',attemptId,fetcher});
    await expect(client.save({'s/q':false})).resolves.toEqual([{questionId:'s/q',answer:false}]);
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('x-academy-exam-ack')).toBe('compact-v1');
  });
  it('accepts jsonb object key reordering while preserving values',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(response({format:'compact-v1',answers:[{questionId:'s/q',answer:{right:'b',left:'a'}}]}));
    const client=createHttpExamClient({courseId:'course-one',itemId:'exam-one',attemptId,fetcher});
    await expect(client.save({'s/q':{left:'a',right:'b'}})).resolves.toEqual([{questionId:'s/q',answer:{right:'b',left:'a'}}]);
  });
  it.each([
    {format:'compact-v1',answers:[]},
    {format:'compact-v1',answers:[{questionId:'s/q',answer:'wrong'}]},
    {format:'compact-v1',answers:[{questionId:'s/q',answer:'a'},{questionId:'s/q',answer:'a'}]},
    {format:'compact-v1',answers:[{questionId:'other',answer:'a'}]},
  ])('rejects incomplete or mismatched acknowledgements %#',async data=>{
    const client=createHttpExamClient({courseId:'course-one',itemId:'exam-one',attemptId,fetcher:vi.fn<typeof fetch>().mockResolvedValue(response(data))});
    await expect(client.save({'s/q':'a'})).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  });
});
