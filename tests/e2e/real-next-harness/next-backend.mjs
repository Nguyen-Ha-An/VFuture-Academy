// Actual root Next application, configured with its public reverse-proxy origin.
// No route aliases, fixture page tree, mock data clients or production source patches.
import next from 'next';
import { createServer } from 'node:http';
import { installLocalFetchGuard } from './fetch-guard.mjs';
installLocalFetchGuard(process.env.ACADEMY_ROUTING_RUNTIME);
const app=next({dev:process.env.ACADEMY_ROUTING_MODE!=='production',dir:process.cwd(),hostname:'localhost',port:4452});
await app.prepare();
const server=createServer(app.getRequestHandler());
server.on('upgrade',app.getUpgradeHandler());
server.listen(4454,'127.0.0.1');
const stop=()=>{server.closeAllConnections?.();server.close(()=>void app.close().then(()=>process.exit(0)));};
process.once('SIGTERM',stop);process.once('SIGINT',stop);
