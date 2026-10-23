export interface PendingExamDraftStore {
  readonly key: string;
  read(): Record<string, unknown> | null;
  write(answers: Record<string, unknown>): boolean;
  clear(): void;
}

const DRAFT_VERSION = 1;
const MAX_ANSWER_BYTES = 64 * 1_024;
const MAX_STORED_BYTES = MAX_ANSWER_BYTES + 2 * 1_024;
const KEY_PREFIX = 'vfuture:exam:pending:v1:';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function createPendingExamDraftStore(
  attemptId: string,
  storage: Storage | null = defaultStorage(),
): PendingExamDraftStore {
  const key = `${KEY_PREFIX}${encodeURIComponent(attemptId)}`;
  const clear = () => {
    try {
      storage?.removeItem(key);
    } catch {
      // Draft recovery must never interrupt the authoritative exam session.
    }
  };

  return {
    key,
    read() {
      try {
        const raw = storage?.getItem(key);
        if (!raw) return null;
        if (new TextEncoder().encode(raw).byteLength > MAX_STORED_BYTES) {
          clear();
          return null;
        }
        const value = record(JSON.parse(raw));
        const answers = record(value?.answers);
        if (value?.version !== DRAFT_VERSION || !answers) {
          clear();
          return null;
        }
        return structuredClone(answers);
      } catch {
        clear();
        return null;
      }
    },
    write(answers) {
      if (Object.keys(answers).length === 0) {
        clear();
        return true;
      }
      try {
        const answerBytes = new TextEncoder().encode(JSON.stringify(answers)).byteLength;
        if (answerBytes > MAX_ANSWER_BYTES) {
          clear();
          return false;
        }
        const raw = JSON.stringify({ version: DRAFT_VERSION, answers, updatedAt: Date.now() });
        storage?.setItem(key, raw);
        return storage !== null;
      } catch {
        clear();
        return false;
      }
    },
    clear,
  };
}
