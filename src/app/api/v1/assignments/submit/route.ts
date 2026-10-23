import { z } from 'zod';

import { SubmissionPayloadSchema, submit } from '@/features/submissions/service';
import { IdSchema } from '@/content-engine/schema/common';
import { ApiError,parseBody, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { getActor,type Actor } from '@/lib/permissions';
import { assertActiveNotebookActor,assertNotebookActor } from '@/features/notebooks/actor-precondition';

const SubmitAssignmentSchema = z.object({
  courseId: IdSchema,
  itemId: IdSchema,
  blockId: IdSchema.nullable().optional().default(null),
  expectedLatestSubmissionId: z.string().uuid().nullable().optional().default(null),
  payload: SubmissionPayloadSchema,
}).strict();

export const POST = withHandler(async (request) => {
  const user = await requireApiUser();
  const input = await parseBody(SubmitAssignmentSchema, request);
  let actor:Actor={userId:user.id,roles:[]};
  if(input.payload.notebook){
    assertNotebookActor(request,user.id);
    const persistedActor=await getActor();
    if(!persistedActor||persistedActor.userId!==user.id)throw new ApiError(401,'NOTEBOOK_ACTOR_CHANGED','The signed-in account changed; reload the notebook');
    assertActiveNotebookActor(persistedActor);actor=persistedActor;
  }
  return submit(
    actor,
    { courseId: input.courseId, itemId: input.itemId, blockId: input.blockId },
    input.expectedLatestSubmissionId,
    input.payload,
  );
});
