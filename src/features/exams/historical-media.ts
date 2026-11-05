import type { ExamService } from './service';
import type { ExamActor } from './types';

export type HistoricalExamMediaContext={attemptId:string;courseId:string;itemId:string};
type Asset={ownerId:string;bucket:string};
function record(value:unknown):Record<string,unknown>|null {
  return typeof value==='object' && value!==null && !Array.isArray(value) ? value as Record<string,unknown> : null;
}
function learnerReferences(value:unknown,assetId:string):boolean {
  if(Array.isArray(value)) return value.some(entry=>learnerReferences(entry,assetId));
  const row=record(value);
  return row!==null && (row.assetId===assetId || Object.values(row).some(entry=>learnerReferences(entry,assetId)));
}
function submittedAttachment(value:unknown,assetId:string):boolean {
  if(Array.isArray(value)) return value.some(entry=>submittedAttachment(entry,assetId));
  const row=record(value);
  if(!row) return false;
  if(Array.isArray(row.files) && row.files.some(file=>record(file)?.assetId===assetId)) return true;
  return Object.entries(row).some(([key,entry])=>key!=='files' && submittedAttachment(entry,assetId));
}

/** The review service checks owner, terminal status, course, item and original school. */
export async function canReadHistoricalExamMedia(
  service:Pick<ExamService,'historicalReview'>,actor:ExamActor,context:HistoricalExamMediaContext,assetId:string,asset:Asset,
):Promise<boolean> {
  const historical=await service.historicalReview(actor,context.attemptId,context.courseId,context.itemId);
  if(asset.bucket==='media') return learnerReferences(historical.learner,assetId);
  return asset.bucket==='submissions' && asset.ownerId===actor.id && submittedAttachment(historical.review.answers,assetId);
}
