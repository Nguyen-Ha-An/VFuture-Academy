import { describe, expect, it } from 'vitest';

import { InMemoryResolver, validateStandaloneDocument } from '@/content-engine/validate';

const assignment = {
  schemaVersion: 1,
  kind: 'assignment',
  id: 'notebook-assignment',
  title: 'Notebook assignment',
  instructions: { blocks: [{ type: 'paragraph', content: [{ text: 'Analyze the data' }] }] },
  submission: { accepts: ['file'] },
  notebook: {
    templateAssetId: 'template-asset',
    templateChecksum: 'a'.repeat(64),
    runtimeProfileId: 'python-data-v1',
    runtimeProfileVersion: '1',
    datasets: [{ assetId: 'dataset-asset', checksum: 'b'.repeat(64), filename: 'input.csv' }],
  },
};

describe('notebook assignment validation', () => {
  it('resolves both immutable template and dataset assets', async () => {
    const missing = await validateStandaloneDocument(assignment, 'assignment.json', new InMemoryResolver({ assets: [] }));
    expect(missing.report.errors.filter(({ code }) => code === 'E_ASSET_UNKNOWN').map(({ meta }) => meta?.id).sort())
      .toEqual(['dataset-asset', 'template-asset']);

    const found = await validateStandaloneDocument(assignment, 'assignment.json', new InMemoryResolver({
      assets: ['template-asset', 'dataset-asset'],
    }));
    expect(found.ok, JSON.stringify(found.report.errors)).toBe(true);
  });
});
