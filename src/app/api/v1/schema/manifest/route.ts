import { BLOCK_MANIFEST, PLAYER_MANIFEST } from '@/content-engine/manifest';
import { withHandler } from '@/lib/api';

/** Publishes the authoring capabilities supported by the current renderer build. */
export const GET = withHandler(async () => Response.json({
  blocks: BLOCK_MANIFEST,
  players: PLAYER_MANIFEST,
}, {
  headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
}));
