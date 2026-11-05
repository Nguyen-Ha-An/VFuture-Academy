import { describe, expect, it } from 'vitest';
import { assignmentTitle, teachingTitle } from '@/features/teaching/titles';

describe('teaching labels', () => {
  it('prefers the requested language and falls back to the available language or identifier', () => {
    expect(teachingTitle({ en: 'Physics', vi: 'Vật lý' }, 'en', 'id')).toBe('Physics');
    expect(teachingTitle({ en: 'Physics', vi: 'Vật lý' }, 'vi', 'id')).toBe('Vật lý');
    expect(teachingTitle({ vi: 'Vật lý' }, 'en', 'id')).toBe('Vật lý');
    expect(teachingTitle({}, 'en', 'id')).toBe('id');
  });
  it('finds an assignment nested inside accordion items and stepper steps', () => {
    const source = { blocks: [{ type: 'accordion', items: [{ blocks: [{ type: 'stepper', steps: [{ blocks: [{ type: 'assignment', id: 'task', title: { en: 'Essay', vi: 'Bài luận' } }] }] }] }] }] };
    expect(assignmentTitle(source, 'task', 'en', 'task')).toBe('Essay');
    expect(assignmentTitle(source, 'task', 'vi', 'task')).toBe('Bài luận');
    expect(assignmentTitle(source, 'missing', 'en', 'missing')).toBe('missing');
  });
});
