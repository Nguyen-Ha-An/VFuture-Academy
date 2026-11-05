import { canonicalAnswers } from '@/features/learning/answer-canonical';
import { EXAM_ANSWER_BATCH_KEYS, EXAM_ANSWER_MAP_BYTES } from './answer-batches';

export interface PendingExamDraftStore {
  readonly key: string;
  read(): Record<string, unknown> | null;
  write(answers: Record<string, unknown>): boolean;
  clear(): void;
}

const KEY_PREFIX='vfuture:exam:pending:v1:';
const MAX_INDEX_BYTES=128*1024;
type Entry={id:string;key:string};
function record(value:unknown):Record<string,unknown>|null {
  return typeof value==='object' && value!==null && !Array.isArray(value) ? value as Record<string,unknown> : null;
}
function byteLength(value:string):number { return new TextEncoder().encode(value).byteLength; }
function defaultStorage():Storage|null {
  try { return typeof window==='undefined' ? null : window.sessionStorage; } catch { return null; }
}

export function createPendingExamDraftStore(attemptId:string, storage:Storage|null=defaultStorage()):PendingExamDraftStore {
  const key=`${KEY_PREFIX}${encodeURIComponent(attemptId)}`;
  const entryPrefix=`${key}:journal:`;
  function parseIndex(raw:string|null):Entry[]|null {
    if(!raw || byteLength(raw)>MAX_INDEX_BYTES) return null;
    const index=record(JSON.parse(raw));
    if(index?.version!==2 || !Array.isArray(index.entries) || index.entries.length>EXAM_ANSWER_BATCH_KEYS) return null;
    const entries:Entry[]=[];const ids=new Set<string>(),keys=new Set<string>();
    for(const item of index.entries) {
      const entry=record(item);
      if(typeof entry?.id!=='string' || !entry.id || entry.id.length>194 || typeof entry.key!=='string'
        || !entry.key.startsWith(entryPrefix) || ids.has(entry.id) || keys.has(entry.key)) return null;
      ids.add(entry.id);keys.add(entry.key);entries.push({id:entry.id,key:entry.key});
    }
    return entries;
  }
  function clear() {
    try {
      let entries:Entry[]=[];
      try { entries=parseIndex(storage?.getItem(key) ?? null) ?? []; } catch { /* Malformed index has no trusted entry paths. */ }
      storage?.removeItem(key);
      for(const entry of entries) storage?.removeItem(entry.key);
    } catch { /* A blocked storage area cannot interrupt the exam. */ }
  }
  return {
    key,
    read() {
      try {
        const raw=storage?.getItem(key);if(!raw)return null;
        if(byteLength(raw)>MAX_INDEX_BYTES){clear();return null;}
        const parsed=record(JSON.parse(raw));
        if(parsed?.version===1) {
          const answers=record(parsed.answers);
          if(answers && byteLength(JSON.stringify(answers))<=EXAM_ANSWER_MAP_BYTES) return structuredClone(answers);
        }
        const entries=parseIndex(raw);
        if(entries) {
          const answers:Array<[string,unknown]>=[];
          for(const entry of entries) {
            const value=storage?.getItem(entry.key);
            if(!value || byteLength(value)>EXAM_ANSWER_MAP_BYTES+1024) return null;
            const stored=record(JSON.parse(value));
            if(stored?.id!==entry.id || !Object.hasOwn(stored,'value')) return null;
            answers.push([entry.id,stored.value]);
          }
          return Object.fromEntries(answers);
        }
        clear();return null;
      } catch { clear();return null; }
    },
    write(input) {
      if(!storage)return false;
      const answers=canonicalAnswers(input);
      if(Object.keys(answers).length===0){clear();return true;}
      const created:string[]=[];
      try {
        const values=Object.entries(answers);
        if(values.length>EXAM_ANSWER_BATCH_KEYS || values.some(([id,value])=>!id || id.length>194 || byteLength(JSON.stringify({[id]:value}))>EXAM_ANSWER_MAP_BYTES)) return false;
        const previous=parseIndex(storage.getItem(key)) ?? [];
        const previousById=new Map(previous.map(entry=>[entry.id,entry]));
        const generation=globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        const entries:Entry[]=[];
        for(const [index,[id,value]] of values.entries()) {
          const serialized=JSON.stringify({id,value});
          const old=previousById.get(id);
          if(old && storage.getItem(old.key)===serialized) { entries.push(old);continue; }
          const entryKey=`${entryPrefix}${generation}:${index}`;
          storage.setItem(entryKey,serialized);created.push(entryKey);entries.push({id,key:entryKey});
        }
        const next=JSON.stringify({version:2,entries,updatedAt:Date.now()});
        if(byteLength(next)>MAX_INDEX_BYTES)throw new Error('Journal index exceeds limit');
        // This one write is the commit. Until it succeeds the old index remains authoritative.
        storage.setItem(key,next);
        const retained=new Set(entries.map(entry=>entry.key));
        for(const entry of previous) if(!retained.has(entry.key)) { try {storage.removeItem(entry.key);} catch {} }
        return true;
      } catch {
        for(const entryKey of created) { try {storage.removeItem(entryKey);} catch {} }
        return false;
      }
    },
    clear,
  };
}
