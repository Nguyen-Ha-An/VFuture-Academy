export const MAX_SUBMISSION_UPLOAD_MB = 50;

export const UPLOAD_EXTENSIONS_BY_MIME: Readonly<Record<string, readonly string[]>> = {
  'image/avif': ['avif'],
  'image/bmp': ['bmp'],
  'image/gif': ['gif'],
  'image/heic': ['heic'],
  'image/heif': ['heif'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/jxl': ['jxl'],
  'image/png': ['png'],
  'image/tiff': ['tif', 'tiff'],
  'image/webp': ['webp'],
  'image/x-icon': ['ico'],
  'video/mp4': ['mp4'],
  'audio/mpeg': ['mp3'],
  'audio/mp4': ['m4a', 'mp4'],
  'application/pdf': ['pdf'],
  'application/zip': ['zip'],
  'application/json': ['json'],
  'application/x-ipynb+json': ['ipynb'],
  'text/plain': ['txt'],
  'text/csv': ['csv'],
  'application/msword': ['doc'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.ms-powerpoint': ['ppt'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'application/vnd.oasis.opendocument.text': ['odt'],
  'application/vnd.oasis.opendocument.spreadsheet': ['ods'],
  'application/vnd.oasis.opendocument.presentation': ['odp'],
};

export function uploadExtensionsForMime(mime: string): readonly string[] | undefined {
  return UPLOAD_EXTENSIONS_BY_MIME[mime];
}

export function isSupportedUploadMime(mime: string): boolean {
  return uploadExtensionsForMime(mime) !== undefined;
}

/** Returns a normalized final extension for an untrusted browser filename. */
export function uploadExtensionForFilename(name: string): string | null {
  const basename = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const match = /\.([A-Za-z0-9]+)$/.exec(basename);
  return match ? match[1].toLowerCase() : null;
}

/** Applies the same MIME/extension pair contract in browser preflight and server validation. */
export function isUploadMimeExtensionPair(name: string, mime: string): boolean {
  const fileExtension = uploadExtensionForFilename(name);
  return Boolean(fileExtension && uploadExtensionsForMime(mime)?.includes(fileExtension));
}
