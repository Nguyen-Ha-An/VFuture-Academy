import { describe, it, expect, beforeAll, vi } from 'vitest';
vi.mock('@uiw/react-codemirror', () => ({ default: () => null }));
import { registerAll } from '@/content-engine/render';
import { blockRegistry, questionRegistry } from '@/content-engine/render/registry';
import { RENDERABLE_BLOCK_TYPES } from '@/content-engine/manifest/blocks';
import { PLAYER_KEYS } from '@/content-engine/manifest/players';
import { AUTO_GRADED_TYPES } from '@/content-engine/schema/questions';
import { GRADERS } from '@/content-engine/grading';

beforeAll(() => registerAll());
describe('manifest ↔ registry coverage', () => {
  it('every renderable block type has a renderer and reserved types do not', () => {
    for (const type of RENDERABLE_BLOCK_TYPES) expect(blockRegistry[type], type).toBeDefined();
    expect(blockRegistry.math).toBeUndefined();
    expect(blockRegistry.diagram).toBeUndefined();
  });
  it('every player pair has a renderer', () => { for (const key of PLAYER_KEYS) expect(questionRegistry[key], key).toBeDefined(); });
  it('every auto-graded type has a grader', () => { for (const type of AUTO_GRADED_TYPES) expect(GRADERS[type], type).toBeDefined(); });
});
