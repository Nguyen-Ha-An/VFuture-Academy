import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const nextConfig = {
  experimental: { externalDir: true },
  webpack(config) {
    config.cache = false;
    config.resolve.alias['@'] = path.join(repository, 'src');
    return config;
  },
};

export default nextConfig;
