import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';

const mocks = vi.hoisted(() => ({
  disableTypes: vi.fn(),
  imageSize: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('image-size', () => mocks);

await import('@/features/media/storage');

describe('media dimension parser security', () => {
  it('disables vulnerable image parsers before inspecting upload bytes', () => {
    expect(mocks.disableTypes).toHaveBeenCalledOnce();
    expect(mocks.disableTypes).toHaveBeenCalledWith(['heif', 'icns', 'jxl', 'jxl-stream']);
  });

  it('rejects malformed ICNS promptly while still reading ordinary PNG dimensions', () => {
    // A child process timeout keeps an infinite-loop regression from hanging Vitest.
    const disabled = mocks.disableTypes.mock.calls[0]?.[0];
    const result = spawnSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const { disableTypes, imageSize } = require('image-size');
      disableTypes(${JSON.stringify(disabled)});
      const icns = Buffer.from('69636e73000000106963303700000000', 'hex');
      assert.throws(() => imageSize(icns), /disabled/i);
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
      assert.equal(imageSize(png).width, 1);
      assert.equal(imageSize(png).height, 1);
    `], { timeout: 2_000, encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });
});
