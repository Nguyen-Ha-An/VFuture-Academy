export type ItemEdit =
  | { op: 'add' | 'replace'; path: string; value: unknown }
  | { op: 'remove'; path: string; value?: unknown };

export class PatchError extends Error {
  constructor(readonly code: 'E_PATCH_POINTER_INVALID' | 'PATCH_FAILED', message: string) {
    super(message);
    this.name = 'PatchError';
  }
}

const FORBIDDEN_TOKENS = new Set(['__proto__', 'constructor', 'prototype']);
const IMMUTABLE_FIELDS = new Set(['id', 'kind', 'schemaVersion']);
const ARRAY_INDEX = /^(0|[1-9][0-9]*)$/;

function invalidPointer(): never {
  throw new PatchError('E_PATCH_POINTER_INVALID', 'Invalid or unsafe JSON pointer.');
}

function patchFailed(): never {
  throw new PatchError('PATCH_FAILED', 'Item edit could not be applied.');
}

/** Decode a bounded RFC 6901 pointer. Array syntax is checked during traversal. */
export function parsePointer(pointer: string): string[] {
  if (typeof pointer !== 'string' || (pointer !== '' && !pointer.startsWith('/'))) invalidPointer();
  if (pointer === '') return [];

  const encoded = pointer.slice(1).split('/');
  if (encoded.length > 32) invalidPointer();
  return encoded.map((token) => {
    if (/~(?![01])/.test(token)) invalidPointer();
    const decoded = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if (decoded.length > 512 || FORBIDDEN_TOKENS.has(decoded)) invalidPointer();
    return decoded;
  });
}

function arrayIndex(token: string, length: number, allowEnd: boolean): number {
  if (!ARRAY_INDEX.test(token)) invalidPointer();
  const index = Number(token);
  if (!Number.isSafeInteger(index)) invalidPointer();
  if (index >= length + (allowEnd ? 1 : 0)) patchFailed();
  return index;
}

function objectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childAt(parent: unknown, token: string): unknown {
  if (token === '-') invalidPointer();
  if (Array.isArray(parent)) {
    const index = arrayIndex(token, parent.length, false);
    if (!Object.hasOwn(parent, index)) patchFailed();
    return parent[index];
  }
  if (!objectRecord(parent) || !Object.hasOwn(parent, token)) patchFailed();
  return parent[token];
}

/** Resolve a pointer against the current document, including the empty root pointer. */
export function resolvePointer(document: unknown, pointer: string): unknown {
  let value = document;
  for (const token of parsePointer(pointer)) value = childAt(value, token);
  return value;
}

/** Copy JSON containers, including values supplied by edits, without inherited keys. */
function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as T;
  if (!objectRecord(value)) return value;
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) copy[key] = cloneJson(value[key]);
  return copy as T;
}

/** Apply bounded RFC 6902 add/replace/remove edits to a private copy of an item. */
export function applyItemEdits<T>(document: T, edits: readonly ItemEdit[]): T {
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > 200 || !objectRecord(document)) patchFailed();

  const operations = edits.map((edit) => {
    if (!objectRecord(edit) || typeof edit.path !== 'string') patchFailed();
    if (edit.op !== 'add' && edit.op !== 'replace' && edit.op !== 'remove') patchFailed();
    if (edit.op !== 'remove' && !Object.hasOwn(edit, 'value')) patchFailed();
    const tokens = parsePointer(edit.path);
    if (tokens.length === 0 || IMMUTABLE_FIELDS.has(tokens[0])) patchFailed();
    if (tokens.some((token, index) => token === '-' && (edit.op !== 'add' || index !== tokens.length - 1))) invalidPointer();
    return { edit, tokens };
  });

  const result = cloneJson(document);
  for (const { edit, tokens } of operations) {
    let parent: unknown = result;
    for (const token of tokens.slice(0, -1)) parent = childAt(parent, token);
    const token = tokens[tokens.length - 1];

    if (Array.isArray(parent)) {
      const index = token === '-' && edit.op === 'add'
        ? parent.length
        : arrayIndex(token, parent.length, edit.op === 'add');
      if (edit.op === 'add') parent.splice(index, 0, cloneJson(edit.value));
      else if (edit.op === 'replace') parent[index] = cloneJson(edit.value);
      else parent.splice(index, 1);
      continue;
    }

    if (!objectRecord(parent)) patchFailed();
    if (edit.op !== 'add' && !Object.hasOwn(parent, token)) patchFailed();
    if (edit.op === 'remove') delete parent[token];
    else parent[token] = cloneJson(edit.value);
  }
  return result;
}
