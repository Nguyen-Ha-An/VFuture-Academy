import { describe, it, expect } from 'vitest';
import { BLOCK_MANIFEST, isRenderableBlock, RENDERABLE_BLOCK_TYPES } from '@/content-engine/manifest/blocks';
import { PLAYER_MANIFEST, resolvePlayer, defaultInteraction, playerKey } from '@/content-engine/manifest/players';
import { LESSON_BLOCK_TYPES } from '@/content-engine/schema/lesson';
import { QUESTION_TYPES } from '@/content-engine/schema/questions';

describe('BLOCK_MANIFEST', () => {
  it('covers every lesson block type exactly once', () => {
    expect(BLOCK_MANIFEST.map((b) => b.type).sort()).toEqual([...LESSON_BLOCK_TYPES].sort());
  });
  it('marks math and diagram as reserved (not renderable)', () => {
    expect(isRenderableBlock('math')).toBe(false);
    expect(isRenderableBlock('diagram')).toBe(false);
    expect(isRenderableBlock('paragraph')).toBe(true);
    expect(RENDERABLE_BLOCK_TYPES).toHaveLength(24);
  });
});

describe('PLAYER_MANIFEST', () => {
  it('has 23 pairs, unique keys, one default per type, every type covered', () => {
    expect(PLAYER_MANIFEST).toHaveLength(23);
    const keys = PLAYER_MANIFEST.map((p) => playerKey(p.type, p.interactionType));
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of QUESTION_TYPES) expect(PLAYER_MANIFEST.filter((p) => p.type === t && p.isDefault)).toHaveLength(1);
  });
  it('resolves defaults, explicit pairs, and rejects unknown interaction', () => {
    expect(defaultInteraction('single_choice')).toBe('radio');
    expect(resolvePlayer('single_choice')).toMatchObject({ ok: true, player: { interactionType: 'radio' } });
    expect(resolvePlayer('ordering', 'timeline')).toMatchObject({ ok: true, player: { id: 'P18' } });
    expect(resolvePlayer('single_choice', 'circle')).toMatchObject({ ok: false, valid: ['radio', 'button', 'dropdown', 'image'] });
  });
});
