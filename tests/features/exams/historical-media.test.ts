import { describe, expect, it, vi } from 'vitest';
import { canReadHistoricalExamMedia } from '@/features/exams/historical-media';

const context={attemptId:'00000000-0000-4000-8000-000000000003',courseId:'course-one',itemId:'exam-one'};
const actor={id:'learner-one',locale:'vi' as const};
const media={ownerId:'publisher',bucket:'media'};
function service() {
  return {historicalReview:vi.fn(async()=>({
    learner:{id:'exam-one',kind:'exam' as const,title:'Exam',sections:[{id:'s',title:'Section',questions:[{id:'s/q',type:'single_choice',content:{assetId:'asset-image'}}]}]},
    review:{attemptId:context.attemptId,status:'graded' as const,late:false,released:false,revealed:{},answers:{'s/q':{files:[{assetId:'asset-file',name:'work.pdf',size:1,mime:'application/pdf'}]}}},
  }))};
}
describe('historical exam media references',()=>{
  it('admits exact published learner media only after owner history authorization',async()=>{
    const reader=service();
    await expect(canReadHistoricalExamMedia(reader,actor,context,'asset-image',media)).resolves.toBe(true);
    expect(reader.historicalReview).toHaveBeenCalledWith(actor,context.attemptId,context.courseId,context.itemId);
  });
  it('admits an actual submitted attachment only to its owner',async()=>{
    const reader=service();
    await expect(canReadHistoricalExamMedia(reader,actor,context,'asset-file',{ownerId:actor.id,bucket:'submissions'})).resolves.toBe(true);
    await expect(canReadHistoricalExamMedia(reader,actor,context,'asset-file',{ownerId:'other',bucket:'submissions'})).resolves.toBe(false);
  });
  it('does not admit unrelated, cross-bucket, or fabricated arbitrary answer assetIds',async()=>{
    const reader=service();
    await expect(canReadHistoricalExamMedia(reader,actor,context,'other',media)).resolves.toBe(false);
    await expect(canReadHistoricalExamMedia(reader,actor,context,'asset-image',{ownerId:'other',bucket:'submissions'})).resolves.toBe(false);
    await expect(canReadHistoricalExamMedia(reader,actor,context,'asset-file',media)).resolves.toBe(false);
  });
  it('does not fall back when historical attempt authorization rejects',async()=>{
    const reader=service();reader.historicalReview.mockRejectedValue(new Error('not owner'));
    await expect(canReadHistoricalExamMedia(reader,actor,context,'asset-image',media)).rejects.toThrow('not owner');
  });
});
