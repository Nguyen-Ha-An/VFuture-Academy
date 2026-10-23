import { describe, expect, it } from 'vitest';

import { RESERVED_PROJECT_IDS, slugifyProjectId } from '@/features/projects/ids';
import { ID_PATTERN } from '@/content-engine/schema/common';

describe('project id helpers', () => {
  it('reserves the learner new-proposal route segment', () => {
    expect([...RESERVED_PROJECT_IDS]).toEqual(['new']);
  });

  it.each([
    ['Phòng lab khí hậu', 'phong-lab-khi-hau'],
    ['Đội robot Đà Nẵng', 'doi-robot-da-nang'],
    ['  --AI & Data: 2026!--  ', 'ai-data-2026'],
    ['new', 'new-project'],
    ['NEW', 'new-project'],
    ['!!!', 'project'],
    ['', 'project'],
  ])('slugifies %j to %j', (title, expected) => {
    expect(slugifyProjectId(title)).toBe(expected);
  });

  it('caps long titles at the id length without a trailing dash', () => {
    const slug = slugifyProjectId(`${'a'.repeat(63)} b`);

    expect(slug).toBe('a'.repeat(63));
    expect(slugifyProjectId('word '.repeat(40))).toMatch(ID_PATTERN);
    expect(slugifyProjectId('word '.repeat(40)).length).toBeLessThanOrEqual(64);
  });
});
