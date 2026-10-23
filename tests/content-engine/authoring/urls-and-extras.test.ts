import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { authoringBlockJsonSchema, authoringJsonSchema, authoringQuestionJsonSchema, schemaForAuthoring, staticProfileContext } from '@/content-engine/authoring';
import { EMBED_URL_PATTERN, MEDIA_URL_PATTERN, VIDEO_PROVIDER_URL_PATTERNS } from '@/content-engine/authoring/primitives';

const ajv = () => {
  const instance = new Ajv2020({ strict: true, allErrors: true });
  addFormats(instance);
  return instance;
};

describe('authoring URL and JSON extra rules', () => {
  it('allows only exact media and embed hosts over HTTPS', () => {
    expect(MEDIA_URL_PATTERN.test('https://images.unsplash.com/photo-1')).toBe(true);
    expect(MEDIA_URL_PATTERN.test('https://tenant.supabase.co/storage/file.png')).toBe(true);
    expect(MEDIA_URL_PATTERN.test('http://images.unsplash.com/photo-1')).toBe(false);
    expect(MEDIA_URL_PATTERN.test('https://images.unsplash.com.evil.test/photo-1')).toBe(false);
    expect(MEDIA_URL_PATTERN.test('https://user@images.unsplash.com/photo-1')).toBe(false);
    expect(EMBED_URL_PATTERN.test('https://www.figma.com/embed')).toBe(true);
    expect(EMBED_URL_PATTERN.test('https://figma.com.evil.test/embed')).toBe(false);
    expect(VIDEO_PROVIDER_URL_PATTERNS.youtube.test('https://youtu.be/video')).toBe(true);
    expect(VIDEO_PROVIDER_URL_PATTERNS.youtube.test('https://vimeo.com/video')).toBe(false);
  });

  it('enforces provider-host pairing in JSON Schema', () => {
    const validate = ajv().compile(authoringBlockJsonSchema('video', staticProfileContext('mono')));
    expect(validate({ id: 'video-a', type: 'video', provider: 'youtube', url: 'https://www.youtube.com/watch?v=1' })).toBe(true);
    expect(validate({ id: 'video-a', type: 'video', provider: 'youtube', url: 'https://vimeo.com/123' })).toBe(false);
  });

  it('emits ID-shaped record keys and numeric tolerance exclusion', () => {
    const context = staticProfileContext('mono');
    const numeric = ajv().compile(authoringQuestionJsonSchema('numeric', context));
    const rich = { blocks: [{ type: 'paragraph', content: [{ text: 'Number?' }] }] };
    const base = { id: 'numeric-a', type: 'numeric', points: 1, content: rich, explanation: rich, correctAnswer: 3 };
    expect(numeric({ ...base, tolerance: 0.2 })).toBe(true);
    expect(numeric({ ...base, tolerance: 0.2, tolerancePercent: 5 })).toBe(false);

    const classification = authoringQuestionJsonSchema('classification', context);
    expect(JSON.stringify(classification)).toContain('propertyNames');
  });

  it('enforces assignment submission dependencies in JSON Schema', () => {
    const validate = ajv().compile(authoringJsonSchema('assignment', staticProfileContext('mono')));
    const assignment = {
      schemaVersion: 1, kind: 'assignment', id: 'assignment-a', title: 'Assignment',
      instructions: { blocks: [{ type: 'paragraph', content: [{ text: 'Work' }] }] },
      rubric: { criteria: [{ id: 'quality', name: 'Quality', maxPoints: 5 }] },
    };
    expect(validate({ ...assignment, submission: { accepts: ['code'], codeLanguage: 'python' } })).toBe(true);
    expect(validate({ ...assignment, submission: { accepts: ['code'] } })).toBe(false);
    expect(validate({ ...assignment, submission: { accepts: ['text'], codeLanguage: 'python' } })).toBe(false);
    expect(validate({ ...assignment, submission: { accepts: ['text'], maxFiles: 2 } })).toBe(false);
    expect(validate({ ...assignment, submission: { accepts: ['link'], linkHosts: ['example.org'] } })).toBe(true);
  });

  it('keeps next-step URL acceptance aligned between Zod and Ajv', () => {
    const context = staticProfileContext('mono');
    const zod = schemaForAuthoring('lesson', context);
    const validate = ajv().compile(authoringBlockJsonSchema('next_step', context));
    const valid = { id: 'next-a', type: 'next_step', title: 'Visit', target: { kind: 'url', url: 'https://example.org/path' } };
    const invalid = { ...valid, target: { kind: 'url', url: 'https://example.org:99999/path' } };
    expect(validate(valid)).toBe(true);
    expect(validate(invalid)).toBe(false);
    expect(zod.safeParse({ schemaVersion: 1, kind: 'lesson', id: 'lesson-a', title: 'Lesson', blocks: [invalid] }).success).toBe(false);
  });
});
