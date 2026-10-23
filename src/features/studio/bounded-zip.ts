import 'server-only';

import { Readable } from 'node:stream';
import { createInflateRaw } from 'node:zlib';
import type JSZip from 'jszip';
import { ApiError } from '@/lib/api';

export type ZipByteBudget = { used: number; entryLimit: number; totalLimit: number };

/**
 * JSZip 3.x exposes the compressed entry through _data after loadAsync. Use native
 * zlib instead of JSZip's accumulate/worker APIs so destroy actually stops inflation
 * on a limit breach. No advertised uncompressed size is trusted as a memory bound.
 */
export async function readBoundedZipEntry(entry: JSZip.JSZipObject, budget: ZipByteBudget): Promise<Uint8Array> {
  const data = (entry as unknown as { _data?: {
    compressedContent?: Uint8Array;
    uncompressedSize?: number;
    compression?: { magic?: string };
  } })._data;
  if (!data || !(data.compressedContent instanceof Uint8Array)
    || !Number.isSafeInteger(data.uncompressedSize) || (data.uncompressedSize ?? -1) < 0
    || !['\x00\x00', '\x08\x00'].includes(data.compression?.magic ?? '')) {
    throw new ApiError(400, 'INVALID_BUNDLE', `Bundle entry has unsupported compression data: ${entry.name}`);
  }
  const source = Readable.from([data.compressedContent]);
  const inflater = data.compression?.magic === '\x08\x00' ? createInflateRaw() : null;
  const stream = inflater ? source.pipe(inflater) : source;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes = chunk as Uint8Array;
      size += bytes.byteLength;
      if (size > budget.entryLimit) {
        throw new ApiError(413, 'BUNDLE_ENTRY_TOO_LARGE', `Bundle entry exceeds the 20 MB limit: ${entry.name}`);
      }
      if (budget.used + bytes.byteLength > budget.totalLimit) {
        throw new ApiError(413, 'BUNDLE_UNCOMPRESSED_TOO_LARGE', 'Bundle exceeds the 100 MB uncompressed limit');
      }
      budget.used += bytes.byteLength;
      chunks.push(bytes);
    }
    if (size !== data.uncompressedSize) {
      throw new ApiError(400, 'INVALID_BUNDLE', `Bundle entry size is inconsistent: ${entry.name}`);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'INVALID_BUNDLE', `Bundle entry cannot be decompressed: ${entry.name}`);
  } finally {
    source.destroy();
    inflater?.destroy();
    chunks.length = 0;
  }
}
