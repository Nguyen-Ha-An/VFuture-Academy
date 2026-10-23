import { describe, expect, it } from 'vitest';

import { InMemoryResolver, validateStandaloneDocument } from '@/content-engine/validate';

describe('standalone resource validation', () => {
  it('reports E_RESOURCE_ACTIVITY_BLOCK at the offending localized block path', async () => {
    const document = {
      schemaVersion: 1,
      kind: 'resource',
      id: 'interactive-guide',
      languages: ['vi', 'en'],
      defaultLanguage: 'vi',
      title: { vi: 'Hướng dẫn', en: 'Guide' },
      summary: { vi: 'Tóm tắt', en: 'Summary' },
      resourceType: 'guide',
      body: {
        vi: { blocks: [{ id: 'reflection-one', type: 'reflection', prompt: 'Think' }] },
        en: { blocks: [{ type: 'paragraph', content: [{ text: 'Read' }] }] },
      },
    };

    const result = await validateStandaloneDocument(document, document.id, new InMemoryResolver({}));

    expect(result.ok).toBe(false);
    expect(result.report.errors).toMatchObject([{
      code: 'E_RESOURCE_ACTIVITY_BLOCK',
      docId: 'interactive-guide',
      path: '/body/vi/blocks/0',
    }]);
  });
});
