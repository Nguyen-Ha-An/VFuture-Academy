export const EXAM_ANSWER_MAP_BYTES=64*1024;
export const EXAM_ANSWER_BATCH_KEYS=250;

export class ExamAnswerTooLargeError extends Error {
  readonly code='ANSWER_TOO_LARGE';
  constructor(readonly questionId:string) {
    super('An answer exceeds the keyed 64 KiB limit. Shorten it before saving.');
    this.name='ExamAnswerTooLargeError';
  }
}
function bytes(value:Record<string,unknown>):number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** Packs whole top-level answers by section and exact UTF-8 keyed JSON size. */
export function answerBatches(delta:Record<string,unknown>,groups:Record<string,string>):Array<{group:string;answers:Record<string,unknown>}> {
  const sections=new Map<string,Array<[string,unknown]>>();
  for(const [id,answer] of Object.entries(delta)) {
    const group=groups[id] ?? id;
    const entries=sections.get(group) ?? [];
    entries.push([id,answer]);sections.set(group,entries);
  }
  const output:Array<{group:string;answers:Record<string,unknown>}>=[];
  for(const [group,entries] of sections) {
    let current:Record<string,unknown>={};
    for(const [id,answer] of entries) {
      if(bytes({[id]:answer})>EXAM_ANSWER_MAP_BYTES) throw new ExamAnswerTooLargeError(id);
      const next={...current,[id]:answer};
      if(Object.keys(next).length>EXAM_ANSWER_BATCH_KEYS || bytes(next)>EXAM_ANSWER_MAP_BYTES) {
        output.push({group,answers:current});current={[id]:answer};
      } else current=next;
    }
    if(Object.keys(current).length) output.push({group,answers:current});
  }
  return output;
}
