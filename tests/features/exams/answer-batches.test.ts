import { describe, expect, it } from 'vitest';
import { answerBatches } from '@/features/exams/ui/answer-batches';

const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
describe('exam save batches',()=>{
  it('packs keyed UTF-8 maps within 64 KiB without splitting grouped answers',()=>{
    const grouped={'section/group/child':'λ'.repeat(3000)};
    const answers:Record<string,unknown>=Object.fromEntries(Array.from({length:15},(_,i)=>[`section/q-${i}`,'a'.repeat(5000)]));
    answers['section/group']=grouped;
    const groups=Object.fromEntries(Object.keys(answers).map(id=>[id,'section']));
    const batches=answerBatches(answers,groups);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every(batch=>bytes(batch.answers)<=65536 && Object.keys(batch.answers).length<=250)).toBe(true);
    expect(Object.assign({},...batches.map(batch=>batch.answers))).toEqual(answers);
    expect(batches.find(batch=>Object.hasOwn(batch.answers,'section/group'))?.answers['section/group']).toEqual(grouped);
  });
  it('keeps sections separate and preserves all falsy values',()=>{
    const batches=answerBatches({a:0,b:false,c:'',d:null},{a:'one',b:'one',c:'two',d:'two'});
    expect(batches).toEqual([{group:'one',answers:{a:0,b:false}},{group:'two',answers:{c:'',d:null}}]);
  });
  it('splits a section before the 251st key even when bytes fit',()=>{
    const answers=Object.fromEntries(Array.from({length:251},(_,i)=>[`q-${i}`,0]));
    const groups=Object.fromEntries(Object.keys(answers).map(id=>[id,'section']));
    expect(answerBatches(answers,groups).map(batch=>Object.keys(batch.answers).length)).toEqual([250,1]);
  });
  it('reports a single unsendable keyed answer without truncating it',()=>{
    expect(()=>answerBatches({'section/q':'x'.repeat(65534)},{'section/q':'section'})).toThrowError(expect.objectContaining({code:'ANSWER_TOO_LARGE',questionId:'section/q'}));
  });
});
