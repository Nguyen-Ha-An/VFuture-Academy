import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Tests use an in-memory PostgreSQL engine only. No connection URL or production
// credentials are accepted. Install the optional engine in an isolated directory.
const root = process.env.PGLITE_RUNTIME;
const load = (relative, packageName) => root
  ? import(pathToFileURL(resolve(root, relative)).href)
  : import(packageName);
export const { PGlite } = await load('dist/index.js', '@electric-sql/pglite');
export const { pgcrypto } = await load('dist/contrib/pgcrypto.js', '@electric-sql/pglite/contrib/pgcrypto');
