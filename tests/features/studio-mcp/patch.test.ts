import { describe, expect, it } from 'vitest';
import { applyItemEdits, parsePointer, PatchError, resolvePointer } from '@/features/studio-mcp/data/patch';

function expectPatchCode(run: () => unknown, code: PatchError['code']): void {
  try {
    run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(PatchError);
    expect((error as PatchError).code).toBe(code);
  }
}

describe('RFC 6901 pointers', () => {
  it('decodes escaped tokens and permits a root or empty-key pointer', () => {
    expect(parsePointer('')).toEqual([]);
    expect(parsePointer('/')).toEqual(['']);
    expect(parsePointer('/a~1b/~0/~01')).toEqual(['a/b', '~', '~1']);
  });

  it.each([
    'title',
    '/bad~',
    '/bad~2',
    '/__proto__',
    '/constructor',
    '/prototype',
    '/a/__proto__/b',
    `/${'x'.repeat(513)}`,
    `/${Array(33).fill('a').join('/')}`,
  ])('rejects invalid or unsafe pointer %s', (pointer) => {
    expectPatchCode(() => parsePointer(pointer), 'E_PATCH_POINTER_INVALID');
  });

  it('resolves decoded object keys and canonical array indices', () => {
    const document = { 'a/b': [{ '~': { '': 7 } }] };
    expect(resolvePointer(document, '')).toBe(document);
    expect(resolvePointer(document, '/a~1b/0/~0/')).toBe(7);
  });

  it.each(['/items/01', '/items/-', '/items/1e0', '/items/-1', '/items/9007199254740992'])
    ('rejects invalid array indices %s', (pointer) => {
      expectPatchCode(() => resolvePointer({ items: ['a'] }, pointer), 'E_PATCH_POINTER_INVALID');
    });

  it('fails when a valid pointer does not resolve', () => {
    expectPatchCode(() => resolvePointer({ items: ['a'] }, '/items/1'), 'PATCH_FAILED');
    expectPatchCode(() => resolvePointer({ item: {} }, '/item/missing'), 'PATCH_FAILED');
  });
});

describe('item edits', () => {
  it('applies object and array operations in order without mutating the input', () => {
    const document = {
      id: 'lesson-1', kind: 'lesson', schemaVersion: 1,
      blocks: [{ id: 'a', text: 'old' }, { id: 'b', text: 'keep' }],
      meta: { title: 'Before' },
    };
    const original = structuredClone(document);

    const result = applyItemEdits(document, [
      { op: 'replace', path: '/blocks/0/text', value: 'new' },
      { op: 'add', path: '/blocks/1', value: { id: 'between' } },
      { op: 'add', path: '/blocks/-', value: { id: 'last' } },
      { op: 'remove', path: '/blocks/2' },
      { op: 'add', path: '/meta/title', value: 'After' },
    ]);

    expect(result.blocks).toEqual([{ id: 'a', text: 'new' }, { id: 'between' }, { id: 'last' }]);
    expect(result.meta.title).toBe('After');
    expect(document).toEqual(original);
    expect(result).not.toBe(document);
    expect(result.blocks).not.toBe(document.blocks);
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.getPrototypeOf(result.meta)).toBeNull();
    expect(Object.getPrototypeOf(result.blocks[0])).toBeNull();
  });

  it('supports empty object keys and escaped names', () => {
    const result = applyItemEdits({ id: 'a', kind: 'lesson', schemaVersion: 1 }, [
      { op: 'add', path: '/a~1b', value: { '': 1 } },
      { op: 'replace', path: '/a~1b/', value: 2 },
    ]);
    expect(resolvePointer(result, '/a~1b/')).toBe(2);
  });

  it('clones untrusted data into null-prototype records', () => {
    const value = JSON.parse('{"__proto__":{"polluted":true},"nested":{"constructor":"data"}}') as Record<string, unknown>;
    const result = applyItemEdits({ id: 'a', kind: 'lesson', schemaVersion: 1 }, [
      { op: 'add', path: '/payload', value },
    ]) as Record<string, unknown>;
    const payload = result.payload as Record<string, unknown>;
    expect(Object.getPrototypeOf(payload)).toBeNull();
    expect(Object.getPrototypeOf(payload.nested)).toBeNull();
    expect(Object.hasOwn(payload, '__proto__')).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it.each(['/id', '/kind', '/schemaVersion', '/id/name', ''])
    ('rejects edits to immutable document identity at %s', (path) => {
      expectPatchCode(
        () => applyItemEdits({ id: 'a', kind: 'lesson', schemaVersion: 1 }, [{ op: 'replace', path, value: 'changed' }]),
        'PATCH_FAILED',
      );
    });

  it('requires existing targets for replace and remove but permits add to replace an object property', () => {
    const document = { id: 'a', kind: 'lesson', schemaVersion: 1, meta: { title: 'old' } };
    expect(applyItemEdits(document, [{ op: 'add', path: '/meta/title', value: 'new' }]).meta.title).toBe('new');
    expectPatchCode(() => applyItemEdits(document, [{ op: 'replace', path: '/meta/missing', value: 1 }]), 'PATCH_FAILED');
    expectPatchCode(() => applyItemEdits(document, [{ op: 'remove', path: '/meta/missing' }]), 'PATCH_FAILED');
    expectPatchCode(() => applyItemEdits(document, [{ op: 'add', path: '/absent/child', value: 1 }]), 'PATCH_FAILED');
  });

  it('enforces array bounds and canonical indices for edits', () => {
    const document = { id: 'a', kind: 'lesson', schemaVersion: 1, items: ['a'] };
    expect(applyItemEdits(document, [{ op: 'add', path: '/items/1', value: 'b' }]).items).toEqual(['a', 'b']);
    expectPatchCode(() => applyItemEdits(document, [{ op: 'add', path: '/items/2', value: 'b' }]), 'PATCH_FAILED');
    expectPatchCode(() => applyItemEdits(document, [{ op: 'replace', path: '/items/1', value: 'b' }]), 'PATCH_FAILED');
    expectPatchCode(() => applyItemEdits(document, [{ op: 'add', path: '/items/01', value: 'b' }]), 'E_PATCH_POINTER_INVALID');
    expectPatchCode(() => applyItemEdits(document, [{ op: 'remove', path: '/items/-' }]), 'E_PATCH_POINTER_INVALID');
    expectPatchCode(() => applyItemEdits(document, [{ op: 'add', path: '/items/-/id', value: 'b' }]), 'E_PATCH_POINTER_INVALID');
  });

  it('rejects unsupported operations, absent values and operation counts outside 1–200', () => {
    const document = { id: 'a', kind: 'lesson', schemaVersion: 1, title: 'old' };
    expectPatchCode(() => applyItemEdits(document, []), 'PATCH_FAILED');
    expectPatchCode(() => applyItemEdits(document, Array(201).fill({ op: 'remove', path: '/title' })), 'PATCH_FAILED');
    expectPatchCode(() => applyItemEdits(document, [{ op: 'replace', path: '/title' }] as never), 'PATCH_FAILED');
    expectPatchCode(() => applyItemEdits(document, [{ op: 'copy', path: '/title' }] as never), 'PATCH_FAILED');
  });

  it('keeps the source intact if a later operation fails', () => {
    const document = { id: 'a', kind: 'lesson', schemaVersion: 1, items: ['a'] };
    expectPatchCode(() => applyItemEdits(document, [
      { op: 'add', path: '/items/-', value: 'b' },
      { op: 'replace', path: '/items/9', value: 'c' },
    ]), 'PATCH_FAILED');
    expect(document.items).toEqual(['a']);
  });
});
