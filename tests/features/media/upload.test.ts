import { describe, expect, it } from 'vitest';
import { mediaUploadMetadata } from '@/features/media/upload';

describe('media upload validation', () => {
  it('allows declared MIME types only when the extension matches', () => {
    expect(mediaUploadMetadata({ name: 'lesson.PNG', type: 'image/png', size: 1 })).toMatchObject({ filename: 'lesson.PNG' });
    expect(mediaUploadMetadata({ name: 'hero.jxl', type: 'image/jxl', size: 1 })).toMatchObject({ filename: 'hero.jxl' });
    expect(mediaUploadMetadata({ name: 'voice.m4a', type: 'audio/mp4', size: 1 })).toMatchObject({ filename: 'voice.m4a' });
    expect(mediaUploadMetadata({ name: 'handout.pdf', type: 'application/pdf', size: 1 })).toMatchObject({ filename: 'handout.pdf' });
    expect(() => mediaUploadMetadata({ name: 'malware.exe', type: 'image/png', size: 1 })).toThrow('Unsupported media file');
    expect(() => mediaUploadMetadata({ name: 'photo.png', type: 'application/octet-stream', size: 1 })).toThrow('Unsupported media file');
  });

  it('accepts notebook MIME only for .ipynb files', () => {
    expect(mediaUploadMetadata({ name: 'analysis.ipynb', type: 'application/x-ipynb+json', size: 1 }))
      .toMatchObject({ filename: 'analysis.ipynb', extension: 'ipynb' });
    expect(() => mediaUploadMetadata({ name: 'analysis.json', type: 'application/x-ipynb+json', size: 1 }))
      .toThrow('Unsupported media file');
    expect(() => mediaUploadMetadata({ name: 'analysis.ipynb', type: 'application/json', size: 1 }))
      .toThrow('Unsupported media file');
  });

  it.each([
    ['image/svg+xml'],
    ['image/svg'],
    ['image/svgz'],
    ['image/png'],
  ])('rejects SVG extensions declared as %s', (type) => {
    expect(() => mediaUploadMetadata({ name: 'script.svg', type, size: 1 })).toThrow('Unsupported media file');
  });

  it('accepts the 50 MB boundary and rejects a byte beyond it', () => {
    expect(mediaUploadMetadata({ name: 'handout.pdf', type: 'application/pdf', size: 50 * 1024 * 1024 })).toBeTruthy();
    expect(() => mediaUploadMetadata({ name: 'handout.pdf', type: 'application/pdf', size: 50 * 1024 * 1024 + 1 })).toThrow('Media file is too large');
  });

  it('removes path controls and reserves a safe basename for storage', () => {
    expect(mediaUploadMetadata({ name: '../..\\lesson final?.png', type: 'image/png', size: 1 }).filename).toBe('lesson-final.png');
  });

  it.each([
    ['bài giảng.png', 'bai-giang.png'],
    ['课程封面.png', 'file.png'],
  ])('keeps the validated extension for the Unicode filename %s', (name, filename) => {
    expect(mediaUploadMetadata({ name, type: 'image/png', size: 1 }).filename).toBe(filename);
  });

  it('truncates a long stem without cutting off the validated extension', () => {
    const filename = mediaUploadMetadata({ name: `${'a'.repeat(200)}.png`, type: 'image/png', size: 1 }).filename;

    expect(filename).toHaveLength(120);
    expect(filename.endsWith('.png')).toBe(true);
  });
});
