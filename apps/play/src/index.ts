// SPDX-License-Identifier: AGPL-3.0-only
// play.ozymandosis.com
import { loadConfig } from './config.js';
import { buildApp } from './app.js';

const cfg = loadConfig();
const { app } = await buildApp(cfg);
const stop = async (sig: string) => { app.log.info(`${sig}: shutting down`); await app.close(); process.exit(0); };
process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
await app.listen({ port: cfg.PORT, host: cfg.HOST });
app.log.info(`play service on ${cfg.PUBLIC_URL} (${cfg.NODE_ENV}, ${cfg.DATABASE_URL ? 'postgres' : 'pglite'})`);
